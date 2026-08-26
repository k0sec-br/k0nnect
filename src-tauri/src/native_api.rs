use reqwest::{
    cookie::{CookieStore, Jar},
    header::{HeaderValue, ORIGIN},
    Client, Method, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

#[cfg(not(target_os = "android"))]
use keyring::Entry as CredentialEntry;
#[cfg(target_os = "android")]
use keyring_core::Entry as CredentialEntry;

const API_ORIGIN: &str = "https://connect.k0sec.org";
const SESSION_COOKIE_NAME: &str = "__Host-k0nnect_session";
const CREDENTIAL_SERVICE: &str = "org.k0sec.k0nnect";
const CREDENTIAL_USER: &str = "session";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeApiRequest {
    method: String,
    path: String,
    body: Option<Value>,
    csrf_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeApiResponse {
    status: u16,
    payload: Value,
}

#[derive(Debug, Serialize)]
pub struct NativeTransportError {
    code: &'static str,
    message: &'static str,
}

impl NativeTransportError {
    pub(crate) fn network() -> Self {
        Self {
            code: "NETWORK_UNAVAILABLE",
            message: "Não foi possível conectar ao k0nnect.",
        }
    }

    pub(crate) fn invalid_request() -> Self {
        Self {
            code: "INVALID_NATIVE_REQUEST",
            message: "A solicitação do aplicativo não é válida.",
        }
    }

    fn invalid_response() -> Self {
        Self {
            code: "INTERNAL_ERROR",
            message: "O k0nnect retornou uma resposta inválida.",
        }
    }
}

pub struct NativeApiClient {
    client: Client,
    cookie_jar: Arc<Jar>,
    origin: Url,
}

impl NativeApiClient {
    pub fn new() -> Result<Self, String> {
        configure_credential_store()?;
        let origin = Url::parse(API_ORIGIN).map_err(|_| "origem da API inválida")?;
        let cookie_jar = Arc::new(Jar::default());
        if let Ok(entry) = CredentialEntry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER) {
            if let Ok(session_token) = entry.get_password() {
                if valid_session_token(&session_token) {
                    cookie_jar.add_cookie_str(
                        &format!(
                            "{SESSION_COOKIE_NAME}={session_token}; Secure; HttpOnly; SameSite=Lax; Path=/"
                        ),
                        &origin,
                    );
                }
            }
        }
        let client = Client::builder()
            .cookie_provider(cookie_jar.clone())
            .https_only(true)
            .user_agent("k0nnect-native/0.1.0")
            .build()
            .map_err(|_| "cliente HTTP indisponível")?;
        Ok(Self {
            client,
            cookie_jar,
            origin,
        })
    }

    pub fn cookie_header(&self) -> Option<HeaderValue> {
        self.cookie_jar.cookies(&self.origin)
    }

    fn persist_session(&self) {
        let session_token = self
            .cookie_header()
            .and_then(|header| header.to_str().ok().map(ToOwned::to_owned))
            .and_then(|cookies| {
                cookies.split(';').find_map(|cookie| {
                    let (name, value) = cookie.trim().split_once('=')?;
                    (name == SESSION_COOKIE_NAME && valid_session_token(value))
                        .then(|| value.to_owned())
                })
            });
        let Ok(entry) = CredentialEntry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER) else {
            return;
        };
        if let Some(token) = session_token {
            let _ = entry.set_password(&token);
        } else {
            let _ = entry.delete_credential();
        }
    }
}

#[cfg(target_os = "android")]
fn configure_credential_store() -> Result<(), String> {
    keyring::cli::use_native_store(true).map_err(|_| "cofre seguro indisponível".to_owned())
}

#[cfg(not(target_os = "android"))]
fn configure_credential_store() -> Result<(), String> {
    CredentialEntry::store_status()
        .as_ref()
        .map(|_| ())
        .map_err(|_| "cofre seguro indisponível".to_owned())
}

fn valid_session_token(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn validate_path(path: &str) -> bool {
    path.starts_with("/api/")
        && !path.contains("://")
        && !path.contains("..")
        && !path.contains('\\')
        && !path.contains('#')
}

#[tauri::command]
pub async fn native_api_request(
    state: State<'_, NativeApiClient>,
    request: NativeApiRequest,
) -> Result<NativeApiResponse, NativeTransportError> {
    if !validate_path(&request.path) {
        return Err(NativeTransportError::invalid_request());
    }
    let method = match request.method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "DELETE" => Method::DELETE,
        _ => return Err(NativeTransportError::invalid_request()),
    };
    if method == Method::GET && request.body.is_some() {
        return Err(NativeTransportError::invalid_request());
    }
    let url = state
        .origin
        .join(&request.path)
        .map_err(|_| NativeTransportError::invalid_request())?;
    if url.origin() != state.origin.origin() {
        return Err(NativeTransportError::invalid_request());
    }

    let mut builder = state
        .client
        .request(method, url)
        .header(ORIGIN, API_ORIGIN)
        .header("Accept", "application/json");
    if let Some(csrf_token) = request.csrf_token {
        builder = builder.header("X-CSRF-Token", csrf_token);
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|_| NativeTransportError::network())?;
    let status = response.status().as_u16();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| NativeTransportError::invalid_response())?;
    state.persist_session();
    Ok(NativeApiResponse { status, payload })
}
