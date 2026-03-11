import { memo, useCallback, useMemo, useState, useEffect, useRef } from "react";
import { Maximize2, ChevronDown, ChevronRight, ImagePlus } from "lucide-react";
import { ChatView } from "@/components/chat/ChatView";
import { ChatComposer, type ChatComposerHandle } from "@/components/focus/ChatComposer";
import { useAgentSend } from "@/hooks/use-agent-send";
import { useAgentStore } from "@/stores/agent-store";
import { useDropTarget } from "@/hooks/use-tauri-drop";
import { useTauriDropContext } from "@/contexts/tauri-drop-context";
import {
  getModelTier,
  modelTierConfig,
  getDisplayStatus,
  getStatusDotColor,
} from "@/lib/agent-display";
import { ContextUsageBar } from "@/components/focus/ContextUsageBar";

interface AgentCardUnifiedProps {
  agentId: string;
  collapsed: boolean;
  active: boolean;
  onExpandClick?: () => void;
  onCollapse?: () => void;
  onExpand?: () => void;
}

export const AgentCardUnified = memo(function AgentCardUnified({
  agentId,
  collapsed,
  active,
  onExpandClick,
  onCollapse,
  onExpand,
}: AgentCardUnifiedProps) {
  const { sending, handleSend } = useAgentSend(agentId);
  const agent = useAgentStore((s) => s.agents.find((a) => a.id === agentId));
  const agentName = agent?.name ?? "Agent";
  const sessionMeta = useAgentStore((s) => s.sessionMeta[agentId]);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const markAsRead = useAgentStore((s) => s.markAsRead);

  const displayStatus = agent ? getDisplayStatus(agent.status) : "idle";
  const mt = agent ? modelTierConfig[getModelTier(agent.model)] : modelTierConfig.sonnet;
  const dotColor = getStatusDotColor(displayStatus);
  const dotGlow = displayStatus === "running" || displayStatus === "waiting" || displayStatus === "failed";

  // Defer body rendering on expand by one frame so the Canvas tier sync
  // effect can update the RF node height before we mount the body content.
  // Without this, the body tries to render inside a 48px container for one frame.
  const [showBody, setShowBody] = useState(!collapsed);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (collapsed) {
      // Collapse: hide body immediately (no delay needed)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setShowBody(false);
    } else {
      // Expand: wait one frame for RF node to resize, then show body
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setShowBody(true);
          rafRef.current = null;
        });
      });
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [collapsed]);

  // --- Tauri native drag & drop ---
  const composerRef = useRef<ChatComposerHandle>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tauriDropState = useTauriDropContext();

  const addImages = useCallback((images: import("@/types").ImageAttachment[]) => {
    composerRef.current?.addImages(images);
  }, []);

  const isDragOver = useDropTarget(agentId, bodyRef, addImages, tauriDropState);

  const handleMouseDown = useCallback(() => {
    markAsRead(agentId);
  }, [markAsRead, agentId]);

  const handleStop = useCallback(() => {
    stopAgent(agentId);
  }, [stopAgent, agentId]);

  const slashCommands = useMemo(
    () => {
      const cmds = sessionMeta?.slashCommands ?? [];
      const hasClear = cmds.some((c) => c.name === "clear");
      return hasClear ? cmds : [{ name: "clear", description: "Clear conversation history" }, ...cmds];
    },
    [sessionMeta],
  );

  return (
    <div
      data-agent-interactive
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
      onMouseDown={collapsed ? undefined : handleMouseDown}
    >
      {/* ── Header row — always rendered, stable across states ── */}
      <div
        className={!showBody ? undefined : "agent-card-header"}
        style={{
          display: "flex",
          alignItems: "center",
          padding: !showBody ? "0 8px" : "8px",
          height: !showBody ? "100%" : undefined,
          flexShrink: 0,
        }}
      >
        {/* [Chevron] — transparent bg, toggles direction */}
        <button
          type="button"
          onClick={collapsed ? onExpand : onCollapse}
          className="agent-card-icon-btn"
          style={{
            display: "grid", placeItems: "center",
            width: 24, height: 24, borderRadius: "50%",
            background: "none", border: "none", cursor: "pointer",
            color: "var(--studio-text-secondary)", flexShrink: 0,
          }}
          title={collapsed ? "Expand card" : "Collapse to pill"}
          aria-label={collapsed ? "Expand card" : "Collapse to pill"}
        >
          {collapsed
            ? <ChevronRight size={14} strokeWidth={2.5} />
            : <ChevronDown size={14} strokeWidth={2.5} />
          }
        </button>

        {/* [Dot] [Name] [Role] [spacer] [tokens?] [stop?] [badge] */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, padding: "0 6px" }}>
          {/* [Dot] */}
          <div
            className={displayStatus === "running" ? "studio-dot-pulse" : undefined}
            style={{
              width: 8, height: 8, borderRadius: "50%",
              backgroundColor: dotColor, flexShrink: 0,
              ...(dotGlow ? { boxShadow: `0 0 8px ${dotColor}60` } : {}),
            }}
          />

          {/* [Name] */}
          <span
            style={{
              fontSize: 16, fontWeight: 600,
              color: "var(--studio-text-primary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              letterSpacing: "-0.01em",
            }}
          >
            {agentName}
          </span>

          {/* [Role] */}
          {agent?.role && (
            <span
              className="text-sm text-muted-foreground truncate leading-none"
              style={{ maxWidth: !showBody ? 80 : 120, flexShrink: 1 }}
            >
              {agent.role}
            </span>
          )}

          {/* [context usage] */}
          <ContextUsageBar agentId={agentId} />

          {/* [spacer] */}
          <div style={{ flex: 1 }} />


          {/* [badge] — always visible, right-aligned before the last element */}
          <span
            className="agent-model-badge"
            style={{ background: mt.bg, color: mt.color, flexShrink: 0 }}
          >
            {mt.label}
          </span>
        </div>

        {/* Right edge: always show expand icon */}
        <button
          type="button"
          data-expand-button
          onClick={onExpandClick}
          className="agent-card-icon-btn"
          style={{
            display: "grid", placeItems: "center",
            width: 28, height: 28, borderRadius: "50%",
            background: "rgba(255,255,255,0.05)", border: "none", cursor: "pointer",
            color: "var(--studio-text-secondary)", flexShrink: 0,
            marginRight: 4,
          }}
          title="Open in focus view"
          aria-label="Open in focus view"
        >
          <Maximize2 size={13} strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Body — deferred until RF node has resized ── */}
      {showBody && (
        <div
          ref={bodyRef}
          className={active ? "nopan nodrag nowheel" : ""}
          style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative" }}
        >
          {/* Header separator */}
          <div className="agent-card-header-separator" style={{ margin: "0 12px" }} />

          {/* Chat View */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <ChatView key={agentId} agentId={agentId} />
          </div>

          {/* Chat Composer */}
          <ChatComposer
            ref={composerRef}
            agentName={agentName}
            sending={sending}
            slashCommands={slashCommands}
            agentRunning={displayStatus === "running"}
            onSend={handleSend}
            onStop={handleStop}
          />

          {/* Drop overlay — shown when Tauri drag is over this card */}
          {isDragOver && (
            <div className="drop-overlay">
              <div className="drop-overlay-content">
                <ImagePlus size={24} strokeWidth={1.5} />
                <span>Drop images here</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
