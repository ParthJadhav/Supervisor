use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::services;
use crate::state::AppState;

/// Returns the path to the port file used for CLI discovery.
fn port_file_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".supervisor").join("supervisor.port"))
}

/// Remove the port file if it exists.
pub fn cleanup_port_file() {
    if let Some(path) = port_file_path() {
        if path.exists() {
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!("Failed to remove port file: {}", e);
            }
        }
    }
}

/// Start the TCP server on localhost with an OS-assigned port.
/// Writes the port number to ~/.supervisor/supervisor.port for CLI discovery.
pub async fn start(state: Arc<AppState>, cancel: CancellationToken) {
    let supervisor_dir = match dirs::home_dir() {
        Some(h) => h.join(".supervisor"),
        None => {
            log::error!("socket_server: cannot determine home directory");
            return;
        }
    };

    if let Err(e) = std::fs::create_dir_all(&supervisor_dir) {
        log::error!("socket_server: failed to create directory: {}", e);
        return;
    }

    // Bind to localhost with port 0 to let the OS assign an available port
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            log::error!("socket_server: failed to bind TCP listener: {}", e);
            return;
        }
    };

    let local_addr = match listener.local_addr() {
        Ok(addr) => addr,
        Err(e) => {
            log::error!("socket_server: failed to get local address: {}", e);
            return;
        }
    };

    // Write port to file so the CLI can discover it
    let port_path = supervisor_dir.join("supervisor.port");
    if let Err(e) = std::fs::write(&port_path, local_addr.port().to_string()) {
        log::error!("socket_server: failed to write port file: {}", e);
        return;
    }

    log::info!("Socket server listening at {}", local_addr);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                log::info!("Socket server shutting down");
                break;
            }
            result = listener.accept() => {
                match result {
                    Ok((stream, _addr)) => {
                        let state = state.clone();
                        tokio::spawn(async move {
                            handle_connection(stream, state).await;
                        });
                    }
                    Err(e) => {
                        log::error!("socket_server: accept error: {}", e);
                    }
                }
            }
        }
    }

    // Clean up port file on exit
    cleanup_port_file();
}

async fn handle_connection(stream: tokio::net::TcpStream, state: Arc<AppState>) {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<RpcIncoming>(&line) {
            Ok(req) => {
                let id = req.id.clone();
                let result = dispatch(&req.method, req.params.unwrap_or(Value::Null), &state);
                match result {
                    Ok(val) => RpcOutgoing {
                        jsonrpc: "2.0",
                        id,
                        result: Some(val),
                        error: None,
                    },
                    Err(e) => RpcOutgoing {
                        jsonrpc: "2.0",
                        id,
                        result: None,
                        error: Some(RpcOutError {
                            code: -32000,
                            message: e,
                        }),
                    },
                }
            }
            Err(e) => RpcOutgoing {
                jsonrpc: "2.0",
                id: None,
                result: None,
                error: Some(RpcOutError {
                    code: -32700,
                    message: format!("Parse error: {}", e),
                }),
            },
        };

        let mut json = match serde_json::to_string(&response) {
            Ok(j) => j,
            Err(_) => continue,
        };
        json.push('\n');

        if writer.write_all(json.as_bytes()).await.is_err() {
            break;
        }
    }
}

// ── JSON-RPC types for the socket protocol ──────────────────────────────────

#[derive(Deserialize)]
struct RpcIncoming {
    #[expect(dead_code, reason = "required by JSON-RPC protocol but unused in dispatch")]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct RpcOutgoing {
    jsonrpc: &'static str,
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcOutError>,
}

#[derive(Serialize)]
struct RpcOutError {
    code: i64,
    message: String,
}

// ── Dispatch ────────────────────────────────────────────────────────────────

