import { cn } from "@/lib/utils";
import type { Agent, AgentStatus } from "@/types";

const STATUS_COLORS: Record<AgentStatus, string> = {
  running: "bg-[var(--status-active)]",
  waiting_input: "bg-[var(--status-waiting)]",
  completed: "bg-[var(--status-idle)]",
  created: "bg-[var(--status-idle)]",
  stopped: "bg-[var(--status-idle)]",
  failed: "bg-[var(--status-failed)]",
};

interface AgentItemProps {
  agent: Agent;
  onSelect: (agentId: string) => void;
  onFocus: (agentId: string) => void;
}

export function AgentItem({ agent, onSelect, onFocus }: AgentItemProps) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 pl-7 pr-2 py-1.5 text-left",
        "text-xs text-muted-foreground hover:text-foreground hover:bg-white/5",
        "rounded-sm transition-colors cursor-pointer group"
      )}
      onClick={() => onSelect(agent.id)}
      onDoubleClick={() => onFocus(agent.id)}
    >
      <span
        className={cn(
          "size-1.5 rounded-full shrink-0",
          STATUS_COLORS[agent.status] ?? "bg-[var(--status-idle)]"
        )}
      />
      <span className="truncate flex-1">{agent.name}</span>
      {agent.role && (
        <span className="text-[10px] text-muted-foreground/60 truncate max-w-[80px]">
          {agent.role}
        </span>
      )}
    </button>
  );
}
