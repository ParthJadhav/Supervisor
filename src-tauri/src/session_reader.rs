use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<SessionToolCall>,
    /// Number of images attached to this message (for UI display).
    /// Actual image data is not transferred to avoid large IPC payloads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionToolCall {
    pub id: String,
    pub name: String,
    pub input: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    pub status: String,
    pub is_error: bool,
}

/// Encode a project path the same way Claude Code does:
/// `/Users/foo/dev/app` → `-Users-foo-dev-app`
/// Handles both Unix (`/`) and Windows (`\`) path separators.
fn encode_path(path: &str) -> String {
    path.replace('/', "-").replace('\\', "-")
}

/// Compute the session file path for a given project path and conversation id.
pub fn compute_session_path(project_path: &str, conversation_id: &str) -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let encoded = encode_path(project_path);
    home.join(".claude")
        .join("projects")
        .join(encoded)
        .join(format!("{}.jsonl", conversation_id))
}

const MAX_TOOL_OUTPUT_LEN: usize = 2000;

/// Tracks state while building the session message list.
struct SessionParser {
    messages: Vec<SessionMessage>,
    /// Maps tool_use_id → index in `messages`
    tool_use_index: HashMap<String, usize>,
    /// Dedup tracking for streamed assistant messages
    last_assistant_msg_id: Option<String>,
    last_assistant_idx: Option<usize>,
}

impl SessionParser {
    fn new() -> Self {
        Self {
            messages: Vec::new(),
            tool_use_index: HashMap::new(),
            last_assistant_msg_id: None,
            last_assistant_idx: None,
        }
    }

    fn process_line(&mut self, v: &Value) {
        let line_type = v["type"].as_str().unwrap_or("");

        match line_type {
            "progress" | "system" | "file-history-snapshot" | "queue-operation" => {},
            "user" => self.process_user_event(v),
            "assistant" => self.process_assistant_event(v),
            _ => {}
        }
    }

    fn process_user_event(&mut self, v: &Value) {
        if v["isMeta"].as_bool().unwrap_or(false) {
            return;
        }

        let content = &v["message"]["content"];
        let timestamp = v["timestamp"].as_str().unwrap_or("").to_string();
        let uuid = v["uuid"].as_str().unwrap_or("").to_string();

        // Array content: could be tool results OR multimodal (image + text)
        if let Some(arr) = content.as_array() {
            let has_tool_results = arr.iter().any(|b| b["type"].as_str() == Some("tool_result"));
            if has_tool_results {
                self.process_tool_results(content);
                return;
            }

            // Extract text blocks and count images from multimodal content
            let mut text_parts: Vec<String> = Vec::new();
            let mut image_count: usize = 0;

            for block in arr {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = block["text"].as_str() {
                            if !t.is_empty() {
                                text_parts.push(t.to_string());
                            }
                        }
                    }
                    Some("image") => {
                        image_count += 1;
                    }
                    _ => {}
                }
            }

            let text = text_parts.join("\n");
            if text.is_empty() && image_count == 0 {
                return;
            }

