import type { AgentStatus } from "@/types";

// ── Model tier ──
export type ModelTier = "opus" | "sonnet" | "haiku";

export function getModelTier(model: string): ModelTier {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("haiku")) return "haiku";
  return "sonnet";
}

export const modelTierConfig: Record<ModelTier, { label: string; bg: string; color: string }> = {
  opus: { label: "Opus", bg: "rgba(249,115,22,0.14)", color: "rgba(249,115,22,0.88)" },
  sonnet: { label: "Sonnet", bg: "rgba(139,92,246,0.14)", color: "rgba(139,92,246,0.88)" },
  haiku: { label: "Haiku", bg: "rgba(56,189,248,0.14)", color: "rgba(56,189,248,0.88)" },
};

// ── Status display ──
export type DisplayStatus = "running" | "waiting" | "failed" | "idle";

export function getStatusBarClass(status: AgentStatus): string {
  switch (status) {
    case "running": return "studio-status-bar-running";
    case "waiting_input": return "studio-status-bar-waiting";
    case "failed": return "studio-status-bar-failed";
    default: return "studio-status-bar-idle";
  }
}

export function getStatusDotColor(status: DisplayStatus): string {
  switch (status) {
    case "running": return "#4ade80";
    case "waiting": return "#fbbf24";
    case "failed": return "#ef4444";
    default: return "#555";
  }
}

export function getStatusDotGlow(status: DisplayStatus): string {
  if (status === "running") return "0 0 8px rgba(74,222,128,0.4)";
  if (status === "waiting") return `0 0 8px #fbbf2460`;
  if (status === "failed") return `0 0 8px #ef444460`;
  return "";
}

export function getDisplayStatus(status: AgentStatus): DisplayStatus {
  switch (status) {
    case "running": return "running";
    case "waiting_input": return "waiting";
    case "failed": return "failed";
    default: return "idle";
  }
}
