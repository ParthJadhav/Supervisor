import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAgentStore } from "../stores/agent-store";
import { streamingBuffer } from "../lib/streaming-buffer";
import type {
  AgentOutputEvent, SessionStateEvent, ToolUseEvent, ToolResultEvent,
  SessionInitEvent, SessionUsageEvent, SessionResultEvent,
} from "../types";

export function useAgentEvents() {
  const appendOutput = useAgentStore((s) => s.appendOutput);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const addToolUse = useAgentStore((s) => s.addToolUse);
  const addToolResult = useAgentStore((s) => s.addToolResult);
  const setSessionMeta = useAgentStore((s) => s.setSessionMeta);
  const updateContextUsage = useAgentStore((s) => s.updateContextUsage);
  const updateContextResult = useAgentStore((s) => s.updateContextResult);
  const setContextWindowSize = useAgentStore((s) => s.setContextWindowSize);
  const clearSession = useAgentStore((s) => s.clearSession);
  useEffect(() => {
    // Wire the buffer to flush batched tokens into the store
    streamingBuffer.setFlushCallback(appendOutput);

    const unlisteners: (() => void)[] = [];
    let cancelled = false;

    const register = async <T>(eventName: string, handler: (event: { payload: T }) => void) => {
      const unlisten = await listen<T>(eventName, handler);
      if (cancelled) { unlisten(); return; }
      unlisteners.push(unlisten);
    };

    register<AgentOutputEvent>("session_output", (event) => {
      // Route through buffer instead of calling appendOutput directly
      streamingBuffer.push(event.payload.agent_id, event.payload.data, event.payload.streaming);
    });

    register<ToolUseEvent>("session_tool_use", (event) => {
      const { agent_id, tool_call_id, tool_name, tool_input, status } = event.payload;
      // Flush any pending streaming tokens before tool use
      streamingBuffer.flushImmediate(agent_id);
      addToolUse(agent_id, tool_call_id, tool_name, tool_input, status);
    });

    register<ToolResultEvent>("session_tool_result", (event) => {
      const { agent_id, tool_call_id, output, is_error } = event.payload;
      addToolResult(agent_id, tool_call_id, output, is_error);
    });

    register<SessionStateEvent>("session_state", (event) => {
      const { agent_id, status } = event.payload;
      // Flush any pending tokens before status change
      streamingBuffer.flushImmediate(agent_id);
      if (status === "closed") {
        updateAgentStatus(agent_id, "completed");
      } else if (status === "idle") {
        updateAgentStatus(agent_id, "waiting_input");
      } else if (status === "running") {
        updateAgentStatus(agent_id, "running");
      }
    });

    register<{ agent_id: string; error: string }>("session_error", (event) => {
      streamingBuffer.flushImmediate(event.payload.agent_id);
      updateAgentStatus(event.payload.agent_id, "failed");
    });

    register<SessionInitEvent>("session_init", (event) => {
      const { agent_id, model, slash_commands, tools, mcp_servers } = event.payload;
      setSessionMeta(agent_id, {
        slashCommands: slash_commands || [],
        model: model || "",
        tools: tools || [],
        mcpServers: mcp_servers || [],
      });

      // Derive context window size from model name
      const m = (model || "").toLowerCase();
      let ctxSize = 200_000;
      if (m.includes("opus") && (m.includes("4-6") || m.includes("4.6"))) {
        ctxSize = 1_000_000;
      } else if (m.includes("opus")) {
        ctxSize = 200_000;
      } else if (m.includes("haiku")) {
        ctxSize = 200_000;
      }
      // sonnet defaults to 200k
      setContextWindowSize(agent_id, ctxSize);
    });

    register<SessionUsageEvent>("session_usage", (event) => {
      updateContextUsage(event.payload.agent_id, event.payload);
    });

    register<SessionResultEvent>("session_result", (event) => {
      updateContextResult(event.payload.agent_id, event.payload);
    });

    register<{ agent_id: string }>("session_cleared", (event) => {
      clearSession(event.payload.agent_id);
    });

    return () => {
      cancelled = true;
      streamingBuffer.dispose();
      unlisteners.forEach((fn) => fn());
    };
  }, [appendOutput, updateAgentStatus, addToolUse, addToolResult, setSessionMeta, updateContextUsage, updateContextResult, setContextWindowSize, clearSession]);
}
