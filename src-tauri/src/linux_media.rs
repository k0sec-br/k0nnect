use tauri::{App, Manager};
use webkit2gtk::{
    glib::ObjectExt, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt,
};

pub fn configure(app: &App) -> tauri::Result<()> {
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| tauri::Error::AssetNotFound("janela principal ausente".into()))?;

    webview.with_webview(|platform_webview| {
        let webview = platform_webview.inner();
        if let Some(settings) = webview.settings() {
            settings.set_enable_media_stream(true);
        }
        webview.connect_permission_request(|_, request| {
            if request.is::<UserMediaPermissionRequest>() {
                request.allow();
                return true;
            }
            false
        });
    })
}
