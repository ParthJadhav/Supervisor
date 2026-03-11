use rusqlite::Connection;
use serde_json::Value;

use crate::claude_process::{ProcessManager, SpawnConfig};

/// Helper to map a rusqlite Row into a JSON Value for agents.
/// Column order dependency: id(0), name(1), role(2), model(3), status(4),
/// project_id(5), session_id(6), created_at(7), dangerously_skip_permissions(8)
pub fn agent_from_row(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, String>(0)?,
        "name": row.get::<_, String>(1)?,
        "role": row.get::<_, Option<String>>(2)?,
        "model": row.get::<_, String>(3)?,
        "status": row.get::<_, String>(4)?,
        "project_id": row.get::<_, Option<String>>(5)?,
        "session_id": row.get::<_, Option<String>>(6)?,
        "created_at": row.get::<_, String>(7)?,
        "dangerously_skip_permissions": row.get::<_, Option<bool>>(8)?.unwrap_or(false),
    }))
}

/// Resolve an agent identifier to its UUID. Accepts either a UUID or a name.
/// Caller must provide the already-locked database connection.
pub fn resolve_agent_id(id_or_name: &str, db: &Connection) -> Result<String, String> {
    // Try as UUID first
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE id = ?1",
            [id_or_name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok(id_or_name.to_string());
    }
    // Try as name
    db.query_row(
        "SELECT id FROM agents WHERE name = ?1 COLLATE NOCASE",
        [id_or_name],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| format!("Agent '{}' not found", id_or_name))
}

/// The SQL query for listing agents, shared between commands.rs and socket_server.rs.
pub const LIST_AGENTS_SQL: &str =
    "SELECT id, name, role, model, status, project_id, session_id, created_at, dangerously_skip_permissions FROM agents ORDER BY created_at DESC";

/// Delete an agent from the database, cleaning up related rows.
/// Caller must provide the already-locked database connection.
pub fn delete_agent_from_db(db: &Connection, id: &str) -> Result<(), String> {
    db.execute(
        "UPDATE tasks SET agent_id = NULL WHERE agent_id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM canvas_positions WHERE node_id = ?1",
        [&format!("agent-{}", id)],
    )
    .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM notification_log WHERE agent_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM agents WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Build a SpawnConfig and start an agent session. Returns (session_id).
/// Caller must provide the already-locked database connection.
pub fn start_agent_session(
    db: &Connection,
    processes: &ProcessManager,
    agent_id: &str,
    initial_prompt: Option<&str>,
) -> Result<String, String> {
    let (name, model, config_json, project_path, conversation_id, dangerously_skip_permissions) = db
        .query_row(
            "SELECT a.name, a.model, a.config_json, p.path, a.conversation_id, a.dangerously_skip_permissions
             FROM agents a LEFT JOIN projects p ON a.project_id = p.id
             WHERE a.id = ?1",
            [agent_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<bool>>(5)?.unwrap_or(false),
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let config: Value = config_json
        .as_deref()
        .and_then(|c| serde_json::from_str(c).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let system_prompt = format!(
        "You are {}. {}",
        name,
        config["system_prompt"].as_str().unwrap_or("")
    );

    let working_dir = project_path.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| "/tmp".to_string())
    });

    let allowed_tools: Option<Vec<String>> = config["allowed_tools"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

    let spawn_config = SpawnConfig {
        model,
        system_prompt,
        working_dir,
        allowed_tools,
        conversation_id,
        dangerously_skip_permissions,
    };

    let session_id = processes.spawn_session(agent_id, &spawn_config)?;

    // Send initial prompt if provided
    if let Some(prompt) = initial_prompt {
        processes.send_message(agent_id, prompt)?;
    }

    // Update DB status
    db.execute(
        "UPDATE agents SET status = 'running', session_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![session_id, agent_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(session_id)
}
