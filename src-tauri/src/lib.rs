#[cfg(desktop)]
mod media_origin;
mod native_api;
mod native_socket;

#[cfg(desktop)]
mod tray;

#[cfg(target_os = "linux")]
mod linux_media;

#[cfg(target_os = "windows")]
mod windows_media;

use native_api::{native_api_request, NativeApiClient};
use native_socket::{
    native_socket_close, native_socket_open, native_socket_send, NativeSocketState,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                tray::focus_main_window(app);
            },
        ));
    }

    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .manage(NativeSocketState::default())
        .invoke_handler(tauri::generate_handler![
            native_api_request,
            native_socket_open,
            native_socket_send,
            native_socket_close
        ])
        .setup(|app| {
            app.manage(NativeApiClient::new().map_err(std::io::Error::other)?);
            #[cfg(target_os = "linux")]
            linux_media::configure(app)?;
            #[cfg(target_os = "windows")]
            windows_media::configure(app)?;
            #[cfg(desktop)]
            tray::setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
                let _ = _window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o k0nnect");
}
