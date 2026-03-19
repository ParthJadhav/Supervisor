import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Plus, FolderPlus, RotateCcw } from "lucide-react";
import { useStableCallback } from "../../hooks/use-stable-callback";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type NodeTypes,
  BackgroundVariant,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AgentNode } from "./AgentNode";
import { AgentNodeDeleteDialog } from "./AgentNodeDeleteDialog";
import type { DeletePreviewProject, DeletePreviewAgent } from "./AgentNodeDeleteDialog";
import { CanvasControls } from "./CanvasControls";
import { CanvasContextMenu, CanvasContextMenuItem, CanvasContextMenuDivider } from "./CanvasContextMenu";
import { ProjectZone } from "./ProjectZone";
import { EmptyState } from "./EmptyState";
import { useCanvasKeyboard } from "../../hooks/use-canvas-keyboard";
import { useCanvasContextMenu } from "../../hooks/use-canvas-context-menu";
import { useCanvasPositions } from "../../hooks/use-canvas-positions";
import { useAgentStore } from "../../stores/agent-store";
import { useProjectStore } from "../../stores/project-store";
import { cn } from "../../lib/utils";
import type { Agent, AgentStatus, AgentTier, Project } from "../../types";
import type { FilterScope } from "../../stores/agent-store";

// ── Filter helpers ──

function agentMatchesQuery(agent: Agent, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  return (
    agent.name.toLowerCase().includes(q) ||
    (agent.role ?? "").toLowerCase().includes(q) ||
    agent.model.toLowerCase().includes(q)
  );
}

function projectMatchesQuery(project: Project, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  return (
    project.name.toLowerCase().includes(q) ||
    project.path.toLowerCase().includes(q)
  );
}

function agentMatchesStatus(agent: Agent, status: AgentStatus | null): boolean {
  if (status === null) return true;
  if (status === "running") return agent.status === "running";
  if (status === "waiting_input") return agent.status === "waiting_input";
  if (status === "created")
    return agent.status !== "running" && agent.status !== "waiting_input";
  return agent.status === status;
}

function agentMatchesFilter(
  agent: Agent,
  query: string,
  status: AgentStatus | null,
  scope: FilterScope,
  projectMap: Map<string, Project>,
): boolean {
  if (scope === "projects") {
    if (!agent.project_id) return false;
    const project = projectMap.get(agent.project_id);
    return project ? projectMatchesQuery(project, query) : false;
  }
  const directMatch = agentMatchesQuery(agent, query);
  const project = agent.project_id ? projectMap.get(agent.project_id) : undefined;
  const projectMatch =
    scope === "all" && agent.project_id && project
      ? projectMatchesQuery(project, query)
      : false;
  if (!directMatch && !projectMatch) return false;
  return agentMatchesStatus(agent, status);
}

function projectMatchesFilter(
  project: Project,
  query: string,
  scope: FilterScope,
): boolean {
  if (scope === "agents") return false;
  return projectMatchesQuery(project, query);
}

// ── Tier dimension defaults ──

const PROJECT_TOOLBAR_HEIGHT = 72;
const AGENT_COLLAPSED_HEIGHT = 48;

const TIER_DIMS: Record<AgentTier, { width: number; height: number }> = {
  expanded: { width: 600, height: 500 },
  collapsed: { width: 600, height: AGENT_COLLAPSED_HEIGHT },
};

// ── Constants ──

const nodeTypes = {
  agent: AgentNode,
  projectZone: ProjectZone,
} satisfies NodeTypes;

interface DeletePreview {
  projects: DeletePreviewProject[];
  agents: DeletePreviewAgent[];
}

const AGENT_WIDTH = 280;
const AGENT_HEIGHT = 140;
const COLLISION_PADDING = 10;

// ── Helpers ──

/** Get a stable set of agent IDs for structural comparison */
function getAgentIdSet(agents: Agent[]): string {
  return agents.map((a) => a.id).sort().join(",");
}

/** Get a stable set of project IDs for structural comparison */
function getProjectIdSet(projects: Project[]): string {
  return projects.map((p) => p.id).sort().join(",");
}

const noop = (_id: string) => {};

// ── Canvas ──

interface CanvasInnerProps {
  onCreateAgent?: () => void;
  onCreateProject?: () => void;
  onAgentClick?: (agentId: string) => void;
}

