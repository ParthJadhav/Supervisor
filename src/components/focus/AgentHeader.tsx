import { memo, useMemo } from "react";
import { useAgentStore } from "@/stores/agent-store";
import {
  getModelTier,
  modelTierConfig,
  getDisplayStatus,
  getStatusDotColor,
} from "@/lib/agent-display";
import { ContextUsageBar } from "./ContextUsageBar";

interface AgentHeaderProps {
  agentId: string;
}

export const AgentHeader = memo(function AgentHeader({ agentId }: AgentHeaderProps) {
  const agent = useAgentStore((s) => s.agents.find((a) => a.id === agentId));

  const displayStatus = useMemo(
    () => (agent ? getDisplayStatus(agent.status) : "idle"),
    [agent?.status],
  );

  if (!agent) return null;

  const mt = modelTierConfig[getModelTier(agent.model)];
  const dotColor = getStatusDotColor(displayStatus);
  const dotGlow = displayStatus === "running" || displayStatus === "waiting" || displayStatus === "failed";

  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      {/* Status dot */}
      <div
        className={`shrink-0 ${displayStatus === "running" ? "studio-dot-pulse" : ""}`}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: dotColor,
          ...(dotGlow ? { boxShadow: `0 0 8px ${dotColor}60` } : {}),
        }}
      />

      {/* Agent name */}
      <span className="text-sm font-semibold tracking-tight text-foreground" style={{ letterSpacing: "-0.01em" }}>
        {agent.name}
      </span>

      {/* Model badge */}
      <span
        className="agent-model-badge"
        style={{ background: mt.bg, color: mt.color }}
      >
        {mt.label}
      </span>

      {/* Role */}
      {agent.role && (
        <span className="text-xs text-muted-foreground truncate max-w-[120px]">
          {agent.role}
        </span>
      )}

      {/* Context usage */}
      <ContextUsageBar agentId={agentId} />

      {/* Spacer */}
      <div className="flex-1" />

    </div>
  );
});
