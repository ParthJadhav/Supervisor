import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow, type Node, type NodeChange } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "../stores/agent-store";
import type { AgentTier } from "../types";

interface NodePosition {
  node_id: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  tier: string | null;
}

const PROJECT_TOOLBAR_HEIGHT = 72;

interface UseCanvasPositionsOptions {
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  buildDeletePreview: (nodeIds: string[]) => { projects: any[]; agents: any[] } | null;
  setPendingDeletePreview: (preview: { projects: any[]; agents: any[] } | null) => void;
}

/**
 * Handles loading saved canvas positions from the backend on mount,
 * and persisting position/size changes with debounced saves.
 */
export function useCanvasPositions({
  onNodesChange,
  setNodes,
  buildDeletePreview,
  setPendingDeletePreview,
}: UseCanvasPositionsOptions) {
  const initAgentTiers = useAgentStore((s) => s.initAgentTiers);

  // Saved positions/sizes from DB -- used only for initial node construction
  const [savedPositions, setSavedPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [savedSizes, setSavedSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [positionsLoaded, setPositionsLoaded] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSyncTime = useRef(0);

  const { getNodes } = useReactFlow();

  // Load positions from DB on mount
  useEffect(() => {
    let ignore = false;
    invoke<NodePosition[]>("load_canvas_positions").then((positions) => {
      if (ignore) return;
      const posMap: Record<string, { x: number; y: number }> = {};
      const sizeMap: Record<string, { width: number; height: number }> = {};
      const tierMap: Record<string, AgentTier> = {};
      for (const p of positions) {
        posMap[p.node_id] = { x: p.x, y: p.y };
        if (p.width != null && p.height != null) {
          sizeMap[p.node_id] = { width: p.width, height: p.height };
        }
        if (p.tier) {
          tierMap[p.node_id.replace("agent-", "")] = p.tier as AgentTier;
        }
      }
      setSavedPositions(posMap);
      setSavedSizes(sizeMap);
      initAgentTiers(tierMap);
      setPositionsLoaded(true);
    }).catch(() => {
      if (!ignore) setPositionsLoaded(true);
    });
    return () => { ignore = true; };
  }, [initAgentTiers]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
    };
  }, []);

  /** Mark that a structural sync just happened (dimension changes within 500ms are ignored). */
  const markSyncTime = useCallback(() => {
    lastSyncTime.current = Date.now();
  }, []);

  // Node change handler with targeted dimension sync
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      // Intercept remove changes -- show confirmation instead of removing directly
      const removeChanges = changes.filter((c) => c.type === "remove");
      if (removeChanges.length > 0) {
        const nonRemoveChanges = changes.filter((c) => c.type !== "remove");
        if (nonRemoveChanges.length > 0) {
          onNodesChange(nonRemoveChanges);
        }

        const selectedNodeIds = getNodes()
          .filter((node) => node.selected)
          .map((node) => node.id);

        const preview = buildDeletePreview(
          selectedNodeIds.length > 0
            ? selectedNodeIds
            : removeChanges.map((change) => change.id),
        );

        if (preview) {
          setPendingDeletePreview(preview);
        }
        return;
      }

      // Clamp bound agents so they can't overlap the project toolbar
      const clampedChanges = changes.map((c) => {
        if (c.type === "position" && c.position) {
          const node = getNodes().find((n) => n.id === c.id);
          if (node?.parentId && node.type === "agent" && c.position.y < PROJECT_TOOLBAR_HEIGHT) {
            return { ...c, position: { ...c.position, y: PROJECT_TOOLBAR_HEIGHT } };
          }
        }
        return c;
      });
      onNodesChange(clampedChanges);

      // Skip dimension handling if within debounce window of a sync
      const now = Date.now();
      if (now - lastSyncTime.current < 500) return;

      const hasMoveOrResize = changes.some(
        (c) => c.type === "position" || c.type === "dimensions",
      );
      if (!hasMoveOrResize) return;

      // Only sync dimensions for specific nodes that changed
      const dimensionChanges = changes.filter((c) => c.type === "dimensions") as Array<{ type: "dimensions"; id: string }>;
      if (dimensionChanges.length > 0) {
        const changedIds = new Set(dimensionChanges.map((c) => c.id));
        lastSyncTime.current = now;

        const currentTiersSnap = useAgentStore.getState().agentTiers;
        setNodes((nds) =>
          nds.map((n) => {
            if (!changedIds.has(n.id)) return n;
            if (!n.measured?.width || !n.measured?.height) return n;

            // Never overwrite collapsed pill dimensions -- height is fixed
            if (n.type === "agent") {
              const agentId = (n.data as any)?.agent?.id;
              if (agentId && currentTiersSnap[agentId] === "collapsed") return n;
            }

            const sw = n.style?.width as number | undefined;
            const sh = n.style?.height as number | undefined;
            if (sw === n.measured.width && sh === n.measured.height) return n;

            return {
              ...n,
              style: { ...n.style, width: n.measured.width, height: n.measured.height },
            };
          }),
        );
      }

      // Debounced save to backend
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const currentTiers = useAgentStore.getState().agentTiers;
        setNodes((current) => {
          const positions: NodePosition[] = current.map((n) => {
            const agentId = n.type === "agent" ? (n.data as any)?.agent?.id : null;
            return {
              node_id: n.id,
              x: n.position.x,
              y: n.position.y,
              width: (n.style?.width as number) ?? n.measured?.width ?? null,
              height: (n.style?.height as number) ?? n.measured?.height ?? null,
              tier: agentId ? (currentTiers[agentId] || "expanded") : null,
            };
          });
          invoke("save_canvas_positions", { positions }).catch(console.error);
          return current;
        });
      }, 300);
    },
    [buildDeletePreview, getNodes, onNodesChange, setNodes, setPendingDeletePreview],
  );

  return {
    positionsLoaded,
    savedPositions,
    savedSizes,
    handleNodesChange,
    markSyncTime,
  };
}
