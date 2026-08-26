use tauri::{App, Manager};
use webview2_com::{
    take_pwstr, ClearBrowsingDataCompletedHandler, Microsoft::Web::WebView2::Win32::*,
    PermissionRequestedEventHandler, SetPermissionStateCompletedHandler,
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

unsafe fn disable_browser_credentials(core_webview: &ICoreWebView2) {
    if let Ok(settings) = core_webview.Settings() {
        if let Ok(autofill_settings) = settings.cast::<ICoreWebView2Settings4>() {
            let _ = autofill_settings.SetIsPasswordAutosaveEnabled(false);
            let _ = autofill_settings.SetIsGeneralAutofillEnabled(false);
        }
    }

    let Ok(versioned_webview) = core_webview.cast::<ICoreWebView2_13>() else {
        return;
    };
    let Ok(profile) = versioned_webview.Profile() else {
        return;
    };
    if let Ok(autofill_profile) = profile.cast::<ICoreWebView2Profile6>() {
        let _ = autofill_profile.SetIsPasswordAutosaveEnabled(false);
        let _ = autofill_profile.SetIsGeneralAutofillEnabled(false);
    }
    if let Ok(browsing_data_profile) = profile.cast::<ICoreWebView2Profile2>() {
        let credential_data = COREWEBVIEW2_BROWSING_DATA_KINDS(
            COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE.0
                | COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL.0,
        );
        let completion_handler = ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(())));
        let _ = browsing_data_profile.ClearBrowsingData(credential_data, &completion_handler);
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
        disable_browser_credentials(&core_webview);
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
