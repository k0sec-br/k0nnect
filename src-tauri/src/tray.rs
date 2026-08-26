use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager,
};

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir k0nnect", true, None::<&str>)?;
    let status = MenuItem::with_id(
        app,
        "status",
        "Status: aplicativo ativo",
        false,
        None::<&str>,
    )?;
    let mute = MenuItem::with_id(
        app,
        "mute-notifications",
        "Silenciar notificações",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Configurações", true, None::<&str>)?;
    let updates = MenuItem::with_id(
        app,
        "check-updates",
        "Verificar atualizações",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &status,
            &mute,
            &separator_one,
            &settings,
            &updates,
            &separator_two,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("k0nnect-tray")
        .icon(
            app.default_window_icon()
                .expect("ícone principal ausente")
                .clone(),
        )
        .tooltip("k0nnect")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "mute-notifications" => {
                let _ = app.emit("native:toggle-notifications", ());
            }
            "settings" => {
                show_main_window(app);
                let _ = app.emit("native:navigate", "/settings");
            }
            "check-updates" => {
                show_main_window(app);
                let _ = app.emit("native:check-updates", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn focus_main_window(app: &AppHandle) {
    show_main_window(app);
}
