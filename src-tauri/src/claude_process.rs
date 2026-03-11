use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::event_router;

/// Maximum number of concurrent claude processes allowed.
const MAX_CONCURRENT_PROCESSES: usize = 10;

// ---------------------------------------------------------------------------
// ProcessStatus
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ProcessStatus {
    Starting = 0,
    Idle = 1,
    Busy = 2,
    Dead = 3,
}

impl From<u8> for ProcessStatus {
    fn from(v: u8) -> Self {
        match v {
            0 => Self::Starting,
            1 => Self::Idle,
            2 => Self::Busy,
            3 => Self::Dead,
            _ => Self::Dead,
        }
    }
}

// ---------------------------------------------------------------------------
// SpawnConfig
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct SpawnConfig {
    pub model: String,
    pub system_prompt: String,
    pub working_dir: String,
    pub allowed_tools: Option<Vec<String>>,
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub dangerously_skip_permissions: bool,
}

// ---------------------------------------------------------------------------
// ImageAttachment
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ImageAttachment {
    /// Base64-encoded image data
    pub data: String,
    /// MIME type (e.g., "image/png", "image/jpeg")
    pub media_type: String,
}

// ---------------------------------------------------------------------------
// ClaudeProcess
// ---------------------------------------------------------------------------

pub struct ClaudeProcess {
    child: Mutex<Child>,
    stdin: Mutex<BufWriter<std::process::ChildStdin>>,
    pub session_id: String,
    status: AtomicU8,
}

/// Environment variables to strip from the spawned claude process.
const ENV_STRIP: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CARGO_MANIFEST_DIR",
    "CARGO_MANIFEST_PATH",
    "CARGO_PKG_NAME",
];

/// Resolve the full path to the `claude` binary.
/// Production macOS apps don't inherit the user's shell PATH, so we check
/// common install locations before falling back to a bare `claude` lookup.
fn resolve_claude_binary() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    // 1. Check if `claude` is already reachable via current PATH
    if let Ok(output) = Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // 2. Probe well-known locations (npm global, Homebrew, local bin)
    let home = dirs::home_dir().unwrap_or_default();
    let candidates = [
        home.join(".npm/bin/claude"),
        home.join(".nvm/current/bin/claude"),
        // Common nvm versioned paths — try to glob the latest
        home.join(".local/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.clone());
        }
    }

    // 3. Try resolving through a login shell to pick up .zshrc/.bashrc PATH
    for shell in &["/bin/zsh", "/bin/bash"] {
        if let Ok(output) = Command::new(shell)
            .args(["-l", "-c", "which claude"])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }

    None
}

impl ClaudeProcess {
    /// Spawn a new persistent claude CLI process.
    pub fn spawn(
        agent_id: &str,
        config: &SpawnConfig,
        app_handle: AppHandle,
        processes: Arc<DashMap<String, Arc<ClaudeProcess>>>,
    ) -> Result<Arc<Self>, String> {
        let session_id = Uuid::new_v4().to_string();

        let claude_bin = resolve_claude_binary()
            .ok_or_else(|| "Could not find `claude` binary. Is Claude Code installed?".to_string())?;

        let mut cmd = Command::new(&claude_bin);
        cmd.current_dir(&config.working_dir);

        // Strip interfering env vars
        for var in ENV_STRIP {
            cmd.env_remove(var);
        }

        // Core flags for persistent bidirectional stream-json mode
        cmd.args([
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--model", &config.model,
        ]);

        // Only add --dangerously-skip-permissions when explicitly enabled
        if config.dangerously_skip_permissions {
            cmd.arg("--dangerously-skip-permissions");
        }

        // System prompt
        if !config.system_prompt.is_empty() {
            cmd.args(["--append-system-prompt", &config.system_prompt]);
        }

        // Tool restrictions
        if let Some(ref tools) = config.allowed_tools {
            if !tools.is_empty() {
                cmd.args(["--allowedTools", &tools.join(",")]);
            }
        }

        // Resume existing conversation
        if let Some(ref conv_id) = config.conversation_id {
            cmd.args(["--resume", conv_id]);
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            format!("Failed to spawn claude process: {}. Is `claude` installed and in PATH?", e)
        })?;

        let stdin = child.stdin.take().ok_or("Failed to open claude stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open claude stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open claude stderr")?;