fn dispatch(method: &str, params: Value, state: &AppState) -> Result<Value, String> {
    match method {
        "get_status" => handle_get_status(state),
        "list_agents" => handle_list_agents(state),
        "list_projects" => handle_list_projects(state),
        "create_task" => handle_create_task(params, state),
        "list_tasks" => handle_list_tasks(params, state),
        "create_agent" => handle_create_agent(params, state),
        "delete_agent" => handle_delete_agent(params, state),
        "start_agent" => handle_start_agent(params, state),
        "stop_agent" => handle_stop_agent(params, state),
        "send_agent_message" => handle_send_agent_message(params, state),
        "register_project" => handle_register_project(params, state),
        "delete_project" => handle_delete_project(params, state),
        _ => Err(format!("Unknown method: {}", method)),
    }
}

// ── Handlers ────────────────────────────────────────────────────────────────

fn handle_get_status(state: &AppState) -> Result<Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let agents_total: i64 = db
        .query_row("SELECT COUNT(*) FROM agents", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let agents_running: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE status = 'running'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let tasks_active: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE status IN ('planned', 'in_progress')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "agents_total": agents_total,
        "agents_running": agents_running,
        "tasks_active": tasks_active,
    }))
}

fn handle_list_agents(state: &AppState) -> Result<Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(services::LIST_AGENTS_SQL)
        .map_err(|e| e.to_string())?;

    let agents: Vec<Value> = stmt
        .query_map([], services::agent_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(Value::Array(agents))
}

fn handle_list_projects(state: &AppState) -> Result<Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, name, path, workspace_id, color, icon, created_at FROM projects ORDER BY name")
        .map_err(|e| e.to_string())?;

    let projects: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "path": row.get::<_, String>(2)?,
                "workspace_id": row.get::<_, Option<String>>(3)?,
                "color": row.get::<_, Option<String>>(4)?,
                "icon": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(Value::Array(projects))
}

fn handle_create_task(params: Value, state: &AppState) -> Result<Value, String> {
    let title = params["title"]
        .as_str()
        .ok_or("missing required param: title")?;
    let description = params["description"].as_str();
    let priority = params["priority"].as_i64().unwrap_or(3);
    let project_id = params["project_id"].as_str();

    let db = state.db.lock().map_err(|e| e.to_string())?;

    let agent_id = params["agent_id"]
        .as_str()
        .map(|id| services::resolve_agent_id(id, &db))
        .transpose()?;
    let agent_id = agent_id.as_deref();

    let id = Uuid::new_v4().to_string();

    db.execute(
        "INSERT INTO tasks (id, title, description, priority, agent_id, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, title, description, priority, agent_id, project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "id": id,
        "title": title,
        "description": description,
        "status": "planned",
        "priority": priority,
        "agent_id": agent_id,
        "project_id": project_id,
    }))
}

fn handle_list_tasks(params: Value, state: &AppState) -> Result<Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let status_filter = params["status"].as_str();

    let tasks: Vec<Value> = if let Some(status) = status_filter {
        let mut stmt = db
            .prepare(
                "SELECT id, title, description, status, priority, agent_id, project_id, created_at
                 FROM tasks WHERE status = ?1 ORDER BY priority ASC, created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let result = stmt.query_map([status], row_to_task_json)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    } else {
        let mut stmt = db
            .prepare(
                "SELECT id, title, description, status, priority, agent_id, project_id, created_at
                 FROM tasks ORDER BY priority ASC, created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let result = stmt.query_map([], row_to_task_json)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };

    Ok(Value::Array(tasks))
}

fn row_to_task_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, String>(0)?,
        "title": row.get::<_, String>(1)?,
        "description": row.get::<_, Option<String>>(2)?,
        "status": row.get::<_, String>(3)?,
        "priority": row.get::<_, i64>(4)?,
        "agent_id": row.get::<_, Option<String>>(5)?,
        "project_id": row.get::<_, Option<String>>(6)?,
        "created_at": row.get::<_, String>(7)?,
    }))
}

