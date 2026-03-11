use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::state::AppState;

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<Arc<AppState>>();
    let (agents_total, agents_running) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let total: i64 = db
            .query_row("SELECT COUNT(*) FROM agents", [], |row| row.get(0))?;
        let running: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE status = 'running'",
                [],
                |row| row.get(0),
            )?;
        (total, running)
    };

    let status_text = format!("{} running / {} total", agents_running, agents_total);
    let status_item = MenuItem::with_id(app, "status", &status_text, false, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Supervisor", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&status_item, &show_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .title(agents_running.to_string())
        .tooltip("Supervisor")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
