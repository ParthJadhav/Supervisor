use rusqlite::Connection;
use std::sync::Mutex;
use tauri::AppHandle;

use crate::claude_process::ProcessManager;
use crate::db;

pub struct AppState {
    /// Database connection protected by std::sync::Mutex.
    /// This is intentionally a std::sync::Mutex (not tokio::sync::Mutex) because:
    /// - This is a desktop app with low concurrency (single user)
    /// - All DB operations are fast (sub-millisecond) so holding across .await is not a concern
    /// - rusqlite::Connection is !Send, which makes it incompatible with tokio::sync::Mutex
    /// - The mutex is only briefly held for individual queries, never across async boundaries
    pub db: Mutex<Connection>,
    pub processes: ProcessManager,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let db = db::init_database()?;
        Ok(Self {
            db: Mutex::new(db),
            processes: ProcessManager::new(app_handle),
        })
    }
}
