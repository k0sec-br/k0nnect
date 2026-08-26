use tauri::{App, Manager};
use webview2_com::{
    take_pwstr, Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler,
    SetPermissionStateCompletedHandler,
};
use windows::core::{Interface, HSTRING};

use crate::media_origin::is_trusted_app_origin;

const TRUSTED_APP_ORIGINS: [&str; 3] = [
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:5174",
];

unsafe fn persist_application_permissions(core_webview: &ICoreWebView2) {
    let Ok(versioned_webview) = core_webview.cast::<ICoreWebView2_13>() else {
        return;
    };
    let Ok(profile) = versioned_webview.Profile() else {
        return;
    };
    let Ok(permission_profile) = profile.cast::<ICoreWebView2Profile4>() else {
        return;
    };

    for origin in TRUSTED_APP_ORIGINS {
        for permission_kind in [
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        ] {
            let completion_handler =
                SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(())));
            let _ = permission_profile.SetPermissionState(
                permission_kind,
                &HSTRING::from(origin),
                COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                &completion_handler,
            );
        }
    }
}

pub fn configure(app: &App) -> tauri::Result<()> {
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| tauri::Error::AssetNotFound("janela principal ausente".into()))?;

    webview.with_webview(|platform_webview| unsafe {
        let Ok(core_webview) = platform_webview.controller().CoreWebView2() else {
            return;
        };
        persist_application_permissions(&core_webview);
        let mut registration_token = 0;
        let permission_handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut uri = Default::default();
            args.Uri(&mut uri)?;
            if !is_trusted_app_origin(&take_pwstr(uri)) {
                return Ok(());
            }

            let mut permission_kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut permission_kind)?;
            if matches!(
                permission_kind,
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE | COREWEBVIEW2_PERMISSION_KIND_CAMERA
            ) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let _ = core_webview.add_PermissionRequested(&permission_handler, &mut registration_token);
    })
}
