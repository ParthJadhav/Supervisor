use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// Tracks the last-seen session_id per agent.
/// A system init with a DIFFERENT session_id means the user ran /clear.
/// A system init with the SAME session_id is just a new turn.
static AGENT_SESSION_IDS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Remove an agent from the session tracking (call when process exits).
pub fn clear_agent_init_state(agent_id: &str) {
    if let Ok(mut map) = AGENT_SESSION_IDS.lock() {
        map.remove(agent_id);
    }
}

/// Maps a Claude stream-json NDJSON event to one or more Tauri events.
pub fn route_event(handle: &AppHandle, agent_id: &str, event: &Value) {
    let event_type = event["type"].as_str().unwrap_or("");
    match event_type {
        "system" => handle_system_event(handle, agent_id, event),
        "stream_event" => handle_stream_event(handle, agent_id, event),
        "assistant" => handle_assistant_event(handle, agent_id, event),
        "user" => handle_user_event(handle, agent_id, event),
        "result" => handle_result_event(handle, agent_id, event),
        "rate_limit" => handle_rate_limit_event(handle, agent_id, event),
        _ => {}
    }
}

/// Emit a Tauri event with logging on failure.
fn emit_event(handle: &AppHandle, event_name: &str, agent_id: &str, payload: Value) {
    if let Err(e) = handle.emit(event_name, payload) {
        log::warn!("Failed to emit '{}' for agent {}: {}", event_name, agent_id, e);
    }
}

fn handle_system_event(handle: &AppHandle, agent_id: &str, event: &Value) {
    let subtype = event["subtype"].as_str().unwrap_or("");
    if subtype == "init" {
        // Detect /clear: compare session_id with previously seen value.
        // Same session_id = new turn in same conversation (no clear).
        // Different session_id = conversation was cleared and restarted.
        if let Some(new_session_id) = event["session_id"].as_str() {
            let is_clear = {
                let mut map = AGENT_SESSION_IDS.lock().unwrap_or_else(|e| e.into_inner());
                let prev = map.insert(agent_id.to_string(), new_session_id.to_string());
                prev.is_some_and(|old| old != new_session_id)
            };

            if is_clear {
                emit_event(handle, "session_cleared", agent_id, json!({
                    "agent_id": agent_id,
                }));
            }
        }

        // Claude Code sends slash_commands as an array of strings (just names).
        // Convert to array of {name, description} objects for the frontend,
        // deduplicating since Claude Code may send duplicates.
        let slash_commands = event["slash_commands"]
            .as_array()
            .map(|arr| {
                let mut seen = HashSet::new();
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|name| seen.insert(name.to_string()))
                    .map(|name| json!({ "name": name, "description": "" }))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        emit_event(handle, "session_init", agent_id, json!({
            "agent_id": agent_id,
            "model": event["model"],
            "slash_commands": slash_commands,
            "tools": event["tools"],
            "mcp_servers": event["mcp_servers"],
        }));

        if let Some(session_id) = event["session_id"].as_str() {
            emit_event(handle, "conversation_id_captured", agent_id, json!({
                "agent_id": agent_id,
                "conversation_id": session_id,
            }));
        }

        emit_event(handle, "session_state", agent_id, json!({
            "agent_id": agent_id,
            "status": "running",
        }));
    }
}

fn handle_stream_event(handle: &AppHandle, agent_id: &str, event: &Value) {
    if let Some(delta) = event["event"]["delta"]["text"].as_str() {
        emit_event(handle, "session_output", agent_id, json!({
            "agent_id": agent_id,
            "data": delta,
            "streaming": true,
        }));
    }
}

fn handle_assistant_event(handle: &AppHandle, agent_id: &str, event: &Value) {
    if let Some(usage) = event["message"]["usage"].as_object() {
        emit_event(handle, "session_usage", agent_id, json!({
            "agent_id": agent_id,
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "cache_read": usage.get("cache_read_input_tokens"),
            "cache_creation": usage.get("cache_creation_input_tokens"),
        }));
    }

    // Extract tool_use blocks from content.
    // NOTE: We do NOT emit text blocks here -- they duplicate what stream_event already delivered.
    if let Some(content) = event["message"]["content"].as_array() {
        for block in content {
            if block["type"].as_str() == Some("tool_use") {
                emit_event(handle, "session_tool_use", agent_id, json!({
                    "agent_id": agent_id,
                    "tool_call_id": block["id"],
                    "tool_name": block["name"],
                    "tool_input": block["input"].to_string(),
                    "status": "running",
                }));
            }
        }
    }
}

fn handle_user_event(handle: &AppHandle, agent_id: &str, event: &Value) {
    if let Some(content) = event["message"]["content"].as_array() {
        for block in content {
            if block["type"].as_str() == Some("tool_result") {
                let output = if let Some(s) = block["content"].as_str() {
                    s.to_string()
                } else {
                    block["content"].to_string()
                };

                emit_event(handle, "session_tool_result", agent_id, json!({
                    "agent_id": agent_id,
                    "tool_call_id": block["tool_use_id"],
                    "output": output,
                    "is_error": block["is_error"].as_bool().unwrap_or(false),
                }));
            }
        }
    }
}

fn handle_result_event(handle: &AppHandle, agent_id: &str, event: &Value) {
    emit_event(handle, "session_result", agent_id, json!({
        "agent_id": agent_id,
        "cost_usd": event["total_cost_usd"],
        "model_usage": event["modelUsage"],
        "duration_ms": event["duration_ms"],
        "is_cumulative_cost": true,
    }));

    emit_event(handle, "session_state", agent_id, json!({
        "agent_id": agent_id,
        "status": "idle",
    }));
}

fn handle_rate_limit_event(handle: &AppHandle, agent_id: &str, event: &Value) {
    emit_event(handle, "session_rate_limit", agent_id, json!({
        "agent_id": agent_id,
        "status": event["status"],
        "resets_at": event["resetsAt"],
        "type": event["rateLimitType"],
    }));
}
