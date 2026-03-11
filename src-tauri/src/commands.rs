use std::sync::Arc;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::services;
use crate::session_reader;
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// Allowed status values for agent status updates.
const ALLOWED_STATUSES: &[&str] = &[
    "created",
    "running",
    "completed",
    "failed",
    "stopped",
    "waiting_input",
    "error",
];

#[tauri::command]
pub fn get_status(state: State<Arc<AppState>>) -> CmdResult<String> {
    let db = state.db.lock()?;
    let agent_count: i64 =
        db.query_row("SELECT COUNT(*) FROM agents", [], |row| row.get(0))?;
    Ok(format!("Ready | {} agents", agent_count))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentConfig {
    pub name: String,
    pub role: Option<String>,
    pub model: Option<String>,
    pub project_id: Option<String>,
    pub system_prompt: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub dangerously_skip_permissions: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub model: String,
    pub status: String,
    pub project_id: Option<String>,
    pub session_id: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub dangerously_skip_permissions: bool,
}

/// Helper to map a rusqlite Row into an Agent struct.
/// Column order dependency: id(0), name(1), role(2), model(3), status(4),
/// project_id(5), session_id(6), created_at(7), dangerously_skip_permissions(8)
fn agent_from_row(row: &rusqlite::Row) -> rusqlite::Result<Agent> {
    Ok(Agent {
        id: row.get(0)?,
        name: row.get(1)?,
        role: row.get(2)?,
        model: row.get(3)?,
        status: row.get(4)?,
        project_id: row.get(5)?,
        session_id: row.get(6)?,
        created_at: row.get(7)?,
        dangerously_skip_permissions: row.get::<_, Option<bool>>(8)?.unwrap_or(false),
    })
}

#[tauri::command]
pub fn create_agent(config: AgentConfig, state: State<Arc<AppState>>) -> CmdResult<Agent> {
    let db = state.db.lock()?;
    let id = Uuid::new_v4().to_string();
    let model = config.model.unwrap_or_else(|| "sonnet".to_string());

    let config_json = serde_json::json!({
        "system_prompt": config.system_prompt,
        "allowed_tools": config.allowed_tools,
    });

    db.execute(
        "INSERT INTO agents (id, name, role, model, project_id, config_json, dangerously_skip_permissions) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, config.name, config.role, model, config.project_id, config_json.to_string(), config.dangerously_skip_permissions],
    )?;

    Ok(Agent {
        id,
        name: config.name,
        role: config.role,
        model,
        status: "created".to_string(),
        project_id: config.project_id,
        session_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        dangerously_skip_permissions: config.dangerously_skip_permissions,
    })
}

#[tauri::command]
pub fn list_agents(state: State<Arc<AppState>>) -> CmdResult<Vec<Agent>> {
    let db = state.db.lock()?;
    let mut stmt = db.prepare(
        "SELECT id, name, role, model, status, project_id, session_id, created_at, dangerously_skip_permissions FROM agents ORDER BY created_at DESC",
    )?;

    let agents = stmt
        .query_map([], agent_from_row)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(agents)
}

#[tauri::command]
pub fn get_agent(id: String, state: State<Arc<AppState>>) -> CmdResult<Agent> {
    let db = state.db.lock()?;
    let agent = db.query_row(
        "SELECT id, name, role, model, status, project_id, session_id, created_at, dangerously_skip_permissions FROM agents WHERE id = ?1",
        [&id],
        agent_from_row,
    )?;
    Ok(agent)
}

#[tauri::command]
pub fn delete_agent(id: String, state: State<Arc<AppState>>) -> CmdResult<()> {
    // Stop any running process for this agent first
    state.processes.stop_session(&id).ok();

    let db = state.db.lock()?;
    services::delete_agent_from_db(&db, &id).map_err(AppError::Other)?;
    Ok(())
}

#[tauri::command]
pub fn update_agent_status(
    id: String,
    status: String,
    state: State<Arc<AppState>>,
) -> CmdResult<()> {
    // Validate status against allowed values
    if !ALLOWED_STATUSES.contains(&status.as_str()) {
        return Err(AppError::Other(format!(
            "Invalid status '{}'. Allowed values: {:?}",
            status, ALLOWED_STATUSES
        )));
    }

    let db = state.db.lock()?;
    db.execute(
        "UPDATE agents SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![status, id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn start_agent(
    id: String,
    initial_prompt: Option<String>,
    state: State<Arc<AppState>>,
) -> CmdResult<String> {
    let db = state.db.lock()?;
    let session_id = services::start_agent_session(
        &db,
        &state.processes,
        &id,
        initial_prompt.as_deref(),
    )
    .map_err(AppError::Other)?;

    Ok(session_id)
}

#[tauri::command]
pub fn stop_agent(id: String, state: State<Arc<AppState>>) -> CmdResult<()> {
    let _ = state.processes.stop_session(&id);

    let db = state.db.lock()?;
    db.execute(
        "UPDATE agents SET status = 'stopped', session_id = NULL, updated_at = datetime('now') WHERE id = ?1",
        [&id],
    )?;

    Ok(())
}

#[tauri::command]
pub fn clear_agent_session(
    id: String,
    state: State<Arc<AppState>>,
) -> CmdResult<String> {
    // Stop the current process
    let _ = state.processes.stop_session(&id);

    // Clear conversation_id so the next spawn doesn't resume the old session
    let db = state.db.lock()?;
    db.execute(
        "UPDATE agents SET conversation_id = NULL, session_id = NULL, status = 'created', updated_at = datetime('now') WHERE id = ?1",
        [&id],
    )?;

    // Spawn a fresh session (no conversation_id = no --resume)
    let session_id = services::start_agent_session(&db, &state.processes, &id, None)
        .map_err(AppError::Other)?;

    Ok(session_id)
}

#[tauri::command]
pub async fn send_agent_message(
    id: String,
    message: String,
    images: Option<Vec<crate::claude_process::ImageAttachment>>,
    image_paths: Option<Vec<String>>,
    state: State<'_, Arc<AppState>>,
) -> CmdResult<()> {
    use crate::claude_process::ImageAttachment;

    // Clone what we need so we can move into spawn_blocking.
    let state = state.inner().clone();

    // Run all blocking work (file I/O, base64 encoding, stdin write) off the main thread.
    tokio::task::spawn_blocking(move || {
        let mut all_images: Vec<ImageAttachment> = images.unwrap_or_default();

        if let Some(paths) = image_paths {
            for path in paths {
                let ext = std::path::Path::new(&path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let media_type = match ext.as_str() {
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    "gif" => "image/gif",
                    "webp" => "image/webp",
                    _ => continue,
                };
                match std::fs::read(&path) {
                    Ok(bytes) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        all_images.push(ImageAttachment {
                            data,
                            media_type: media_type.to_string(),
                        });
                    }
                    Err(e) => {
                        log::warn!("Failed to read image '{}': {}", path, e);
                    }
                }
            }
        }

        if !state.processes.has_session(&id) {
            if all_images.is_empty() {
                let db = state.db.lock().map_err(|e| AppError::Other(e.to_string()))?;
                services::start_agent_session(&db, &state.processes, &id, None)
                    .map_err(AppError::Other)?;
                state.processes.send_message(&id, &message)
                    .map_err(AppError::Other)?;
                return Ok(());
            }
            let db = state.db.lock().map_err(|e| AppError::Other(e.to_string()))?;
            services::start_agent_session(&db, &state.processes, &id, None)
                .map_err(AppError::Other)?;
        }

        if all_images.is_empty() {
            state.processes.send_message(&id, &message)
                .map_err(AppError::Other)?;
        } else {
            state.processes.send_message_with_images(&id, &message, &all_images)
                .map_err(AppError::Other)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("Task join error: {}", e)))?
}

#[tauri::command]
pub fn interrupt_agent(id: String, state: State<Arc<AppState>>) -> CmdResult<()> {
    state.processes.interrupt(&id)
        .map_err(AppError::Other)?;
    Ok(())
}

// --- Session History ---

#[tauri::command]
pub fn load_session_history(
    agent_id: String,
    limit: Option<usize>,
    state: State<Arc<AppState>>,
) -> CmdResult<Vec<session_reader::SessionMessage>> {
    let (conversation_id, project_path) = {
        let db = state.db.lock()?;
        db.query_row(
            "SELECT a.conversation_id, p.path
             FROM agents a LEFT JOIN projects p ON a.project_id = p.id
             WHERE a.id = ?1",
            [&agent_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )?
    };

    let conversation_id = match conversation_id {
        Some(id) => id,
        None => return Ok(vec![]),
    };

    let working_dir = project_path.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| "/tmp".to_string())
    });

    let path = session_reader::compute_session_path(&working_dir, &conversation_id);

    if !path.exists() {
        log::warn!("Session file not found: {:?}", path);
        return Ok(vec![]);
    }

    session_reader::parse_session_file(&path, limit).map_err(AppError::Other)
}

// --- Project CRUD ---

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub workspace_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub created_at: String,
}

