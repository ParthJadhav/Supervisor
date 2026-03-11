import { memo } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface DeletePreviewProject {
  id: string;
  name: string;
  path: string;
  selectedChildAgentCount: number;
  remainingAgentCount: number;
}

export interface DeletePreviewAgent {
  id: string;
  name: string;
  projectName?: string | null;
}

interface AgentNodeDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName?: string;
  projects?: DeletePreviewProject[];
  agents?: DeletePreviewAgent[];
  onConfirm: () => void;
}

export const AgentNodeDeleteDialog = memo(function AgentNodeDeleteDialog({
  open,
  onOpenChange,
  agentName = "",
  projects = [],
  agents = [],
  onConfirm,
}: AgentNodeDeleteDialogProps) {
  const resolvedAgents = agents.length > 0
    ? agents
    : agentName
      ? [{ id: "single-agent", name: agentName }]
      : [];
  const totalCount = projects.length + resolvedAgents.length;
  const isBatch = totalCount > 1;
  const hasProjects = projects.length > 0;
  const hasAgents = resolvedAgents.length > 0;
  const title = isBatch
    ? `Delete ${totalCount} selected items?`
    : hasProjects
      ? `Delete project "${projects[0].name}"?`
      : `Delete agent "${resolvedAgents[0]?.name ?? agentName}"?`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            Review the affected items below before confirming. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          {hasProjects && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-foreground/80">
                Projects
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="font-medium text-foreground">{project.name}</div>
                    <div className="truncate text-xs text-muted-foreground/80">{project.path}</div>
                    <div className="mt-1 text-xs leading-5">
                      Removed from Supervisor.
                      {project.selectedChildAgentCount > 0
                        ? ` ${project.selectedChildAgentCount} selected child agent${project.selectedChildAgentCount === 1 ? "" : "s"} will also be deleted.`
                        : ""}
                      {project.remainingAgentCount > 0
                        ? ` ${project.remainingAgentCount} other agent${project.remainingAgentCount === 1 ? "" : "s"} will become unassigned.`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hasAgents && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-foreground/80">
                Agents To Delete
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {resolvedAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="font-medium text-foreground">{agent.name}</div>
                    <div className="text-xs leading-5">
                      Permanently deleted with conversation history.
                      {agent.projectName ? ` Currently in ${agent.projectName}.` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});
