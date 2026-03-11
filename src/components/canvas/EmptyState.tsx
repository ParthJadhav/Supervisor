import { memo } from "react";
import { Bot, FolderPlus, MessageSquare } from "lucide-react";
import supervisorIcon from "@/assets/supervisor-icon.png";
import { Button } from "../ui/button";

interface EmptyStateProps {
  onCreateProject: () => void;
  onCreateAgent: () => void;
}

const steps = [
  {
    number: 1,
    icon: FolderPlus,
    title: "Create a project",
    description: "Register a project directory to organize your agents around a codebase.",
    actionLabel: "New Project",
    actionKey: "onCreateProject" as const,
    shortcut: "\u2318N",
  },
  {
    number: 2,
    icon: Bot,
    title: "Add your first agent",
    description: "Spin up a Claude agent with a specific role, model, and system prompt.",
    actionLabel: "New Agent",
    actionKey: "onCreateAgent" as const,
    shortcut: "\u2318\u21E7N",
  },
  {
    number: 3,
    icon: MessageSquare,
    title: "Start a conversation",
    description: "Your agent begins working in its project directory, streaming output in real time.",
    actionLabel: null,
    actionKey: null,
    shortcut: null,
  },
];

export const EmptyState = memo(function EmptyState({ onCreateProject, onCreateAgent }: EmptyStateProps) {
  const actions = { onCreateProject, onCreateAgent };

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="pointer-events-auto flex flex-col items-center max-w-md">
        {/* Icon composition */}
        <div className="mb-6 animate-in fade-in duration-500">
          <img
            src={supervisorIcon}
            alt="Supervisor"
            className="size-16 rounded-2xl"
            draggable={false}
          />
        </div>

        {/* Heading */}
        <h2
          className="text-xl font-semibold text-foreground mb-1 animate-in fade-in duration-500 delay-75"
        >
          Welcome to Supervisor
        </h2>
        <p
          className="text-sm text-muted-foreground mb-10 animate-in fade-in duration-500 delay-100"
        >
          Orchestrate AI agents across your projects
        </p>

        {/* Steps */}
        <div className="flex flex-col items-stretch w-full">
          {steps.map((step, i) => (
            <div
              key={step.number}
              className="animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
              style={{ animationDelay: `${150 + i * 100}ms` }}
            >
              <div className="flex gap-4">
                {/* Step indicator column */}
                <div className="flex flex-col items-center">
                  <div className="size-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                    <span className="text-xs font-medium text-foreground">{step.number}</span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className="w-px flex-1 bg-muted my-1" />
                  )}
                </div>

                {/* Step content */}
                <div className={`flex-1 ${i < steps.length - 1 ? "pb-6" : "pb-0"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <step.icon className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{step.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                    {step.description}
                  </p>
                  {step.actionKey && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={actions[step.actionKey]}
                    >
                      {step.actionLabel}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Keyboard shortcuts */}
        <div
          className="mt-8 flex items-center gap-4 text-xs text-muted-foreground animate-in fade-in duration-500"
          style={{ animationDelay: "550ms" }}
        >
          {steps.filter((s) => s.shortcut).map((step) => (
            <span key={step.number} className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-muted/80 border border-border text-muted-foreground font-mono text-xs">
                {step.shortcut}
              </kbd>
              <span>{step.title}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});
