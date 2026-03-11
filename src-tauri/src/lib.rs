mod claude_process;
mod commands;
mod db;
mod error;
mod event_router;
mod services;
mod session_reader;
mod socket_server;
mod state;
mod tray;

use state::AppState;
use std::sync::Arc;
use tauri::{Listener, Manager};
use tauri_plugin_decorum::WebviewWindowExt;
use tokio_util::sync::CancellationToken;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_haptics::init());
    }

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            // Position macOS traffic lights to align with custom titlebar
            let Some(main_window) = app.get_webview_window("main") else {
                return Err("main window not found".into());
            };
            main_window.create_overlay_titlebar().map_err(|e| e.to_string())?;
            #[cfg(target_os = "macos")]
            main_window.set_traffic_lights_inset(16.0, 18.0).map_err(|e| e.to_string())?;

            let app_handle = app.handle().clone();
            let app_state = AppState::new(app_handle)?;
            let state_arc = Arc::new(app_state);

            // Listen for conversation_id_captured events and persist to DB
            let db_state = state_arc.clone();
            app.listen("conversation_id_captured", move |event| {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    if let (Some(agent_id), Some(conv_id)) = (
                        payload["agent_id"].as_str(),
                        payload["conversation_id"].as_str(),
                    ) {
                        if let Ok(db) = db_state.db.lock() {
                            let _ = db.execute(
                                "UPDATE agents SET conversation_id = ?1 WHERE id = ?2",
                                rusqlite::params![conv_id, agent_id],
                            );
                        }
                    }
                }
            });

            // Start the TCP server for CLI communication with cancellation support
            let socket_state = state_arc.clone();
            let cancel_token = CancellationToken::new();
            let cancel_clone = cancel_token.clone();
            tauri::async_runtime::spawn(async move {
                socket_server::start(socket_state, cancel_clone).await;
            });

            // Store cancel token for shutdown
            app.manage(cancel_token);
            app.manage(state_arc);

            // Set up system tray
            if let Err(e) = tray::setup_tray(app.handle()) {
                log::error!("Failed to set up system tray: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::create_agent,
            commands::list_agents,
            commands::get_agent,
            commands::delete_agent,
            commands::update_agent_status,
            commands::start_agent,
            commands::stop_agent,
            commands::clear_agent_session,
            commands::send_agent_message,
            commands::interrupt_agent,
            commands::register_project,
            commands::list_projects,
            commands::delete_project,
            commands::update_project,
            commands::load_canvas_positions,
            commands::save_canvas_positions,
            commands::load_session_history,
            commands::get_notification_prefs,
            commands::set_notification_pref,
            commands::get_notification_log,
            commands::log_notification,
            commands::mark_notifications_read,
            commands::get_unread_notification_count,
            commands::read_image_as_base64,
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Failed to build tauri application: {}", e);
            std::process::exit(1);
        })
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                // Cancel the socket server
                if let Some(cancel) = app.try_state::<CancellationToken>() {
                    cancel.cancel();
                }
                // Clean up port file
                socket_server::cleanup_port_file();
                // Shut down all processes
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    state.processes.shutdown();
                }
            }
        });
}
