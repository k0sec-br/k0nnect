use tauri::{App, Manager};
use webkit2gtk::{
    glib::ObjectExt, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt,
};

use crate::media_origin::is_trusted_app_origin;

pub fn configure(app: &App) -> tauri::Result<()> {
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| tauri::Error::AssetNotFound("janela principal ausente".into()))?;

    webview.with_webview(|platform_webview| {
        let webview = platform_webview.inner();
        if let Some(settings) = webview.settings() {
            settings.set_enable_webrtc(true);
            settings.set_enable_media_stream(true);
        }
        webview.connect_permission_request(|webview, request| {
            let trusted_origin = webview
                .uri()
                .is_some_and(|uri| is_trusted_app_origin(uri.as_str()));
            if trusted_origin && request.is::<UserMediaPermissionRequest>() {
                request.allow();
                return true;
            }
            false
        });
        webview.reload();
    })
}
