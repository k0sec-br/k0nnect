use crate::native_api::{NativeApiClient, NativeTransportError};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::{ipc::Channel, State};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        client::IntoClientRequest,
        http::{
            header::{COOKIE, ORIGIN},
            HeaderValue,
        },
        protocol::{frame::coding::CloseCode, CloseFrame},
        Message,
    },
};

const SOCKET_ORIGIN: &str = "https://connect.k0sec.org";

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NativeSocketEvent {
    Open,
    Message { data: String },
    Close { code: u16, reason: String },
    Error,
}

enum NativeSocketCommand {
    Send(String),
    Close(u16, String),
}

pub struct NativeSocketState {
    next_id: AtomicU64,
    sockets: Arc<Mutex<HashMap<u64, mpsc::UnboundedSender<NativeSocketCommand>>>>,
}

impl Default for NativeSocketState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            sockets: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn valid_socket_url(raw_url: &str) -> bool {
    let Ok(url) = url::Url::parse(raw_url) else {
        return false;
    };
    url.scheme() == "wss"
        && url.host_str() == Some("connect.k0sec.org")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/api/servers/")
        && url.path().ends_with("/socket")
}

#[tauri::command]
pub async fn native_socket_open(
    api: State<'_, NativeApiClient>,
    sockets: State<'_, NativeSocketState>,
    url: String,
    events: Channel<NativeSocketEvent>,
) -> Result<u64, NativeTransportError> {
    if !valid_socket_url(&url) {
        return Err(NativeTransportError::invalid_request());
    }
    let mut request = url
        .into_client_request()
        .map_err(|_| NativeTransportError::invalid_request())?;
    request
        .headers_mut()
        .insert(ORIGIN, HeaderValue::from_static(SOCKET_ORIGIN));
    if let Some(cookie) = api.cookie_header() {
        request.headers_mut().insert(COOKIE, cookie);
    } else {
        return Err(NativeTransportError::network());
    }
    let (socket, _) = connect_async(request)
        .await
        .map_err(|_| NativeTransportError::network())?;
    let socket_id = sockets.next_id.fetch_add(1, Ordering::Relaxed);
    let (commands_tx, mut commands_rx) = mpsc::unbounded_channel();
    sockets.sockets.lock().await.insert(socket_id, commands_tx);
    let sockets_state = sockets.sockets.clone();
    let _ = events.send(NativeSocketEvent::Open);

    tauri::async_runtime::spawn(async move {
        let (mut writer, mut reader) = socket.split();
        loop {
            tokio::select! {
                incoming = reader.next() => match incoming {
                    Some(Ok(Message::Text(data))) => {
                        let _ = events.send(NativeSocketEvent::Message { data: data.to_string() });
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame
                            .map(|value| (u16::from(value.code), value.reason.to_string()))
                            .unwrap_or((1000, String::new()));
                        let _ = events.send(NativeSocketEvent::Close { code, reason });
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => {
                        let _ = events.send(NativeSocketEvent::Error);
                        let _ = events.send(NativeSocketEvent::Close { code: 4000, reason: "Erro de transporte".into() });
                        break;
                    }
                    None => {
                        let _ = events.send(NativeSocketEvent::Close { code: 1006, reason: String::new() });
                        break;
                    }
                },
                command = commands_rx.recv() => match command {
                    Some(NativeSocketCommand::Send(data)) => {
                        if writer.send(Message::Text(data.into())).await.is_err() {
                            let _ = events.send(NativeSocketEvent::Error);
                            let _ = events.send(NativeSocketEvent::Close {
                                code: 4000,
                                reason: "Erro de transporte".into(),
                            });
                            break;
                        }
                    }
                    Some(NativeSocketCommand::Close(code, reason)) => {
                        let frame = CloseFrame { code: CloseCode::from(code), reason: reason.into() };
                        let _ = writer.send(Message::Close(Some(frame))).await;
                        break;
                    }
                    None => break,
                }
            }
        }
        sockets_state.lock().await.remove(&socket_id);
    });
    Ok(socket_id)
}

#[tauri::command]
pub async fn native_socket_send(
    sockets: State<'_, NativeSocketState>,
    socket_id: u64,
    data: String,
) -> Result<(), NativeTransportError> {
    let sender = sockets
        .sockets
        .lock()
        .await
        .get(&socket_id)
        .cloned()
        .ok_or_else(NativeTransportError::network)?;
    sender
        .send(NativeSocketCommand::Send(data))
        .map_err(|_| NativeTransportError::network())
}

#[tauri::command]
pub async fn native_socket_close(
    sockets: State<'_, NativeSocketState>,
    socket_id: u64,
    code: u16,
    reason: String,
) -> Result<(), NativeTransportError> {
    let sender = sockets
        .sockets
        .lock()
        .await
        .remove(&socket_id)
        .ok_or_else(NativeTransportError::network)?;
    sender
        .send(NativeSocketCommand::Close(code, reason))
        .map_err(|_| NativeTransportError::network())
}
