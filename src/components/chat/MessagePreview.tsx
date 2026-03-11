import { memo, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agent-store";
import type { ChatMessage } from "@/types";

const EMPTY: ChatMessage[] = [];

interface MessagePreviewProps {
  agentId: string;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, "")        // images
    .replace(/<[^>]+>/g, "")                 // HTML tags
    .replace(/^>\s?/gm, "")                  // blockquotes
    .replace(/~~(.*?)~~/g, "$1")             // strikethrough
    .replace(/^#{1,6}\s+/gm, "")            // headings
    .replace(/\*\*(.*?)\*\*/g, "$1")         // bold
    .replace(/\*(.*?)\*/g, "$1")             // italic
    .replace(/`([^`]+)`/g, "$1")             // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/\n/g, " ")
    .trim();
}

function shortTool(name: string): string {
  if (name.length <= 12) return name;
  return name.slice(0, 11) + "\u2026";
}

export const MessagePreview = memo(function MessagePreview({ agentId }: MessagePreviewProps) {
  const { agent, messages } = useAgentStore(
    useShallow((s) => ({
      agent: s.agents.find((a) => a.id === agentId),
      messages: s.chatMessages[agentId] ?? EMPTY,
    })),
  );
  const startedAt = useAgentStore((s) => s.agentStartedAt[agentId]);
  const currentTool = useAgentStore((s) => s.currentTools[agentId]);

  const isRunning = agent?.status === "running";

  // Live elapsed timer
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    if (!isRunning || !startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - startedAt);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  // Get recent activity from chat messages
  const recentLines = useMemo(() => getRecentActivity(messages), [messages]);

  // Idle with no messages
  if (!isRunning && recentLines.length === 0) {
    let lastAssistant: ChatMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") { lastAssistant = messages[i]; break; }
    }
    if (!lastAssistant) return null;

    const preview =
      lastAssistant.content.length > 80
        ? lastAssistant.content.slice(0, 80) + "..."
        : lastAssistant.content;

    return (
      <div className="text-lg text-muted-foreground/80 bg-muted/20 rounded-md px-4 py-2.5 line-clamp-2 leading-relaxed border border-border">
        {stripMarkdown(preview)}
      </div>
    );
  }

  return (
    <div className="text-lg bg-muted/20 rounded-md px-4 py-2.5 border border-border space-y-2">
      {/* Running header: tool indicator + elapsed */}
      {isRunning && (
        <div className="flex items-center justify-between gap-1">
          {currentTool ? (
            <div className="flex items-center gap-1 text-primary/90 min-w-0">
              <span className="relative flex size-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full size-1.5 bg-primary" />
              </span>
              <span className="truncate font-medium">
                {shortTool(currentTool)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-green-400/80 min-w-0">
              <span className="relative flex size-1.5 shrink-0">
                <span className="animate-pulse relative inline-flex rounded-full size-1.5 bg-green-400" />
              </span>
              <span className="truncate">Thinking</span>
            </div>
          )}
          {startedAt ? (
            <span className="text-muted-foreground/60 tabular-nums shrink-0">
              {formatElapsed(elapsed)}
            </span>
          ) : null}
        </div>
      )}

      {/* Recent activity log */}
      {recentLines.length > 0 && (
        <div className="space-y-0.5">
          {recentLines.map((line, i) => (
            <div
              key={i}
              className="text-muted-foreground/70 truncate leading-tight"
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
MessagePreview.displayName = "MessagePreview";

function getRecentActivity(messages: ChatMessage[]): string[] {
  if (messages.length === 0) return [];

  const lines: string[] = [];
  for (let i = messages.length - 1; i >= 0 && lines.length < 3; i--) {
    const msg = messages[i];
    if (msg.role === "tool" && msg.toolCall) {
      const status = msg.toolCall.status === "error" ? " (err)" : "";
      lines.unshift(`${msg.toolCall.name}${status}`);
    } else if (msg.role === "assistant" && msg.content.trim()) {
      const text = msg.content.trim();
      const display = text.length > 60 ? text.slice(0, 57) + "..." : text;
      lines.unshift(stripMarkdown(display));
    }
  }
  return lines;
}