fn handle_create_agent(params: Value, state: &AppState) -> Result<Value, String> {
    let name = params["name"]
        .as_str()
        .ok_or("missing required param: name")?;
    let role = params["role"].as_str();
    let model = params["model"].as_str().unwrap_or("sonnet");
    let project_id = params["project_id"].as_str();
    let system_prompt = params["system_prompt"].as_str();
    let allowed_tools = params["allowed_tools"].as_array();
    let dangerously_skip_permissions = params["dangerously_skip_permissions"].as_bool().unwrap_or(false);

    let id = Uuid::new_v4().to_string();
    let config_json = serde_json::json!({
        "system_prompt": system_prompt,
        "allowed_tools": allowed_tools,
    });

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO agents (id, name, role, model, project_id, config_json, dangerously_skip_permissions)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, name, role, model, project_id, config_json.to_string(), dangerously_skip_permissions],
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "id": id,
        "name": name,
        "role": role,
        "model": model,
        "status": "created",
        "project_id": project_id,
        "dangerously_skip_permissions": dangerously_skip_permissions,
    }))
}

fn handle_delete_agent(params: Value, state: &AppState) -> Result<Value, String> {
    let id_or_name = params["id"]
        .as_str()
        .ok_or("missing required param: id")?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = services::resolve_agent_id(id_or_name, &db)?;

    // Stop any running process before deleting
    let _ = state.processes.stop_session(&id);

    services::delete_agent_from_db(&db, &id)?;

    Ok(serde_json::json!({ "deleted": true }))
}

fn handle_start_agent(params: Value, state: &AppState) -> Result<Value, String> {
    let id_or_name = params["id"]
        .as_str()
        .ok_or("missing required param: id")?;
    let initial_prompt = params["initialPrompt"].as_str();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = services::resolve_agent_id(id_or_name, &db)?;

    let session_id = services::start_agent_session(&db, &state.processes, &id, initial_prompt)?;

    Ok(serde_json::json!({ "session_id": session_id }))
}

fn handle_stop_agent(params: Value, state: &AppState) -> Result<Value, String> {
    let id_or_name = params["id"]
        .as_str()
        .ok_or("missing required param: id")?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = services::resolve_agent_id(id_or_name, &db)?;

    let _ = state.processes.stop_session(&id);

    db.execute(
        "UPDATE agents SET status = 'stopped', session_id = NULL, updated_at = datetime('now') WHERE id = ?1",
        [id.as_str()],
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "stopped": true }))
}

fn handle_send_agent_message(params: Value, state: &AppState) -> Result<Value, String> {
    let id_or_name = params["id"]
        .as_str()
        .ok_or("missing required param: id")?;
    let message = params["message"]
        .as_str()
        .ok_or("missing required param: message")?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = services::resolve_agent_id(id_or_name, &db)?;

    if state.processes.has_session(&id) {
        state.processes.send_message(&id, message)?;
        Ok(serde_json::json!({ "sent": true }))
    } else {
        // Auto-start the agent with this message as the initial prompt
        let session_id = services::start_agent_session(&db, &state.processes, &id, Some(message))?;
        Ok(serde_json::json!({ "sent": true, "auto_started": true, "session_id": session_id }))
    }
}

fn handle_register_project(params: Value, state: &AppState) -> Result<Value, String> {
    let name = params["name"]
        .as_str()
        .ok_or("missing required param: name")?;
    let path = params["path"]
        .as_str()
        .ok_or("missing required param: path")?;
    let workspace_id = params["workspace_id"].as_str();

    // Validate path exists and is a directory
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Invalid path '{}': {}", path, e))?;
    if !canonical.is_dir() {
        return Err(format!("Path '{}' is not a directory", path));
    }
    let canonical_str = canonical.to_string_lossy().to_string();

    let id = Uuid::new_v4().to_string();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO projects (id, name, path, workspace_id) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, canonical_str, workspace_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "id": id,
        "name": name,
        "path": canonical_str,
        "workspace_id": workspace_id,
    }))
}

fn handle_delete_project(params: Value, state: &AppState) -> Result<Value, String> {
    let id = params["id"]
        .as_str()
        .ok_or("missing required param: id")?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Unassign agents and tasks from this project
    db.execute(
        "UPDATE agents SET project_id = NULL WHERE project_id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE tasks SET project_id = NULL WHERE project_id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    let changed = db
        .execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    if changed == 0 {
        return Err(format!("Project {} not found", id));
    }

    Ok(serde_json::json!({ "deleted": true }))
}