function CanvasInner({ onCreateAgent, onCreateProject, onAgentClick }: CanvasInnerProps) {
  const agents = useAgentStore((s) => s.agents);
  const projects = useProjectStore((s) => s.projects);
  const canvasFilter = useAgentStore((s) => s.canvasFilter);
  const agentTiers = useAgentStore((s) => s.agentTiers);
  const agentExpandedSizes = useAgentStore((s) => s.agentExpandedSizes);

  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  const hasActiveFilter = canvasFilter.query !== "" || canvasFilter.status !== null;

  // Delete confirmation state for React Flow node removals
  const [pendingDeletePreview, setPendingDeletePreview] = useState<DeletePreview | null>(null);

  // ── Extracted hooks ──
  const { spaceHeld } = useCanvasKeyboard();
  const { contextMenu, ctxMenuRef, handleContextMenu: handleCanvasContextMenu, closeContextMenu } = useCanvasContextMenu();

  const stableAgentClick = useStableCallback(onAgentClick ?? noop);

  const buildDeletePreview = useCallback((nodeIds: string[]): DeletePreview | null => {
    if (nodeIds.length === 0) return null;

    const selectedProjectIds = new Set<string>();
    const selectedAgentIds = new Set<string>();

    for (const nodeId of nodeIds) {
      if (nodeId.startsWith("project-")) {
        selectedProjectIds.add(nodeId.replace("project-", ""));
      } else if (nodeId.startsWith("agent-")) {
        selectedAgentIds.add(nodeId.replace("agent-", ""));
      }
    }

    const currentAgents = useAgentStore.getState().agents;
    const currentProjects = useProjectStore.getState().projects;
    const currentProjectMap = new Map(currentProjects.map((project) => [project.id, project]));

    const previewProjects = currentProjects
      .filter((project) => selectedProjectIds.has(project.id))
      .map((project) => {
        const agentsInProject = currentAgents.filter((agent) => agent.project_id === project.id);
        const selectedChildAgentCount = agentsInProject.filter((agent) => selectedAgentIds.has(agent.id)).length;

        return {
          id: project.id,
          name: project.name,
          path: project.path,
          selectedChildAgentCount,
          remainingAgentCount: agentsInProject.length - selectedChildAgentCount,
        };
      });

    const previewAgents = currentAgents
      .filter((agent) => selectedAgentIds.has(agent.id))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        projectName: agent.project_id ? currentProjectMap.get(agent.project_id)?.name ?? null : null,
      }));

    if (previewProjects.length === 0 && previewAgents.length === 0) return null;

    return {
      projects: previewProjects,
      agents: previewAgents,
    };
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges] = useEdgesState([]);

  const {
    positionsLoaded,
    savedPositions,
    savedSizes,
    handleNodesChange,
    markSyncTime,
  } = useCanvasPositions({
    onNodesChange,
    setNodes,
    buildDeletePreview,
    setPendingDeletePreview,
  });

  const { getNodes, fitBounds, fitView } = useReactFlow();

  const fitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasInitialFit = useRef(false);

  // Cleanup fitTimer on unmount
  useEffect(() => {
    return () => {
      clearTimeout(fitTimer.current);
    };
  }, []);

  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  // ── Structural IDs for detecting add/remove ──
  const agentIdSet = useMemo(() => getAgentIdSet(agents), [agents]);
  const projectIdSet = useMemo(() => getProjectIdSet(projects), [projects]);

  // ── Build nodes — only called for initial construction and structural changes ──
  // Reads agents/projects imperatively from store to avoid re-triggering on status changes
  const buildNodes = useCallback(() => {
    const currentAgents = useAgentStore.getState().agents;
    const currentProjects = useProjectStore.getState().projects;
    const currentTiers = useAgentStore.getState().agentTiers;

    // Read live React Flow nodes to preserve user-modified positions/sizes
    const existingNodes = getNodes();
    const existingNodeMap = new Map(existingNodes.map((n) => [n.id, n]));

    const projectAgents = new Map<string, Agent[]>();
    const freeAgents = currentAgents.filter((a) => {
      if (a.project_id) {
        const list = projectAgents.get(a.project_id) || [];
        list.push(a);
        projectAgents.set(a.project_id, list);
        return false;
      }
      return true;
    });

    const projectNodes: Node[] = currentProjects.map((project, i) => {
      const id = `project-${project.id}`;
      const existing = existingNodeMap.get(id);
      const saved = savedSizes[id];
      return {
        id,
        type: "projectZone",
        position: existing?.position || savedPositions[id] || { x: 50, y: i * 1150 + 50 },
        data: { project, agentCount: (projectAgents.get(project.id) || []).length },
        style: existing?.style || { width: saved?.width || 1300, height: saved?.height || 1100 },
      };
    });

    const expandedSizes = useAgentStore.getState().agentExpandedSizes;
    const getAgentDims = (agentId: string, nodeId: string, tier: AgentTier) => {
      // Resolve the width the user has set (or default)
      const existing = existingNodeMap.get(nodeId);
      const existingWidth = existing?.style?.width as number | undefined;
      const savedWidth = savedSizes[nodeId]?.width;
      const storedWidth = expandedSizes[agentId]?.width;
      const resolvedWidth = existingWidth || savedWidth || storedWidth || TIER_DIMS.expanded.width;

      if (tier === "collapsed") {
        // Keep the user's width, only collapse the height
        return { width: resolvedWidth, height: AGENT_COLLAPSED_HEIGHT };
      }
      // Expanded: use existing node style, saved size, stored expanded size, or default
      if (existing?.style) return existing.style;
      const saved = savedSizes[nodeId];
      if (saved) return { width: saved.width, height: saved.height };
      const stored = expandedSizes[agentId];
      if (stored) return stored;
      return TIER_DIMS.expanded;
    };

    // Build a project color lookup
    const projectColorMap = new Map<string, string>();
    for (const p of currentProjects) {
      projectColorMap.set(p.id, p.color || "gray");
    }

    const boundAgentNodes: Node[] = [];
    for (const [projectId, agentsInProject] of projectAgents) {
      const projectColor = projectColorMap.get(projectId) || "gray";
      agentsInProject.forEach((agent, i) => {
        const id = `agent-${agent.id}`;
        const existing = existingNodeMap.get(id);
        const tier = currentTiers[agent.id] || "expanded";
        boundAgentNodes.push({
          id,
          type: "agent",
          position: existing?.position || savedPositions[id] || { x: (i % 2) * 620 + 10, y: Math.floor(i / 2) * 520 + PROJECT_TOOLBAR_HEIGHT + 8 },
          data: { agent, onAgentClick: stableAgentClick, projectColor },
          parentId: `project-${projectId}`,
          extent: "parent" as const,
          style: getAgentDims(agent.id, id, tier),
        });
      });
    }

    const freeX = currentProjects.length > 0 ? 700 : 50;
    const freeAgentNodes: Node[] = freeAgents.map((agent, i) => {
      const id = `agent-${agent.id}`;
      const existing = existingNodeMap.get(id);
      const tier = currentTiers[agent.id] || "expanded";
      return {
        id,
        type: "agent",
        position: existing?.position || savedPositions[id] || { x: freeX + (i % 2) * 620, y: Math.floor(i / 2) * 520 + 50 },
        data: { agent, onAgentClick: stableAgentClick },
        style: getAgentDims(agent.id, id, tier),
      };
    });

    return [...projectNodes, ...boundAgentNodes, ...freeAgentNodes];
    // Deps are STRUCTURAL ONLY — agents/projects read imperatively from store
  }, [agentIdSet, projectIdSet, savedPositions, savedSizes, stableAgentClick, getNodes]);

  // ── ISSUE 2 FIX: Structural sync — full rebuild only when nodes added/removed ──
  useEffect(() => {
    if (!positionsLoaded) return;
    markSyncTime();
    setNodes(buildNodes());

    // Safety net: if positions loaded before agents, agents array may still be
    // empty.  Re-fetch once after a short delay to catch the race condition
    // where the initial fetchAgents IPC failed silently on webview refresh.
    const currentAgents = useAgentStore.getState().agents;
    if (currentAgents.length === 0) {
      const timer = setTimeout(() => {
        const { agents, fetchAgents } = useAgentStore.getState();
        if (agents.length === 0) fetchAgents().catch(() => {});
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [buildNodes, setNodes, positionsLoaded, markSyncTime]);

  // ── ISSUE 2 FIX: Data-only sync — update agent objects in existing nodes without touching style/position ──
  // This runs on every agents change but does NOT reconstruct nodes — only patches the agent data.
  useEffect(() => {
    if (!positionsLoaded) return;
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const projectList = projects;
    const projectAgentCounts = new Map<string, number>();
    for (const a of agents) {
      if (a.project_id) {
        projectAgentCounts.set(a.project_id, (projectAgentCounts.get(a.project_id) || 0) + 1);
      }
    }

    setNodes((currentNodes) =>
      currentNodes.map((n) => {
        if (n.type === "agent") {
          const agentId = (n.data as any).agent?.id;
          const updatedAgent = agentMap.get(agentId);
          // Ensure bound agents always have extent: "parent" for containment
          const needsExtent = n.parentId && n.extent !== "parent";
          if (updatedAgent && updatedAgent !== (n.data as any).agent) {
            return { ...n, data: { ...n.data, agent: updatedAgent }, ...(needsExtent ? { extent: "parent" as const } : {}) };
          }
          if (needsExtent) {
            return { ...n, extent: "parent" as const };
          }
        } else if (n.type === "projectZone") {
          const projectId = n.id.replace("project-", "");
          const updatedProject = projectList.find((p) => p.id === projectId);
          const count = projectAgentCounts.get(projectId) || 0;
          if (updatedProject && (updatedProject !== (n.data as any).project || count !== (n.data as any).agentCount)) {
            return { ...n, data: { ...n.data, project: updatedProject, agentCount: count } };
          }
        }
        return n;
      }),
    );
  }, [agents, projects, positionsLoaded, setNodes]);

  // ── Tier sync — update node dimensions when tier changes (collapse/expand) ──
  // Track the previous tier for each agent so we only apply dimension changes on actual transitions
  const prevTiersRef = useRef<Record<string, AgentTier>>({});
  useEffect(() => {
    if (!positionsLoaded) return;
    const prevTiers = prevTiersRef.current;
    const changed = new Set<string>();
    for (const [agentId, tier] of Object.entries(agentTiers)) {
      if (prevTiers[agentId] !== tier) changed.add(agentId);
    }
    prevTiersRef.current = { ...agentTiers };
    if (changed.size === 0) return;

    setNodes((currentNodes) =>
      currentNodes.map((n) => {
        if (n.type !== "agent") return n;
        const agentId = (n.data as any).agent?.id;
        if (!agentId || !changed.has(agentId)) return n;
        const tier = agentTiers[agentId];
        if (tier === "collapsed") {
          // Keep the current width, only collapse the height
          const currentWidth = (n.style?.width as number) || agentExpandedSizes[agentId]?.width || TIER_DIMS.expanded.width;
          return { ...n, width: undefined, height: undefined, style: { width: currentWidth, height: AGENT_COLLAPSED_HEIGHT } };
        } else {
          // Expanding — restore stored size or default
          const stored = agentExpandedSizes[agentId];
          const size = stored || TIER_DIMS.expanded;
          return { ...n, width: undefined, height: undefined, style: { width: size.width, height: size.height } };
        }
      }),
    );
  }, [agentTiers, agentExpandedSizes, positionsLoaded, setNodes]);

  // ── Filter opacity effect — separate from node sync ──
  useEffect(() => {
    if (!positionsLoaded) return;
    const { query, status, scope } = canvasFilter;

    const projectsWithMatch = new Set<string>();
    if (hasActiveFilter) {
      for (const agent of agents) {
        if (agent.project_id && agentMatchesFilter(agent, query, status, scope, projectMap)) {
          projectsWithMatch.add(agent.project_id);
        }
      }
      for (const project of projects) {
        if (projectMatchesFilter(project, query, scope)) {
          projectsWithMatch.add(project.id);
        }
      }
    }

    setNodes((currentNodes) =>
      currentNodes.map((n) => {
        let opacity = 1;
        if (hasActiveFilter) {
          if (n.type === "agent") {
            const agent = (n.data as { agent: Agent }).agent;
            const matches = agentMatchesFilter(agent, query, status, scope, projectMap);
            const agentProject = agent.project_id ? projectMap.get(agent.project_id) : undefined;
            const projectDirectMatch = agent.project_id && agentProject
              ? projectsWithMatch.has(agent.project_id) && projectMatchesFilter(agentProject, query, scope)
              : false;
            opacity = (matches || projectDirectMatch) ? 1 : 0.15;
          } else if (n.type === "projectZone") {
            const projectId = n.id.replace("project-", "");
            opacity = projectsWithMatch.has(projectId) ? 1 : 0.3;
          }
        }
        const currentOpacity = (n.style as any)?.opacity;
        if (currentOpacity === opacity) return n;
        return { ...n, style: { ...n.style, opacity, transition: "opacity 150ms ease" } };
      }),
    );
  }, [positionsLoaded, hasActiveFilter, canvasFilter.query, canvasFilter.status, canvasFilter.scope, agents, projects, projectMap, setNodes]);

  // ── One-time fitView after initial nodes are rendered ──
  const stableFitView = useStableCallback(fitView);
  useEffect(() => {
    if (!positionsLoaded || hasInitialFit.current) return;
    hasInitialFit.current = true;
    const timer = setTimeout(() => {
      stableFitView({ padding: 0.2, duration: 0 });
    }, 100);
    return () => clearTimeout(timer);
  }, [positionsLoaded, stableFitView]);

  // ── Pan to a specific agent when requested (e.g. after creation) ──
  const pendingFocusAgentId = useAgentStore((s) => s.pendingFocusAgentId);
  const clearPendingFocus = useAgentStore((s) => s.clearPendingFocus);

  useEffect(() => {
    if (!positionsLoaded || !pendingFocusAgentId) return;
    const nodeId = `agent-${pendingFocusAgentId}`;

    // Small delay to let the node render first
    const timer = setTimeout(() => {
      const currentNodes = getNodes();
      const node = currentNodes.find((n) => n.id === nodeId);
      if (!node) {
        clearPendingFocus();
        return;
      }

      let absX = node.position.x;
      let absY = node.position.y;
      if (node.parentId) {
        const parent = currentNodes.find((n) => n.id === node.parentId);
        if (parent) { absX += parent.position.x; absY += parent.position.y; }
      }
      const w = node.measured?.width ?? (node.style?.width as number) ?? AGENT_WIDTH;
      const h = node.measured?.height ?? (node.style?.height as number) ?? AGENT_HEIGHT;

      fitBounds(
        { x: absX, y: absY, width: w, height: h },
        { padding: 0.5, duration: 500 },
      );
      clearPendingFocus();
    }, 300);

    return () => clearTimeout(timer);
  }, [positionsLoaded, pendingFocusAgentId, getNodes, fitBounds, clearPendingFocus]);

  // ── Smoothly pan to matching nodes when filter changes ──
  useEffect(() => {
    if (!positionsLoaded || !hasActiveFilter) return;
    const { query, status, scope } = canvasFilter;

    clearTimeout(fitTimer.current);
    fitTimer.current = setTimeout(() => {
      const currentNodes = getNodes();
      const matchingNodes = currentNodes.filter((n) => {
        if (n.type === "agent") {
          const agent = (n.data as { agent: Agent }).agent;
          if (agentMatchesFilter(agent, query, status, scope, projectMap)) return true;
          if (agent.project_id) {
            const project = projectMap.get(agent.project_id);
            if (project && projectMatchesFilter(project, query, scope)) return true;
          }
          return false;
        }
        if (n.type === "projectZone") {
          const projectId = n.id.replace("project-", "");
          const project = projectMap.get(projectId);
          return project ? projectMatchesFilter(project, query, scope) : false;
        }
        return false;
      });

      if (matchingNodes.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const node of matchingNodes) {
        let absX = node.position.x;
        let absY = node.position.y;
        if (node.parentId) {
          const parent = currentNodes.find((n) => n.id === node.parentId);
          if (parent) { absX += parent.position.x; absY += parent.position.y; }
        }
        const w = node.measured?.width ?? (node.type === "projectZone" ? ((node.style?.width as number) ?? 600) : AGENT_WIDTH);
        const h = node.measured?.height ?? (node.type === "projectZone" ? ((node.style?.height as number) ?? 300) : AGENT_HEIGHT);
        minX = Math.min(minX, absX);
        minY = Math.min(minY, absY);
        maxX = Math.max(maxX, absX + w);
        maxY = Math.max(maxY, absY + h);
      }

      fitBounds(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        { padding: 0.3, duration: 500 },
      );
    }, 400);

    return () => clearTimeout(fitTimer.current);
  }, [positionsLoaded, hasActiveFilter, canvasFilter.query, canvasFilter.status, canvasFilter.scope, getNodes, fitBounds, projectMap]);

  // ── Prevent free agents from overlapping project zones ──
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      if (draggedNode.type !== "agent" || draggedNode.parentId) return;

      const allNodes = getNodes();
      const projectZones = allNodes.filter((n) => n.type === "projectZone");

      const aw = draggedNode.measured?.width ?? AGENT_WIDTH;
      const ah = draggedNode.measured?.height ?? AGENT_HEIGHT;
      let { x: ax, y: ay } = draggedNode.position;

      for (const zone of projectZones) {
        const zw = (zone.style?.width as number) ?? 600;
        const zh = (zone.style?.height as number) ?? 300;
        const zx = zone.position.x;
        const zy = zone.position.y;

        const overlapX = ax < zx + zw && ax + aw > zx;
        const overlapY = ay < zy + zh && ay + ah > zy;

        if (overlapX && overlapY) {
          const pushLeft = zx - (ax + aw);
          const pushRight = zx + zw - ax;
          const pushUp = zy - (ay + ah);
          const pushDown = zy + zh - ay;

          const distances = [
            { dx: pushLeft - COLLISION_PADDING, dy: 0 },
            { dx: pushRight + COLLISION_PADDING, dy: 0 },
            { dx: 0, dy: pushUp - COLLISION_PADDING },
            { dx: 0, dy: pushDown + COLLISION_PADDING },
          ];

          const shortest = distances.reduce((min, d) =>
            Math.abs(d.dx) + Math.abs(d.dy) < Math.abs(min.dx) + Math.abs(min.dy) ? d : min,
          );

          ax += shortest.dx;
          ay += shortest.dy;
        }
      }

      if (ax !== draggedNode.position.x || ay !== draggedNode.position.y) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === draggedNode.id ? { ...n, position: { x: ax, y: ay } } : n,
          ),
        );
      }
    },
    [getNodes, setNodes],
  );

  // ── Handle confirmed deletion from the dialog ──
  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeletePreview) return;

    const { agents: previewAgents, projects: previewProjects } = pendingDeletePreview;
    setPendingDeletePreview(null);

    const errors: Array<{ type: string; id: string; error: unknown }> = [];

    for (const agent of previewAgents) {
      try {
        await deleteAgent(agent.id);
      } catch (err) {
        errors.push({ type: "agent", id: agent.id, error: err });
      }
    }

    for (const project of previewProjects) {
      try {
        await deleteProject(project.id);
      } catch (err) {
        errors.push({ type: "project", id: project.id, error: err });
      }
    }

    if (errors.length > 0) {
      console.error(`Failed to delete ${errors.length} item(s):`, errors);
    }
  }, [pendingDeletePreview, deleteAgent, deleteProject]);

  const isEmpty = agents.length === 0 && projects.length === 0;

  return (
    <div className="w-full h-full relative" onContextMenu={handleCanvasContextMenu}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        className={cn("!bg-background", spaceHeld && "cursor-grab")}
        panOnScroll
        panOnScrollSpeed={1.5}
        zoomOnScroll={false}
        zoomOnPinch
        selectionOnDrag={!spaceHeld}
        panOnDrag={spaceHeld ? [0] : false}
        minZoom={0.3}
        maxZoom={1}
        selectionMode={SelectionMode.Partial}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={32}
          size={1}
          className={cn(
            "transition-[fill] duration-300 ease-out",
            hasActiveFilter ? "!fill-muted-foreground/2" : "!fill-muted-foreground/8",
          )}
        />
        <CanvasControls />
      </ReactFlow>

      {isEmpty && positionsLoaded && onCreateAgent && onCreateProject && (
        <EmptyState
          onCreateAgent={onCreateAgent}
          onCreateProject={onCreateProject}
        />
      )}

      <AgentNodeDeleteDialog
        open={pendingDeletePreview !== null}
        onOpenChange={(open) => { if (!open) setPendingDeletePreview(null); }}
        projects={pendingDeletePreview?.projects ?? []}
        agents={pendingDeletePreview?.agents ?? []}
        onConfirm={handleConfirmDelete}
      />

      {contextMenu.open && createPortal(
        <CanvasContextMenu
          ref={ctxMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          onKeyDown={(e) => { if (e.key === "Escape") closeContextMenu(); }}
        >
          <CanvasContextMenuItem
            icon={<Plus size={16} />}
            label="New Agent"
            onClick={() => { closeContextMenu(); onCreateAgent?.(); }}
          />
          <CanvasContextMenuItem
            icon={<FolderPlus size={16} />}
            label="New Project"
            onClick={() => { closeContextMenu(); onCreateProject?.(); }}
          />
          <CanvasContextMenuDivider />
          <CanvasContextMenuItem
            icon={<RotateCcw size={16} />}
            label="Reload"
            onClick={() => { closeContextMenu(); window.location.reload(); }}
          />
        </CanvasContextMenu>,
        document.body,
      )}
    </div>
  );
}

interface CanvasProps {
  onCreateAgent?: () => void;
  onCreateProject?: () => void;
  onAgentClick?: (agentId: string) => void;
}

export function Canvas({ onCreateAgent, onCreateProject, onAgentClick }: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner onCreateAgent={onCreateAgent} onCreateProject={onCreateProject} onAgentClick={onAgentClick} />
    </ReactFlowProvider>
  );
}
