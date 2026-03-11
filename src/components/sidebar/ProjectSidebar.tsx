import { useMemo, useState, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentStore } from "@/stores/agent-store";
import { useProjectStore } from "@/stores/project-store";
import { useLayerStore } from "@/stores/layer-store";
import type { Agent, AgentStatus } from "@/types";
import { ProjectGroup } from "./ProjectGroup";
import { SidebarRail } from "./SidebarRail";
import { UngroupedIcon } from "./icons";
import { AgentItem } from "./AgentItem";
import { cn } from "@/lib/utils";

function sortAgents(agents: Agent[]): Agent[] {
  const statusOrder: Record<AgentStatus, number> = {
    running: 0,
    waiting_input: 1,
    created: 2,
    completed: 3,
    stopped: 4,
    failed: 5,
  };
  return [...agents].sort((a, b) => {
    const sa = statusOrder[a.status];
    const sb = statusOrder[b.status];
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

export function ProjectSidebar() {
  const agents = useAgentStore((s) => s.agents);
  const projects = useProjectStore((s) => s.projects);
  const sidebarExpanded = useLayerStore((s) => s.sidebarExpanded);
  const toggleSidebar = useLayerStore((s) => s.toggleSidebar);
  const enterFocus = useLayerStore((s) => s.enterFocus);
  const requestFocusAgent = useAgentStore((s) => s.requestFocusAgent);

  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [ungroupedExpanded, setUngroupedExpanded] = useState(false);

  useEffect(() => {
    if (expandedProjectId === "ungrouped") setUngroupedExpanded(true);
  }, [expandedProjectId]);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  );

  const agentsByProject = useMemo(() => {
    const map: Record<string, Agent[]> = {};
    for (const agent of agents) {
      const key = agent.project_id ?? "__ungrouped__";
      (map[key] ??= []).push(agent);
    }
    // Sort agents within each group
    for (const key of Object.keys(map)) {
      map[key] = sortAgents(map[key]);
    }
    return map;
  }, [agents]);

  const ungroupedAgents = agentsByProject["__ungrouped__"] ?? [];

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      requestFocusAgent(agentId);
    },
    [requestFocusAgent]
  );

  const handleFocusAgent = useCallback(
    (agentId: string) => {
      enterFocus(agentId);
    },
    [enterFocus]
  );

  const handleRailExpand = useCallback(
    (projectId?: string) => {
      toggleSidebar();
      if (projectId) {
        setExpandedProjectId(projectId);
      }
    },
    [toggleSidebar]
  );

  return (
    <div
      className={cn(
        "h-full shrink-0 studio-glass border-r border-border/50 flex flex-col transition-[width] duration-200 ease-out overflow-hidden select-none",
        sidebarExpanded ? "w-[260px]" : "w-11"
      )}
    >
      {sidebarExpanded ? (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
              Projects
            </span>
            <button
              className="p-1 rounded-sm hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={toggleSidebar}
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>

          {/* Tree */}
          <ScrollArea className="flex-1">
            <div className="p-1.5 space-y-0.5">
              {sortedProjects.map((project) => (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  agents={agentsByProject[project.id] ?? []}
                  forceExpanded={expandedProjectId === project.id}
                  onSelectAgent={handleSelectAgent}
                  onFocusAgent={handleFocusAgent}
                />
              ))}

              {ungroupedAgents.length > 0 && (
                <div>
                  <button
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-white/5 rounded-sm transition-colors cursor-pointer"
                    onClick={() => setUngroupedExpanded(!ungroupedExpanded)}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 shrink-0 transition-transform duration-150",
                        ungroupedExpanded && "rotate-90"
                      )}
                    />
                    <UngroupedIcon className="size-3.5" />
                    <span className="truncate flex-1">Ungrouped</span>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                      {ungroupedAgents.length}
                    </span>
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-150 ease-out",
                      ungroupedExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    )}
                  >
                    <div className="overflow-hidden">
                      {ungroupedAgents.map((agent) => (
                        <AgentItem
                          key={agent.id}
                          agent={agent}
                          onSelect={handleSelectAgent}
                          onFocus={handleFocusAgent}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      ) : (
        <SidebarRail
          projects={sortedProjects}
          agentsByProject={agentsByProject}
          ungroupedAgents={ungroupedAgents}
          onExpand={handleRailExpand}
        />
      )}
    </div>
  );
}