            self.messages.push(SessionMessage {
                id: uuid,
                role: "user".to_string(),
                content: text,
                timestamp,
                tool_call: None,
                image_count: if image_count > 0 { Some(image_count) } else { None },
            });
            self.last_assistant_msg_id = None;
            self.last_assistant_idx = None;
            return;
        }

        let text = extract_user_text(content);
        if text.is_empty() {
            return;
        }

        // Skip local-command messages
        if text.contains("<local-command-") || text.contains("<command-name>") {
            return;
        }

        self.messages.push(SessionMessage {
            id: uuid,
            role: "user".to_string(),
            content: text,
            timestamp,
            tool_call: None,
            image_count: None,
        });
        self.last_assistant_msg_id = None;
        self.last_assistant_idx = None;
    }

    fn process_tool_results(&mut self, content: &Value) {
        let Some(blocks) = content.as_array() else { return };

        for block in blocks {
            if block["type"].as_str() != Some("tool_result") {
                continue;
            }

            let tool_use_id = block["tool_use_id"].as_str().unwrap_or("").to_string();
            let is_error = block["is_error"].as_bool().unwrap_or(false);
            let output = extract_tool_result_text(&block["content"]);

            if let Some(&idx) = self.tool_use_index.get(&tool_use_id) {
                if let Some(tc) = self.messages[idx].tool_call.as_mut() {
                    tc.output = Some(truncate_output(&output, MAX_TOOL_OUTPUT_LEN).into_owned());
                    tc.status = if is_error { "error" } else { "completed" }.to_string();
                    tc.is_error = is_error;
                }
            }
        }
    }

    fn process_assistant_event(&mut self, v: &Value) {
        let msg = &v["message"];
        let msg_id = msg["id"].as_str().unwrap_or("").to_string();
        let timestamp = v["timestamp"].as_str().unwrap_or("").to_string();
        let uuid = v["uuid"].as_str().unwrap_or("").to_string();

        let Some(content_arr) = msg["content"].as_array() else { return };

        let (combined_text, tool_uses) = extract_assistant_content(content_arr);

        // Deduplicate: if same message.id as last assistant, update in place
        if !msg_id.is_empty() && self.last_assistant_msg_id.as_deref() == Some(&msg_id) {
            if let Some(idx) = self.last_assistant_idx {
                if !combined_text.is_empty() {
                    self.messages[idx].content.clone_from(&combined_text);
                }
                self.messages[idx].timestamp.clone_from(&timestamp);
            }
        } else if !combined_text.is_empty() {
            let idx = self.messages.len();
            self.messages.push(SessionMessage {
                id: uuid.clone(),
                role: "assistant".to_string(),
                content: combined_text,
                timestamp: timestamp.clone(),
                tool_call: None,
                image_count: None,
            });
            if !msg_id.is_empty() {
                self.last_assistant_msg_id = Some(msg_id.clone());
                self.last_assistant_idx = Some(idx);
            }
        }

        // Add tool_use messages
        for (tc_id, tc_name, tc_input) in tool_uses {
            let idx = self.messages.len();
            self.tool_use_index.insert(tc_id.clone(), idx);
            self.messages.push(SessionMessage {
                id: format!("tool-{}", tc_id),
                role: "tool".to_string(),
                content: String::new(),
                timestamp: timestamp.clone(),
                tool_call: Some(SessionToolCall {
                    id: tc_id,
                    name: tc_name,
                    input: truncate_output(&tc_input, MAX_TOOL_OUTPUT_LEN).into_owned(),
                    output: None,
                    status: "completed".to_string(),
                    is_error: false,
                }),
                image_count: None,
            });
        }

        // Reset dedup tracking at message boundaries
        let stop_reason = msg["stop_reason"].as_str();
        if stop_reason == Some("tool_use") || stop_reason == Some("end_turn") {
            self.last_assistant_msg_id = None;
            self.last_assistant_idx = None;
        }
    }

    fn into_messages(mut self, limit: Option<usize>) -> Vec<SessionMessage> {
        if let Some(n) = limit {
            if self.messages.len() > n {
                self.messages = self.messages.split_off(self.messages.len() - n);
            }
        }
        self.messages
    }
}

/// Parse a Claude Code JSONL session file into a list of SessionMessages.
/// If `limit` is provided, returns only the last N messages.
pub fn parse_session_file(
    path: &Path,
    limit: Option<usize>,
) -> Result<Vec<SessionMessage>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut parser = SessionParser::new();

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        parser.process_line(&v);
    }

    Ok(parser.into_messages(limit))
}

/// Extract text and tool_use blocks from an assistant message's content array.
/// Returns (combined_text, vec_of_(id, name, input_json)).
fn extract_assistant_content(content_arr: &[Value]) -> (String, Vec<(String, String, String)>) {
    let mut text_parts: Vec<&str> = Vec::new();
    let mut tool_uses: Vec<(String, String, String)> = Vec::new();

    for block in content_arr {
        match block["type"].as_str() {
            Some("text") => {
                if let Some(t) = block["text"].as_str() {
                    if !t.is_empty() {
                        text_parts.push(t);
                    }
                }
            }
            Some("tool_use") => {
                let id = block["id"].as_str().unwrap_or("").to_string();
                let name = block["name"].as_str().unwrap_or("").to_string();
                let input = serde_json::to_string(&block["input"]).unwrap_or_default();
                tool_uses.push((id, name, input));
            }
            _ => {}
        }
    }

    (text_parts.join(""), tool_uses)
}

/// Extract output text from a tool_result content field (string or array of text blocks).
fn extract_tool_result_text(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

/// Extract text from a user message content field (string or array of text blocks).
fn extract_user_text(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(|block| {
                if block["type"].as_str() == Some("text") {
                    block["text"].as_str()
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

/// Truncate output to approximately `max` bytes for UI display.
/// Uses char boundaries to avoid panicking on multi-byte UTF-8.
fn truncate_output(s: &str, max: usize) -> Cow<'_, str> {
    if s.len() <= max {
        Cow::Borrowed(s)
    } else {
        let end = s.floor_char_boundary(max);
        Cow::Owned(format!("{}...(truncated)", &s[..end]))
    }
}
