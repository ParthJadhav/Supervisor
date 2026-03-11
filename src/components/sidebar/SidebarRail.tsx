import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { Project, Agent } from "@/types";
import { getProjectIcon, UngroupedIcon, getProjectColorClass } from "./icons";

interface SidebarRailProps {
  projects: Project[];
  agentsByProject: Record<string, Agent[]>;
  ungroupedAgents: Agent[];
  onExpand: (projectId?: string) => void;
}

function hasActiveAgent(agents: Agent[]): boolean {
  return agents.some((a) => a.status === "running" || a.status === "failed");
}

export function SidebarRail({
  projects,
  agentsByProject,
  ungroupedAgents,
  onExpand,
}: SidebarRailProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 w-11">
      <button
        className="p-2 rounded-sm hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => onExpand()}
      >
        <ChevronRight className="size-4" />
      </button>

      <div className="w-5 h-px bg-border my-1" />

      {projects.map((project) => {
        const Icon = getProjectIcon(project.icon);
        const agents = agentsByProject[project.id] ?? [];
        const active = hasActiveAgent(agents);

        return (
          <Tooltip key={project.id}>
            <TooltipTrigger
              className="relative p-2 rounded-sm hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => onExpand(project.id)}
            >
              <Icon
                className={cn(
                  "size-4",
                  getProjectColorClass(project.color)
                )}
              />
              {active && (
                <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--status-active)]" />
              )}
            </TooltipTrigger>
            <TooltipContent side="right">
              {project.name} ({agents.length})
            </TooltipContent>
          </Tooltip>
        );
      })}

      {ungroupedAgents.length > 0 && (
        <>
          <div className="w-5 h-px bg-border my-1" />
          <Tooltip>
            <TooltipTrigger
              className="relative p-2 rounded-sm hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => onExpand("ungrouped")}
            >
              <UngroupedIcon className="size-4 text-muted-foreground" />
              {hasActiveAgent(ungroupedAgents) && (
                <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--status-active)]" />
              )}
            </TooltipTrigger>
            <TooltipContent side="right">
              Ungrouped ({ungroupedAgents.length})
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
