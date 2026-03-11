export interface Agent {
  id: string;
  name: string;
  role: string | null;
  model: string;
  status: AgentStatus;
  project_id: string | null;
  session_id: string | null;
  created_at: string;
  dangerously_skip_permissions?: boolean;
}

export type AgentStatus =
  | "created"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "waiting_input";

export type AgentTier = "expanded" | "collapsed";

export interface AgentConfig {
  name: string;
  role?: string;
  model?: string;
  project_id?: string;
  system_prompt?: string;
  allowed_tools?: string[];
  dangerously_skip_permissions?: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  workspace_id: string | null;
  color: string | null;
  icon: string | null;
  created_at: string;
}

export const PROJECT_COLORS = [
  { name: "Gray", value: "gray", class: "bg-zinc-500", border: "border-zinc-500/40" },
  { name: "Red", value: "red", class: "bg-red-500", border: "border-red-500/40" },
  { name: "Orange", value: "orange", class: "bg-orange-500", border: "border-orange-500/40" },
  { name: "Amber", value: "amber", class: "bg-amber-500", border: "border-amber-500/40" },
  { name: "Green", value: "green", class: "bg-emerald-500", border: "border-emerald-500/40" },
  { name: "Teal", value: "teal", class: "bg-teal-500", border: "border-teal-500/40" },
  { name: "Blue", value: "blue", class: "bg-blue-500", border: "border-blue-500/40" },
  { name: "Indigo", value: "indigo", class: "bg-indigo-500", border: "border-indigo-500/40" },
  { name: "Purple", value: "purple", class: "bg-purple-500", border: "border-purple-500/40" },
  { name: "Pink", value: "pink", class: "bg-pink-500", border: "border-pink-500/40" },
] as const;

export const PROJECT_ICONS = [
  "folder", "code", "globe", "database", "terminal",
  "box", "cpu", "zap", "rocket", "palette",
  "shield", "book", "music", "camera", "heart",
] as const;

export type ProjectColor = typeof PROJECT_COLORS[number]["value"];
export type ProjectIcon = typeof PROJECT_ICONS[number];

export interface AgentOutputEvent {
  agent_id: string;
  session_id: string;
  data: string;
  stream?: string;
  streaming?: boolean;
}

/** Wire protocol statuses from the CLI process, distinct from AgentStatus */
export type AgentWireStatus = "running" | "idle" | "closed";

export interface SessionStateEvent {
  session_id: string;
  agent_id: string;
  status: AgentWireStatus;
  exit_code?: number;
}

// Chat message model for the UI
export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  toolCall?: ToolCall;
  images?: ImageAttachment[];
  /** Number of images (from session history where actual data isn't loaded) */
  imageCount?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
  status: "started" | "running" | "completed" | "error";
  isError?: boolean;
}

export interface ToolUseEvent {
  agent_id: string;
  session_id: string;
  tool_call_id: string;
  tool_name: string;
  tool_input?: string;
  status: "started" | "running" | "completed" | "error";
}

// Session history types (from Rust session_reader)
export interface SessionMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  tool_call?: SessionToolCall;
  image_count?: number;
}

export interface SessionToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
  status: "started" | "running" | "completed" | "error";
  is_error: boolean;
}

export interface ToolResultEvent {
  agent_id: string;
  session_id: string;
  tool_call_id: string;
  output: string;
  is_error: boolean;
}

// Notification types
export type NotificationEventType =
  | "agent_completed"
  | "agent_failed"
  | "agent_waiting_input"
  | "agent_started"
  | "all_agents_idle";

export interface AppNotification {
  id: number;
  event_type: NotificationEventType;
  title: string;
  body?: string;
  agent_id?: string;
  agent_name?: string;
  read: boolean;
  created_at: string;
}

export interface NotificationPref {
  event_type: NotificationEventType | "global";
  channel: string;
  enabled: boolean;
}

// --- Session metadata events (from persistent Claude CLI) ---

export interface SessionInitEvent {
  agent_id: string;
  model: string;
  slash_commands: Array<{ name: string; description: string }>;
  tools: string[];
  mcp_servers: string[];
}


export interface SlashCommand {
  name: string;
  description: string;
}

export interface ImageAttachment {
  /** Base64-encoded image data (no data: prefix) */
  data: string;
  /** MIME type e.g. "image/png", "image/jpeg" */
  media_type: string;
  /** Original file path — when present, Rust reads from disk instead of IPC base64 */
  path?: string;
}

// --- Context / token usage events ---

export interface SessionUsageEvent {
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number | null;
  cache_creation: number | null;
}

export interface SessionResultEvent {
  agent_id: string;
  cost_usd: number;
  duration_ms: number;
  is_cumulative_cost: boolean;
}

// Type guard functions

const AGENT_STATUS_VALUES: ReadonlySet<string> = new Set<AgentStatus>([
  "created", "running", "completed", "failed", "stopped", "waiting_input",
]);

export function isValidAgentStatus(value: string): value is AgentStatus {
  return AGENT_STATUS_VALUES.has(value);
}

const CHAT_ROLE_VALUES: ReadonlySet<string> = new Set<ChatRole>([
  "user", "assistant", "system", "tool",
]);

export function isValidChatRole(value: string): value is ChatRole {
  return CHAT_ROLE_VALUES.has(value);
}
