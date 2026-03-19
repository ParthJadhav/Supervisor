import { memo, useCallback, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { type Node as FlowNode, type NodeProps, NodeResizer } from "@xyflow/react";
import { Trash2, RotateCcw, Play } from "lucide-react";
import { useAgentStore } from "@/stores/agent-store";
import { useProjectStore } from "@/stores/project-store";
import type { Agent, AgentTier } from "@/types";
import { tintedBg, tintedBorder } from "@/lib/project-colors";
import { AgentNodeDeleteDialog } from "./AgentNodeDeleteDialog";
import { AgentCardUnified } from "./AgentCardUnified";
import { CanvasContextMenu, CanvasContextMenuItem, CanvasContextMenuDivider } from "./CanvasContextMenu";

const EXPANDED_DEFAULT = { width: 600, height: 500 };
const EXPANDED_MIN_WIDTH = 400;
const EXPANDED_MIN_HEIGHT = 350;

type AgentNodeData = {
  agent: Agent;
  onAgentClick?: (agentId: string) => void;
  projectColor?: string;
};

type AgentNodeNode = FlowNode<AgentNodeData>;

export const AgentNode = memo(({ data }: NodeProps<AgentNodeNode>) => {
  const { agent, onAgentClick, projectColor: _staticColor } = data;
  // Read project color reactively so it updates when changed in settings
  const projectColor = useProjectStore((s) => {
    if (!agent.project_id) return _staticColor;
    const project = s.projects.find((p) => p.id === agent.project_id);
    return project?.color || _staticColor;
  });
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const startAgent = useAgentStore((s) => s.startAgent);
  const setAgentTier = useAgentStore((s) => s.setAgentTier);
  const setAgentExpandedSize = useAgentStore((s) => s.setAgentExpandedSize);
  const bringToFront = useAgentStore((s) => s.bringToFront);

  // Read tier from store — default to expanded
  const tier: AgentTier = useAgentStore((s) => s.agentTiers[agent.id] || "expanded");
  const isCollapsed = tier === "collapsed";

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [active, setActive] = useState(false);
  const hideComposerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nodeRef = useRef<HTMLDivElement>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Deactivate when clicking anywhere outside this node and clear selection
  useEffect(() => {
    if (!active) return;
    const handleDeactivate = (e: MouseEvent) => {
      if (nodeRef.current && !nodeRef.current.contains(e.target as Node)) {
        // Clear selection synchronously before React re-renders
        window.getSelection()?.removeAllRanges();
        setActive(false);
      }
    };
    document.addEventListener("mousedown", handleDeactivate, true);
    return () => document.removeEventListener("mousedown", handleDeactivate, true);
  }, [active]);

  // Contain text selection within this card — prevent selection from bleeding
  // into sidebar, other agents, or any element outside the active card.
  // Uses selectstart event instead of global user-select:none to avoid
  // interfering with normal click-to-deselect browser behavior.
  useEffect(() => {
    if (!active) return;
    const handleSelectStart = (e: Event) => {
      // Allow selection only if it starts inside this card
      if (nodeRef.current && !nodeRef.current.contains(e.target as Node)) {
        e.preventDefault();
      }
    };
    document.addEventListener("selectstart", handleSelectStart, true);
    return () => {
      document.removeEventListener("selectstart", handleSelectStart, true);
      window.getSelection()?.removeAllRanges();
    };
  }, [active]);

  // Cleanup hideComposerTimer on unmount
  useEffect(() => {
    return () => clearTimeout(hideComposerTimer.current);
  }, []);

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!menuOpen) return;
    const handleClose = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleScroll = () => setMenuOpen(false);
    document.addEventListener("mousedown", handleClose, true);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClose, true);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuOpen]);

  const handleExpandClick = useCallback(() => {
    onAgentClick?.(agent.id);
  }, [onAgentClick, agent.id]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-expand-button]")) return;
    if (!isCollapsed) {
      if (target.closest("[data-agent-interactive]")) {
        setActive(true);
        return;
      }
    }
  }, [isCollapsed]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setMenuPos({ x, y });
    setMenuOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setDeleteDialogOpen(false);
    try {
      await deleteAgent(agent.id);
    } catch (err) {
      console.error("Failed to delete agent:", err);
    }
  }, [deleteAgent, agent.id]);

  const handleRestart = useCallback(() => {
    startAgent(agent.id);
    setMenuOpen(false);
  }, [startAgent, agent.id]);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hideComposerTimer.current);
    if (!isCollapsed) {
      bringToFront(agent.id);
    }
  }, [isCollapsed, bringToFront, agent.id]);

  const handleMouseLeave = useCallback(() => {
    hideComposerTimer.current = setTimeout(() => {
      setActive(false);
    }, 300);
  }, []);

  const handleResizeStart = useCallback(() => {
    setActive(true);
  }, []);

  // Collapse: store current size in store so Canvas can restore it on expand
  const handleCollapse = useCallback(() => {
    const el = nodeRef.current?.closest('.react-flow__node') as HTMLElement | null;
    if (el) {
      const w = parseFloat(el.style.width) || EXPANDED_DEFAULT.width;
      const h = parseFloat(el.style.height) || EXPANDED_DEFAULT.height;
      setAgentExpandedSize(agent.id, { width: w, height: h });
    }
    setAgentTier(agent.id, "collapsed");
  }, [agent.id, setAgentTier, setAgentExpandedSize]);

  // Expand: Canvas effect restores previous size
  const handleExpand = useCallback(() => {
    setAgentTier(agent.id, "expanded");
  }, [agent.id, setAgentTier]);

  // Project color border — always visible; state is shown via ::before ring
  const borderColor = projectColor ? tintedBorder(projectColor, 0.20) : undefined;

  const cardClasses = [
    "agent-node-card",
    isCollapsed ? "agent-node-card--collapsed" : "",
    active ? "agent-node-card--active" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      {/* NodeResizer — only when expanded */}
      {!isCollapsed && (
        <NodeResizer
          minWidth={EXPANDED_MIN_WIDTH}
          minHeight={EXPANDED_MIN_HEIGHT}
          isVisible
          onResizeStart={handleResizeStart}
          lineStyle={{ borderColor: "transparent", borderWidth: 20 }}
          handleStyle={{
            backgroundColor: "transparent",
            border: "none",
            width: 24,
            height: 24,
            borderRadius: 0,
          }}
        />
      )}

      <div
        ref={nodeRef}
        className={cardClasses}
        style={{
          background: tintedBg(projectColor, 0.06),
          ...(borderColor ? { borderColor } : {}),
          borderRadius: isCollapsed ? 24 : 14,
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <AgentCardUnified
          agentId={agent.id}
          collapsed={isCollapsed}
          active={active}
          onExpandClick={handleExpandClick}
          onCollapse={handleCollapse}
          onExpand={handleExpand}
        />
      </div>

      {/* Right-click context menu portaled to body at cursor position */}
      {menuOpen && createPortal(
        <CanvasContextMenu
          ref={menuRef}
          x={menuPos.x}
          y={menuPos.y}
          onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}
        >
          <CanvasContextMenuItem
            icon={<Play size={16} />}
            label="Open"
            onClick={() => { setMenuOpen(false); onAgentClick?.(agent.id); }}
          />
          <CanvasContextMenuItem
            icon={<RotateCcw size={16} />}
            label="Restart"
            onClick={() => { handleRestart(); }}
          />
          <CanvasContextMenuDivider />
          <CanvasContextMenuItem
            icon={<Trash2 size={16} />}
            label="Delete"
            destructive
            onClick={() => { setMenuOpen(false); setDeleteDialogOpen(true); }}
          />
        </CanvasContextMenu>,
        document.body,
      )}

      <AgentNodeDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        agentName={agent.name}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
});

AgentNode.displayName = "AgentNode";