fn project_from_row(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        workspace_id: row.get(3)?,
        color: row.get(4)?,
        icon: row.get(5)?,
        created_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn register_project(
    name: String,
    path: String,
    workspace_id: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    state: State<Arc<AppState>>,
) -> CmdResult<Project> {
    // Canonicalize path and verify it exists and is a directory
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| AppError::Other(format!("Invalid path '{}': {}", path, e)))?;
    if !canonical.is_dir() {
        return Err(AppError::Other(format!("Path '{}' is not a directory", path)));
    }
    let canonical_str = canonical.to_string_lossy().to_string();

    let db = state.db.lock()?;
    let id = Uuid::new_v4().to_string();

    db.execute(
        "INSERT INTO projects (id, name, path, workspace_id, color, icon) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, name, canonical_str, workspace_id, color, icon],
    )?;

    Ok(Project {
        id,
        name,
        path: canonical_str,
        workspace_id,
        color,
        icon,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn list_projects(state: State<Arc<AppState>>) -> CmdResult<Vec<Project>> {
    let db = state.db.lock()?;
    let mut stmt = db.prepare(
        "SELECT id, name, path, workspace_id, color, icon, created_at FROM projects ORDER BY name",
    )?;

    let projects = stmt
        .query_map([], project_from_row)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

#[tauri::command]
pub fn delete_project(id: String, state: State<Arc<AppState>>) -> CmdResult<()> {
    let db = state.db.lock()?;
    db.execute("DELETE FROM projects WHERE id = ?1", [&id])?;
    Ok(())
}

// --- Canvas Positions ---

#[derive(Debug, Serialize, Deserialize)]
pub struct NodePosition {
    pub node_id: String,
    pub x: f64,
    pub y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub tier: Option<String>,
}

#[tauri::command]
pub fn load_canvas_positions(state: State<Arc<AppState>>) -> CmdResult<Vec<NodePosition>> {
    let db = state.db.lock()?;
    let mut stmt =
        db.prepare("SELECT node_id, x, y, width, height, tier FROM canvas_positions")?;

    let positions = stmt
        .query_map([], |row| {
            Ok(NodePosition {
                node_id: row.get(0)?,
                x: row.get(1)?,
                y: row.get(2)?,
                width: row.get(3)?,
                height: row.get(4)?,
                tier: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(positions)
}

#[tauri::command]
pub fn save_canvas_positions(
    positions: Vec<NodePosition>,
    state: State<Arc<AppState>>,
) -> CmdResult<()> {
    let db = state.db.lock()?;

    // Use RAII transaction instead of manual BEGIN/COMMIT/ROLLBACK
    let tx = db.unchecked_transaction().map_err(|e| AppError::Other(e.to_string()))?;

    for pos in &positions {
        tx.execute(
            "INSERT INTO canvas_positions (node_id, x, y, width, height, tier) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(node_id) DO UPDATE SET x = ?2, y = ?3, width = ?4, height = ?5, tier = ?6",
            rusqlite::params![pos.node_id, pos.x, pos.y, pos.width, pos.height, pos.tier],
        )?;
    }

    tx.commit()?;
    Ok(())
}

// --- Notification Preferences & Log ---

#[tauri::command]
pub fn get_notification_prefs(state: State<Arc<AppState>>) -> CmdResult<Vec<serde_json::Value>> {
    let db = state.db.lock()?;
    let mut stmt =
        db.prepare("SELECT id, event_type, channel, enabled FROM notification_prefs")?;

    let prefs = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "event_type": row.get::<_, String>(1)?,
                "channel": row.get::<_, String>(2)?,
                "enabled": row.get::<_, i64>(3)? == 1,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(prefs)
}

#[tauri::command]
pub fn set_notification_pref(
    event_type: String,
    channel: String,
    enabled: bool,
    state: State<Arc<AppState>>,
) -> CmdResult<()> {
    let db = state.db.lock()?;
    let id = format!("{}:{}", event_type, channel);
    db.execute(
        "INSERT INTO notification_prefs (id, event_type, channel, enabled) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET enabled = ?4",
        rusqlite::params![id, event_type, channel, enabled as i64],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_notification_log(
    limit: Option<i64>,
    state: State<Arc<AppState>>,
) -> CmdResult<Vec<serde_json::Value>> {
    let db = state.db.lock()?;
    let limit = limit.unwrap_or(50);
    let mut stmt = db.prepare(
        "SELECT id, event_type, title, body, agent_id, agent_name, read, created_at
         FROM notification_log ORDER BY created_at DESC LIMIT ?1",
    )?;

    let notifications = stmt
        .query_map([limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "event_type": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "body": row.get::<_, Option<String>>(3)?,
                "agent_id": row.get::<_, Option<String>>(4)?,
                "agent_name": row.get::<_, Option<String>>(5)?,
                "read": row.get::<_, i64>(6)? == 1,
                "created_at": row.get::<_, String>(7)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(notifications)
}

#[tauri::command]
pub fn log_notification(
    event_type: String,
    title: String,
    body: Option<String>,
    agent_id: Option<String>,
    agent_name: Option<String>,
    state: State<Arc<AppState>>,
) -> CmdResult<i64> {
    let db = state.db.lock()?;
    db.execute(
        "INSERT INTO notification_log (event_type, title, body, agent_id, agent_name) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![event_type, title, body, agent_id, agent_name],
    )?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn mark_notifications_read(state: State<Arc<AppState>>) -> CmdResult<()> {
    let db = state.db.lock()?;
    db.execute("UPDATE notification_log SET read = 1 WHERE read = 0", [])?;
    Ok(())
}

#[tauri::command]
pub fn get_unread_notification_count(state: State<Arc<AppState>>) -> CmdResult<i64> {
    let db = state.db.lock()?;
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM notification_log WHERE read = 0",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

// --- Update Project ---

#[tauri::command]
pub fn update_project(
    id: String,
    name: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    state: State<Arc<AppState>>,
) -> CmdResult<()> {
    let db = state.db.lock()?;

    // Build a single UPDATE query instead of up to 3 separate queries
    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref n) = name {
        sets.push(format!("name = ?{}", idx));
        values.push(Box::new(n.clone()));
        idx += 1;
    }
    if let Some(ref c) = color {
        sets.push(format!("color = ?{}", idx));
        values.push(Box::new(c.clone()));
        idx += 1;
    }
    if let Some(ref i) = icon {
        sets.push(format!("icon = ?{}", idx));
        values.push(Box::new(i.clone()));
        idx += 1;
    }

    if !sets.is_empty() {
        let sql = format!(
            "UPDATE projects SET {} WHERE id = ?{}",
            sets.join(", "),
            idx
        );
        values.push(Box::new(id));
        let params: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|v| v.as_ref()).collect();
        db.execute(&sql, params.as_slice())?;
    }

    Ok(())
}

#[derive(Serialize)]
pub struct FileBase64 {
    pub data: String,
    pub media_type: String,
}

#[tauri::command]
pub fn read_image_as_base64(path: String) -> CmdResult<FileBase64> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let media_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err(AppError::Other(format!("Unsupported image type: {}", ext))),
    };

    let bytes = std::fs::read(&path)
        .map_err(|e| AppError::Other(format!("Failed to read file '{}': {}", path, e)))?;

    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(FileBase64 {
        data,
        media_type: media_type.to_string(),
    })
}
