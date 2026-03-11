import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Agent, AgentConfig, AgentStatus, AgentTier, ChatMessage, ImageAttachment, SessionMessage, ToolCall, SessionUsageEvent, SessionResultEvent } from "../types";
import { isValidAgentStatus } from "../types";

export type FilterScope = "all" | "agents" | "projects";

// Monotonic counter for unique message IDs
let msgSeq = 0;
const nextMsgId = (prefix: string) => `${prefix}-${Date.now()}-${++msgSeq}`;

// Track in-flight history loads to prevent TOCTOU race
const inFlightHistoryLoads = new Set<string>();

// Z-index normalization threshold
const Z_INDEX_NORMALIZE_THRESHOLD = 10_000;

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  contextWindowSize: number;
  costUsd: number;
  durationMs: number;
}

interface CanvasFilter {
  query: string;
  status: AgentStatus | null;
  scope: FilterScope;
}

interface AgentState {
  agents: Agent[];
  selectedAgentId: string | null;
  openAgentIds: string[];
  chatMessages: Record<string, ChatMessage[]>;
  historyLoaded: Record<string, boolean>;
  historyLoading: Record<string, boolean>;
  unreadCounts: Record<string, number>;
  outputBuffers: Record<string, string[]>;
  agentStartedAt: Record<string, number | undefined>;
  currentTools: Record<string, string | null>;
  canvasFilter: CanvasFilter;
  sessionMeta: Record<string, {
    slashCommands: Array<{ name: string; description: string }>;
    model: string;
    tools: string[];
    mcpServers: string[];
  }>;
  agentTiers: Record<string, AgentTier>;
  agentExpandedSizes: Record<string, { width: number; height: number }>;
  resizeZCounter: number;
  agentZIndices: Record<string, number>;
  contextUsage: Record<string, ContextUsage>;
  pendingFocusAgentId: string | null;

  updateContextUsage: (agentId: string, event: SessionUsageEvent) => void;
  updateContextResult: (agentId: string, event: SessionResultEvent) => void;
  setContextWindowSize: (agentId: string, size: number) => void;
  setAgentTier: (agentId: string, tier: AgentTier) => void;
  setAgentExpandedSize: (agentId: string, size: { width: number; height: number }) => void;
  initAgentTiers: (tiers: Record<string, AgentTier>) => void;
  bringToFront: (agentId: string) => void;
  requestFocusAgent: (agentId: string) => void;
  clearPendingFocus: () => void;

  fetchAgents: () => Promise<void>;
  createAgent: (config: AgentConfig) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  startAgent: (id: string, prompt?: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  sendMessage: (id: string, message: string, images?: ImageAttachment[]) => Promise<void>;
  selectAgent: (id: string | null) => void;
  closeAgentTab: (id: string) => void;
  reorderTabs: (ids: string[]) => void;
  markAsRead: (agentId: string) => void;
  clearSession: (agentId: string) => void;
  clearAgentSession: (agentId: string) => Promise<void>;
  loadSessionHistory: (agentId: string) => Promise<void>;
  setCanvasFilter: (filter: Partial<CanvasFilter>) => void;

  addUserMessage: (agentId: string, text: string, images?: ImageAttachment[]) => void;
  appendOutput: (agentId: string, text: string, streaming?: boolean) => void;
  addToolUse: (agentId: string, toolCallId: string, toolName: string, toolInput?: string, status?: ToolCall["status"]) => void;
  addToolResult: (agentId: string, toolCallId: string, output: string, isError: boolean) => void;
  updateAgentStatus: (agentId: string, status: string) => void;
  setSessionMeta: (agentId: string, meta: AgentState["sessionMeta"][string]) => void;
}

const MAX_MESSAGES = 500;
const MAX_OUTPUT_LINES = 1000;

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selectedAgentId: null,
  openAgentIds: [],
  chatMessages: {},
  historyLoaded: {},
  historyLoading: {},
  unreadCounts: {},
  outputBuffers: {},
  agentStartedAt: {},
  currentTools: {},
  canvasFilter: { query: "", status: null, scope: "all" },
  sessionMeta: {},
  agentTiers: {},
  agentExpandedSizes: {},
  resizeZCounter: 0,
  agentZIndices: {},
  contextUsage: {},
  pendingFocusAgentId: null,