        let process = Arc::new(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(BufWriter::new(stdin)),
            session_id: session_id.clone(),
            status: AtomicU8::new(ProcessStatus::Starting as u8),
        });

        // Spawn stdout reader thread
        let proc_ref = Arc::clone(&process);
        let agent_id_owned = agent_id.to_string();
        let handle_clone = app_handle.clone();
        let processes_clone = processes.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                if line.trim().is_empty() {
                    continue;
                }

                let event: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!(
                            "[claude:{}] parse error: {} for: {}",
                            agent_id_owned,
                            e,
                            &line[..line.len().min(200)]
                        );
                        continue;
                    }
                };

                // Update status based on event type
                let event_type = event["type"].as_str().unwrap_or("");
                match event_type {
                    "system" if event["subtype"].as_str() == Some("init") => {
                        proc_ref.status.store(ProcessStatus::Idle as u8, Ordering::Relaxed);
                    }
                    "result" => {
                        proc_ref.status.store(ProcessStatus::Idle as u8, Ordering::Relaxed);
                    }
                    _ => {}
                }

                event_router::route_event(&handle_clone, &agent_id_owned, &event);
            }

            // Process exited — clean up init tracking state
            proc_ref.status.store(ProcessStatus::Dead as u8, Ordering::Relaxed);
            event_router::clear_agent_init_state(&agent_id_owned);
            if let Err(e) = handle_clone.emit("session_state", json!({
                "agent_id": agent_id_owned,
                "status": "closed",
            })) {
                log::warn!("Failed to emit session_state for {}: {}", agent_id_owned, e);
            }

            // Remove from registry
            processes_clone.remove(&agent_id_owned);
        });

        // Spawn stderr reader thread
        let agent_id_stderr = agent_id.to_string();
        let handle_stderr = app_handle;
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                log::warn!("[claude:{}] stderr: {}", agent_id_stderr, line);
                // Emit stderr lines as warnings without changing agent status.
                // Agent status should only change to "failed" when the process exits
                // with a non-zero code (handled by the stdout reader thread).
                if let Err(e) = handle_stderr.emit("session_error", json!({
                    "agent_id": agent_id_stderr,
                    "error": line,
                })) {
                    log::warn!("Failed to emit session_error for {}: {}", agent_id_stderr, e);
                }
            }
        });

        Ok(process)
    }

    /// Send a user message to the claude process stdin.
    pub fn send_user_message(&self, text: &str) -> Result<(), String> {
        self.status.store(ProcessStatus::Busy as u8, Ordering::Relaxed);
        let msg = json!({
            "type": "user",
            "message": { "role": "user", "content": text }
        });
        self.write_stdin(&msg)
    }

    /// Send a multimodal user message (text + images) to the claude process stdin.
    pub fn send_user_message_with_images(
        &self,
        text: &str,
        images: &[ImageAttachment],
    ) -> Result<(), String> {
        self.status.store(ProcessStatus::Busy as u8, Ordering::Relaxed);

        let mut content = Vec::new();

        // Add images first (Claude processes them before text)
        for img in images {
            content.push(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.media_type,
                    "data": img.data,
                }
            }));
        }

        // Add text block
        if !text.is_empty() {
            content.push(json!({
                "type": "text",
                "text": text,
            }));
        }

        let msg = json!({
            "type": "user",
            "message": { "role": "user", "content": content }
        });
        self.write_stdin(&msg)
    }

    /// Send a control request to the claude process.
    /// Constructs the request object explicitly instead of mutating input.
    pub fn send_control(&self, subtype: &str, extra: Value) -> Result<(), String> {
        let mut request = if extra.is_object() {
            extra
        } else {
            json!({})
        };
        request["subtype"] = Value::String(subtype.to_string());
        let msg = json!({
            "type": "control_request",
            "request_id": Uuid::new_v4().to_string(),
            "request": request,
        });
        self.write_stdin(&msg)
    }

    /// Interrupt the current operation.
    pub fn interrupt(&self) -> Result<(), String> {
        self.send_control("interrupt", json!({}))
    }

    /// Request graceful session end.
    pub fn end_session(&self) -> Result<(), String> {
        self.send_control("end_session", json!({}))
    }

    /// Force kill the child process.
    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        self.status.store(ProcessStatus::Dead as u8, Ordering::Relaxed);
    }

    /// Get current process status.
    pub fn get_status(&self) -> ProcessStatus {
        ProcessStatus::from(self.status.load(Ordering::Relaxed))
    }

    fn write_stdin(&self, msg: &Value) -> Result<(), String> {
        let json_str = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        let mut stdin = self.stdin.lock().map_err(|e| format!("stdin lock: {}", e))?;
        writeln!(stdin, "{}", json_str).map_err(|e| format!("stdin write: {}", e))?;
        stdin.flush().map_err(|e| format!("stdin flush: {}", e))?;
        Ok(())
    }
}

