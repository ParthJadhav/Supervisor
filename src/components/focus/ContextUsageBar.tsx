import { memo, useMemo } from "react";
import { useAgentStore } from "@/stores/agent-store";

interface ContextUsageBarProps {
  agentId: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function getBarColor(pct: number): string {
  if (pct >= 80) return "#ef4444"; // red
  if (pct >= 60) return "#f59e0b"; // amber
  return "#4ade80"; // green
}

export const ContextUsageBar = memo(function ContextUsageBar({ agentId }: ContextUsageBarProps) {
  const usage = useAgentStore((s) => s.contextUsage[agentId]);

  const stats = useMemo(() => {
    if (!usage) return null;
    const totalInput = usage.inputTokens + usage.cacheCreation + usage.cacheRead;
    const pct = Math.min(100, (totalInput / usage.contextWindowSize) * 100);
    return { totalInput, pct, usage };
  }, [usage]);

  if (!stats || stats.totalInput === 0) return null;

  const { totalInput, pct } = stats;
  const { contextWindowSize, costUsd } = stats.usage;
  const barColor = getBarColor(pct);

  return (
    <div className="context-usage-bar" title={`${formatTokens(totalInput)} / ${formatTokens(contextWindowSize)} tokens${costUsd > 0 ? ` · $${costUsd.toFixed(4)}` : ""}`}>
      <div className="context-usage-track">
        <div
          className="context-usage-fill"
          style={{
            width: `${Math.max(2, pct)}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
      <span className="context-usage-label" style={{ color: barColor }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
});
