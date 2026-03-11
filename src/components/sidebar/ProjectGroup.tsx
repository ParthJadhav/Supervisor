import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent, Project } from "@/types";
import { AgentItem } from "./AgentItem";
import { getProjectIcon, getProjectColorClass } from "./icons";

interface ProjectGroupProps {
  project: Project;
  agents: Agent[];
  forceExpanded?: boolean;
  onSelectAgent: (agentId: string) => void;
  onFocusAgent: (agentId: string) => void;
}

export function ProjectGroup({
  project,
  agents,
  forceExpanded,
  onSelectAgent,
  onFocusAgent,
}: ProjectGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getProjectIcon(project.icon);

  // Allow parent to force-expand (e.g. from rail icon click)
  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  return (
    <div>
      <button
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 text-left",
          "text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-white/5",
          "rounded-sm transition-colors cursor-pointer"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform duration-150",
            expanded && "rotate-90"
          )}
        />
        <Icon className={cn("size-3.5 shrink-0", getProjectColorClass(project.color))} />
        <span className="truncate flex-1">{project.name}</span>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {agents.length}
        </span>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          {agents.map((agent) => (
            <AgentItem
              key={agent.id}
              agent={agent}
              onSelect={onSelectAgent}
              onFocus={onFocusAgent}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
