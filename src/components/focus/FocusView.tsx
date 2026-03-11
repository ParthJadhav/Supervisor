import { useEffect, useMemo, useRef, useCallback } from "react";
import { Loader2, X, ImagePlus } from "lucide-react";
import { useAgentStore } from "@/stores/agent-store";
import { useLayerStore } from "@/stores/layer-store";
import { ChatView } from "@/components/chat/ChatView";
import { AgentHeader } from "./AgentHeader";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { useAgentSend } from "@/hooks/use-agent-send";
import { useDropTarget } from "@/hooks/use-tauri-drop";
import { useTauriDropContext } from "@/contexts/tauri-drop-context";
import type { ImageAttachment } from "@/types";

interface FocusViewProps {
  agentId: string;
  onSwitchAgent: (agentId: string) => void;
}

export function FocusView({ agentId }: FocusViewProps) {
  const loadSessionHistory = useAgentStore((s) => s.loadSessionHistory);
  const markAsRead = useAgentStore((s) => s.markAsRead);
  const historyLoading = useAgentStore((s) => s.historyLoading[agentId]);
  const sessionMeta = useAgentStore((s) => s.sessionMeta[agentId]);
  const agentName = useAgentStore((s) => s.agents.find((a) => a.id === agentId)?.name ?? "Agent");

  const stopAgent = useAgentStore((s) => s.stopAgent);
  const exitFocus = useLayerStore((s) => s.exitFocus);
  const { sending, handleSend } = useAgentSend(agentId);
  const composerRef = useRef<ChatComposerHandle>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  // --- Tauri native drag & drop ---
  const tauriDropState = useTauriDropContext();
  const addImages = useCallback((images: ImageAttachment[]) => {
    composerRef.current?.addImages(images);
  }, []);
  const isDragOver = useDropTarget(`focus-${agentId}`, viewRef, addImages, tauriDropState);

  const handleStop = useCallback(() => {
    stopAgent(agentId);
  }, [stopAgent, agentId]);

  // Load history and mark as read when switching agents
  useEffect(() => {
    loadSessionHistory(agentId);
    markAsRead(agentId);
  }, [agentId, loadSessionHistory, markAsRead]);

  const agentStatus = useAgentStore((s) => s.agents.find((a) => a.id === agentId)?.status);
  const isAgentRunning = agentStatus === "running" || agentStatus === "waiting_input";

  const slashCommands = useMemo(
    () => {
      if (!isAgentRunning) {
        return [{ name: "clear", description: "Clear conversation history" }];
      }
      const cmds = sessionMeta?.slashCommands ?? [];
      const hasClear = cmds.some((c) => c.name === "clear");
      return hasClear ? cmds : [{ name: "clear", description: "Clear conversation history" }, ...cmds];
    },
    [sessionMeta, isAgentRunning],
  );

  return (
    <div
      ref={viewRef}
      data-focus-view
      className="flex flex-col h-full bg-background relative"
    >
      {/* Close button */}
      <button
        type="button"
        onClick={exitFocus}
        className="absolute top-3 right-3 z-10 flex flex-col items-center gap-0.5 group"
        aria-label="Close focus view"
      >
        <X className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        <span className="text-[9px] text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
          escape
        </span>
      </button>

      {/* Centered column */}
      <div className="flex flex-col w-full h-full min-h-0 mx-auto">
        <AgentHeader agentId={agentId} />

        {/* Chat area */}
        {historyLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">
            <ChatView key={agentId} agentId={agentId} />
          </div>
        )}

        {/* Composer */}
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer
            ref={composerRef}
            agentName={agentName}
            sending={sending}
            slashCommands={slashCommands}
            agentRunning={isAgentRunning}
            onSend={handleSend}
            onStop={handleStop}
          />
        </div>
      </div>

      {/* Drop overlay — shown when Tauri drag is over this view */}
      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <ImagePlus size={28} strokeWidth={1.5} />
            <span>Drop images here</span>
          </div>
        </div>
      )}
    </div>
  );
}