impl Drop for ClaudeProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

// ---------------------------------------------------------------------------
// ProcessManager
// ---------------------------------------------------------------------------

pub struct ProcessManager {
    processes: Arc<DashMap<String, Arc<ClaudeProcess>>>,
    app_handle: AppHandle,
}

impl ProcessManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            processes: Arc::new(DashMap::new()),
            app_handle,
        }
    }

    /// Spawn a new claude process for an agent.
    pub fn spawn_session(
        &self,
        agent_id: &str,
        config: &SpawnConfig,
    ) -> Result<String, String> {
        // Check concurrent process limit
        if self.processes.len() >= MAX_CONCURRENT_PROCESSES {
            return Err(format!(
                "Maximum concurrent processes ({}) reached. Stop an existing agent first.",
                MAX_CONCURRENT_PROCESSES
            ));
        }

        // Kill existing process for this agent if any
        if let Some((_, old)) = self.processes.remove(agent_id) {
            old.kill();
        }

        let process = ClaudeProcess::spawn(
            agent_id,
            config,
            self.app_handle.clone(),
            Arc::clone(&self.processes),
        )?;

        let session_id = process.session_id.clone();
        self.processes.insert(agent_id.to_string(), process);
        Ok(session_id)
    }

    /// Send a user message to an agent's claude process.
    pub fn send_message(&self, agent_id: &str, text: &str) -> Result<(), String> {
        let process = self.processes.get(agent_id)
            .ok_or_else(|| format!("No active session for agent {}", agent_id))?;
        process.send_user_message(text)
    }

    /// Send a multimodal user message to an agent's claude process.
    pub fn send_message_with_images(
        &self,
        agent_id: &str,
        text: &str,
        images: &[ImageAttachment],
    ) -> Result<(), String> {
        let process = self.processes.get(agent_id)
            .ok_or_else(|| format!("No active session for agent {}", agent_id))?;
        process.send_user_message_with_images(text, images)
    }

    /// Stop an agent's claude process gracefully.
    /// Uses a single remove() to avoid DashMap race with the stdout reader thread.
    pub fn stop_session(&self, agent_id: &str) -> Result<(), String> {
        if let Some((_, process)) = self.processes.remove(agent_id) {
            let _ = process.end_session();
            // Brief delay to allow graceful shutdown before force kill
            std::thread::sleep(std::time::Duration::from_millis(200));
            process.kill();
        }
        Ok(())
    }

    /// Interrupt an agent's current operation.
    pub fn interrupt(&self, agent_id: &str) -> Result<(), String> {
        let process = self.processes.get(agent_id)
            .ok_or_else(|| format!("No active session for agent {}", agent_id))?;
        process.interrupt()
    }

    /// Check if an agent has an active process.
    pub fn has_session(&self, agent_id: &str) -> bool {
        self.processes.get(agent_id)
            .map(|p| p.get_status() != ProcessStatus::Dead)
            .unwrap_or(false)
    }

    /// Gracefully shut down all processes (called on app exit).
    /// Uses a polling loop with try_wait instead of a blocking sleep.
    pub fn shutdown(&self) {
        // Send end_session to all
        for entry in self.processes.iter() {
            let _ = entry.value().end_session();
        }

        // Poll for graceful exit with 100ms iterations, max 2 seconds
        let max_iterations = 20;
        for _ in 0..max_iterations {
            let all_dead = self.processes.iter().all(|entry| {
                if let Ok(mut child) = entry.value().child.lock() {
                    matches!(child.try_wait(), Ok(Some(_)))
                } else {
                    true
                }
            });
            if all_dead {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        // Force kill any remaining
        for entry in self.processes.iter() {
            entry.value().kill();
        }
        self.processes.clear();
    }
}