  updateContextUsage: (agentId, event) => set((s) => {
    const prev = s.contextUsage[agentId] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, contextWindowSize: 200_000, costUsd: 0, durationMs: 0 };
    return {
      contextUsage: {
        ...s.contextUsage,
        [agentId]: {
          ...prev,
          inputTokens: event.input_tokens,
          outputTokens: event.output_tokens,
          cacheRead: event.cache_read ?? prev.cacheRead,
          cacheCreation: event.cache_creation ?? prev.cacheCreation,
        },
      },
    };
  }),

  updateContextResult: (agentId, event) => set((s) => {
    const prev = s.contextUsage[agentId] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, contextWindowSize: 200_000, costUsd: 0, durationMs: 0 };
    return {
      contextUsage: {
        ...s.contextUsage,
        [agentId]: {
          ...prev,
          costUsd: event.cost_usd,
          durationMs: event.duration_ms,
        },
      },
    };
  }),

  setContextWindowSize: (agentId, size) => set((s) => {
    const prev = s.contextUsage[agentId] || { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, contextWindowSize: 200_000, costUsd: 0, durationMs: 0 };
    return {
      contextUsage: {
        ...s.contextUsage,
        [agentId]: { ...prev, contextWindowSize: size },
      },
    };
  }),

  setAgentTier: (agentId, tier) => {
    set((s) => {
      const newTiers = { ...s.agentTiers, [agentId]: tier };
      if (tier === "expanded") {
        const newZ = s.resizeZCounter + 1;
        return {
          agentTiers: newTiers,
          resizeZCounter: newZ,
          agentZIndices: { ...s.agentZIndices, [agentId]: newZ },
        };
      }
      const newZIndices = { ...s.agentZIndices };
      delete newZIndices[agentId];
      return { agentTiers: newTiers, agentZIndices: newZIndices };
    });
  },

  setAgentExpandedSize: (agentId, size) => {
    set((s) => ({
      agentExpandedSizes: { ...s.agentExpandedSizes, [agentId]: size },
    }));
  },

  initAgentTiers: (tiers) => {
    set({ agentTiers: tiers });
  },

  bringToFront: (agentId) => {
    set((s) => {
      let counter = s.resizeZCounter + 1;
      let indices = { ...s.agentZIndices, [agentId]: counter };

      // Normalize z-indices when threshold is reached to prevent CSS overflow
      if (counter >= Z_INDEX_NORMALIZE_THRESHOLD) {
        const entries = Object.entries(indices).sort(([, a], [, b]) => a - b);
        const normalized: Record<string, number> = {};
        entries.forEach(([id], i) => { normalized[id] = i + 1; });
        counter = entries.length;
        indices = normalized;
      }

      return { resizeZCounter: counter, agentZIndices: indices };
    });
  },

  requestFocusAgent: (agentId) => set({ pendingFocusAgentId: agentId }),
  clearPendingFocus: () => set({ pendingFocusAgentId: null }),

  fetchAgents: async () => {
    const agents = await invoke<Agent[]>("list_agents");
    set({ agents });

    // Preload session histories in background — don't block fetchAgents
    // so callers/retries aren't delayed by slow session file I/O
    const { loadSessionHistory } = useAgentStore.getState();
    Promise.allSettled(agents.map((a) => loadSessionHistory(a.id)));
  },

  createAgent: async (config) => {
    const agent = await invoke<Agent>("create_agent", { config });
    set((s) => ({ agents: [...s.agents, agent] }));
    return agent;
  },

  deleteAgent: async (id) => {
    await invoke("delete_agent", { id });
    inFlightHistoryLoads.delete(id);
    set((s) => {
      const newOpen = s.openAgentIds.filter((oid) => oid !== id);
      let newSelected = s.selectedAgentId;
      if (s.selectedAgentId === id) {
        if (newOpen.length === 0) {
          newSelected = null;
        } else {
          const oldIdx = s.openAgentIds.indexOf(id);
          newSelected = newOpen[Math.min(oldIdx, newOpen.length - 1)];
        }
      }
      // Clean up all ancillary state maps to prevent memory leaks
      const { [id]: _cm, ...remainingMessages } = s.chatMessages;
      const { [id]: _hl, ...remainingLoaded } = s.historyLoaded;
      const { [id]: _hlg, ...remainingLoading } = s.historyLoading;
      const { [id]: _uc, ...remainingUnread } = s.unreadCounts;
      const { [id]: _ob, ...remainingBuffers } = s.outputBuffers;
      const { [id]: _as, ...remainingStartedAt } = s.agentStartedAt;
      const { [id]: _ct, ...remainingTools } = s.currentTools;
      const { [id]: _sm, ...remainingMeta } = s.sessionMeta;
      const { [id]: _at, ...remainingTiers } = s.agentTiers;
      const { [id]: _es, ...remainingSizes } = s.agentExpandedSizes;
      const { [id]: _zi, ...remainingZIndices } = s.agentZIndices;
      const { [id]: _cu, ...remainingUsage } = s.contextUsage;
      return {
        agents: s.agents.filter((a) => a.id !== id),
        selectedAgentId: newSelected,
        openAgentIds: newOpen,
        chatMessages: remainingMessages,
        historyLoaded: remainingLoaded,
        historyLoading: remainingLoading,
        unreadCounts: remainingUnread,
        outputBuffers: remainingBuffers,
        agentStartedAt: remainingStartedAt,
        currentTools: remainingTools,
        sessionMeta: remainingMeta,
        agentTiers: remainingTiers,
        agentExpandedSizes: remainingSizes,
        agentZIndices: remainingZIndices,
        contextUsage: remainingUsage,
      };
    });
  },

  startAgent: async (id, prompt) => {
    await invoke("start_agent", { id, initialPrompt: prompt ?? null });
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, status: "running" as const } : a,
      ),
      agentStartedAt: { ...s.agentStartedAt, [id]: Date.now() },
    }));
  },

  stopAgent: async (id) => {
    await invoke("stop_agent", { id });
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, status: "stopped" as const } : a,
      ),
    }));
  },

  sendMessage: async (id, message, images) => {
    // Separate path-based images (from Tauri drop) and data-based (from paste/picker).
    // Path-based: send only paths so Rust reads from disk — avoids large IPC payloads.
    // Data-based: send base64 through IPC (no file path available).
    const pathImages = images?.filter((img) => img.path) ?? [];
    const dataImages = images?.filter((img) => !img.path) ?? [];

    await invoke("send_agent_message", {
      id,
      message,
      images: dataImages.length > 0 ? dataImages.map(({ data, media_type }) => ({ data, media_type })) : null,
      imagePaths: pathImages.length > 0 ? pathImages.map((img) => img.path!) : null,
    });
  },

  selectAgent: (id) => set((s) => ({
    selectedAgentId: id,
    openAgentIds: id && !s.openAgentIds.includes(id)
      ? [...s.openAgentIds, id]
      : s.openAgentIds,
    unreadCounts: id ? { ...s.unreadCounts, [id]: 0 } : s.unreadCounts,
  })),

  closeAgentTab: (id) => set((s) => {
    const newOpen = s.openAgentIds.filter((oid) => oid !== id);
    let newSelected = s.selectedAgentId;
    if (s.selectedAgentId === id) {
      if (newOpen.length === 0) {
        newSelected = null;
      } else {
        const oldIdx = s.openAgentIds.indexOf(id);
        newSelected = newOpen[Math.min(oldIdx, newOpen.length - 1)];
      }
    }
    return { openAgentIds: newOpen, selectedAgentId: newSelected };
  }),

  reorderTabs: (ids) => set({ openAgentIds: ids }),

  markAsRead: (agentId) => set((s) => ({
    unreadCounts: { ...s.unreadCounts, [agentId]: 0 },
  })),

  clearSession: (agentId) => set((s) => {
    // Preserve contextWindowSize so it doesn't reset to default on /clear
    const prevCtx = s.contextUsage[agentId];
    const ctxSize = prevCtx?.contextWindowSize ?? 200_000;
    return {
      chatMessages: { ...s.chatMessages, [agentId]: [] },
      outputBuffers: { ...s.outputBuffers, [agentId]: [] },
      unreadCounts: { ...s.unreadCounts, [agentId]: 0 },
      currentTools: { ...s.currentTools, [agentId]: null },
      historyLoaded: { ...s.historyLoaded, [agentId]: true },
      contextUsage: {
        ...s.contextUsage,
        [agentId]: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, contextWindowSize: ctxSize, costUsd: 0, durationMs: 0 },
      },
    };
  }),

  clearAgentSession: async (agentId) => {
    // Clear frontend state immediately
    useAgentStore.getState().clearSession(agentId);
    // Stop + respawn a fresh CLI process on the backend (no --resume)
    await invoke("clear_agent_session", { id: agentId });
  },

  setCanvasFilter: (filter) => set((s) => {
    // Filter out undefined values to prevent them from overriding existing state
    const clean = Object.fromEntries(
      Object.entries(filter).filter(([, v]) => v !== undefined),
    );
    return { canvasFilter: { ...s.canvasFilter, ...clean } };
  }),

  loadSessionHistory: async (agentId) => {
    // Use external Set to prevent TOCTOU race between getState() check and set()
    if (inFlightHistoryLoads.has(agentId)) return;
    const state = useAgentStore.getState();
    if (state.historyLoaded[agentId]) return;
    if ((state.chatMessages[agentId] || []).length > 0) return;

    inFlightHistoryLoads.add(agentId);
    set((s) => ({ historyLoading: { ...s.historyLoading, [agentId]: true } }));

    try {
      const history = await invoke<SessionMessage[]>("load_session_history", {
        agentId,
        limit: 500,
      });

      const messages: ChatMessage[] = history.map((msg) => ({
        id: msg.id,
        role: msg.role as ChatMessage["role"],
        content: msg.content,
        timestamp: new Date(msg.timestamp).getTime() || Date.now(),
        toolCall: msg.tool_call
          ? {
              id: msg.tool_call.id,
              name: msg.tool_call.name,
              input: msg.tool_call.input,
              output: msg.tool_call.output,
              status: msg.tool_call.is_error ? "error" as const : "completed" as const,
              isError: msg.tool_call.is_error,
            }
          : undefined,
        ...(msg.image_count ? { imageCount: msg.image_count } : {}),
      }));

      // Only set if still empty (streaming may have started in parallel)
      set((s) => {
        if ((s.chatMessages[agentId] || []).length > 0) return s;
        return {
          chatMessages: { ...s.chatMessages, [agentId]: messages },
          historyLoaded: { ...s.historyLoaded, [agentId]: true },
          historyLoading: { ...s.historyLoading, [agentId]: false },
        };
      });
    } catch (err) {
      console.error("Failed to load session history:", err);
      set((s) => ({
        historyLoaded: { ...s.historyLoaded, [agentId]: true },
        historyLoading: { ...s.historyLoading, [agentId]: false },
      }));
    } finally {
      inFlightHistoryLoads.delete(agentId);
    }
  },

  addUserMessage: (agentId, text, images) => {
    set((s) => {
      const msgs = [...(s.chatMessages[agentId] || [])];
      msgs.push({
        id: nextMsgId("user"),
        role: "user",
        content: text,
        timestamp: Date.now(),
        ...(images && images.length > 0 ? { images } : {}),
      });
      return { chatMessages: { ...s.chatMessages, [agentId]: msgs } };
    });
  },

  appendOutput: (agentId, text, streaming) => {
    set((s) => {
      // Update raw buffer for preview
      const buffer = [...(s.outputBuffers[agentId] || [])];
      if (streaming && buffer.length > 0) {
        buffer[buffer.length - 1] += text;
      } else {
        buffer.push(text);
      }
      const trimmedBuffer =
        buffer.length > MAX_OUTPUT_LINES
          ? buffer.slice(-MAX_OUTPUT_LINES)
          : buffer;

      // Update chat messages
      const msgs = [...(s.chatMessages[agentId] || [])];

      if (streaming && msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        if (last.role === "assistant" && last.isStreaming) {
          // Append to existing streaming message
          msgs[msgs.length - 1] = { ...last, content: last.content + text };
        } else {
          // Start new streaming message
          msgs.push({
            id: nextMsgId("assistant"),
            role: "assistant",
            content: text,
            timestamp: Date.now(),
            isStreaming: true,
          });
        }
      } else {
        // Non-streaming: new complete message
        if (msgs.length > 0 && msgs[msgs.length - 1].isStreaming) {
          // Mark previous streaming message as complete
          msgs[msgs.length - 1] = {
            ...msgs[msgs.length - 1],
            isStreaming: false,
          };
        }
        msgs.push({
          id: nextMsgId("assistant"),
          role: "assistant",
          content: text,
          timestamp: Date.now(),
        });
      }

      const trimmedMsgs =
        msgs.length > MAX_MESSAGES ? msgs.slice(-MAX_MESSAGES) : msgs;

      // Increment unread only when a brand-new message is created (more msgs than before)
      // and the agent is not currently selected
      const prevCount = (s.chatMessages[agentId] || []).length;
      const newMsgCreated = msgs.length > prevCount;
      const unread = s.selectedAgentId !== agentId && newMsgCreated
        ? (s.unreadCounts[agentId] || 0) + 1
        : s.unreadCounts[agentId] || 0;

      return {
        outputBuffers: { ...s.outputBuffers, [agentId]: trimmedBuffer },
        chatMessages: { ...s.chatMessages, [agentId]: trimmedMsgs },
        unreadCounts: { ...s.unreadCounts, [agentId]: unread },
      };
    });
  },

  addToolUse: (agentId, toolCallId, toolName, toolInput, status = "started") => {
    set((s) => {
      const msgs = [...(s.chatMessages[agentId] || [])];

      // Mark any streaming assistant message as complete before tool use
      if (msgs.length > 0 && msgs[msgs.length - 1].isStreaming) {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], isStreaming: false };
      }

      // Check if we already have a message for this tool call
      const existing = msgs.findIndex(
        (m) => m.role === "tool" && m.toolCall?.id === toolCallId,
      );

      if (existing !== -1) {
        // Update existing tool call message
        const msg = msgs[existing];
        msgs[existing] = {
          ...msg,
          toolCall: {
            ...msg.toolCall!,
            input: toolInput || msg.toolCall!.input,
            status,
          },
        };
      } else {
        // New tool call
        msgs.push({
          id: `tool-${toolCallId}`,
          role: "tool",
          content: "",
          timestamp: Date.now(),
          toolCall: {
            id: toolCallId,
            name: toolName,
            input: toolInput || "",
            status,
          },
        });
      }

      return {
        chatMessages: { ...s.chatMessages, [agentId]: msgs },
        currentTools: { ...s.currentTools, [agentId]: toolName },
      };
    });
  },

  addToolResult: (agentId, toolCallId, output, isError) => {
    set((s) => {
      const msgs = [...(s.chatMessages[agentId] || [])];
      const idx = msgs.findIndex(
        (m) => m.role === "tool" && m.toolCall?.id === toolCallId,
      );

      if (idx !== -1) {
        const msg = msgs[idx];
        msgs[idx] = {
          ...msg,
          toolCall: {
            ...msg.toolCall!,
            output,
            status: isError ? "error" : "completed",
            isError,
          },
        };
      } else {
        // Tool result without a matching tool_use (edge case)
        msgs.push({
          id: `tool-result-${toolCallId}`,
          role: "tool",
          content: "",
          timestamp: Date.now(),
          toolCall: {
            id: toolCallId,
            name: "unknown",
            input: "",
            output,
            status: isError ? "error" : "completed",
            isError,
          },
        });
      }

      return {
        chatMessages: { ...s.chatMessages, [agentId]: msgs },
        currentTools: { ...s.currentTools, [agentId]: null },
      };
    });
  },

  setSessionMeta: (agentId, meta) => set((s) => ({
    sessionMeta: { ...s.sessionMeta, [agentId]: meta },
  })),

  updateAgentStatus: (agentId, status) => {
    // Validate status before applying
    if (!isValidAgentStatus(status)) {
      console.warn(`Unknown agent status: "${status}" for agent ${agentId}`);
      return;
    }

    // Persist to DB so fetchAgents() won't overwrite with stale values
    invoke("update_agent_status", { id: agentId, status }).catch((err) =>
      console.error("Failed to persist agent status:", err),
    );
    set((s) => {
      // When agent goes idle, mark last streaming message as complete
      const msgs = s.chatMessages[agentId];
      let updatedMsgs = msgs;
      if (msgs && msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        if (last.isStreaming) {
          updatedMsgs = [...msgs];
          updatedMsgs[updatedMsgs.length - 1] = {
            ...last,
            isStreaming: false,
          };
        }
      }

      const isRunning = status === "running";
      const wasRunning = s.agentStartedAt[agentId] != null;

      // Clean up agentStartedAt properly using delete instead of undefined hack
      const newStartedAt = { ...s.agentStartedAt };
      if (isRunning) {
        if (!wasRunning) newStartedAt[agentId] = Date.now();
      } else {
        delete newStartedAt[agentId];
      }

      return {
        agents: s.agents.map((a) =>
          a.id === agentId ? { ...a, status } : a,
        ),
        chatMessages: updatedMsgs
          ? { ...s.chatMessages, [agentId]: updatedMsgs }
          : s.chatMessages,
        agentStartedAt: newStartedAt,
        currentTools: isRunning
          ? s.currentTools
          : { ...s.currentTools, [agentId]: null },
      };
    });
  },
}));
