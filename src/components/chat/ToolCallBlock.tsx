import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  ChevronRight,
  Wrench,
  Check,
  X,
  Loader2,
  Copy,
  ClipboardCheck,
  Eye,
  SquarePen,
  Pencil,
  Terminal,
  FolderSearch,
  Search,
  Globe,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/types";

interface ToolCallBlockProps {
  toolCall: ToolCall;
}

const OUTPUT_TRUNCATE_LENGTH = 2000;
const LINE_NUMBER_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Icon & preview helpers
// ---------------------------------------------------------------------------

function getToolIcon(toolName: string): React.ComponentType<{ className?: string }> {
  const name = toolName.toLowerCase();
  if (name === "read") return Eye;
  if (name === "write") return SquarePen;
  if (name === "edit") return Pencil;
  if (name === "bash") return Terminal;
  if (name.includes("glob")) return FolderSearch;
  if (name.includes("grep") || name === "search") return Search;
  if (name.includes("web")) return Globe;
  if (name.includes("agent") || name.includes("todo") || name.includes("dispatch")) return Bot;
  if (name.startsWith("mcp__")) return Wrench;
  return Wrench;
}

function getToolPreview(toolName: string, input: string): string | null {
  try {
    const parsed = JSON.parse(input);
    const name = toolName.toLowerCase();
    if ((name === "read" || name === "write" || name === "edit") && parsed.file_path) {
      return parsed.file_path;
    }
    if (name === "bash" && parsed.command) {
      const cmd = parsed.command;
      return cmd.length > 80 ? cmd.slice(0, 80) + "\u2026" : cmd;
    }
    if ((name === "grep" || name.includes("grep")) && parsed.pattern) return `/${parsed.pattern}/`;
    if ((name === "glob" || name.includes("glob")) && parsed.pattern) return parsed.pattern;
    return null;
  } catch {
    return null;
  }
}

function toneClass(status: ToolCall["status"], isError: boolean): string {
  if (isError || status === "error") return "text-rose-300/50";
  if (status === "running" || status === "started") return "text-muted-foreground/70";
  return "text-muted-foreground/50";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ToolCallBlock = memo<ToolCallBlockProps>(({ toolCall }) => {
  const isError = toolCall.isError || toolCall.status === "error";
  const isCompleted = toolCall.status === "completed";
  const hasContent = toolCall.input || toolCall.output;

  const [expanded, setExpanded] = useState(() => {
    if (isError) return true;
    if (isCompleted) return false;
    return false;
  });

  // Auto-expand when status transitions to error
  useEffect(() => {
    if (isError) setExpanded(true);
  }, [isError]);

  const [showFullOutput, setShowFullOutput] = useState(false);
  const copyBtnRef = useRef<HTMLButtonElement>(null);

  const ToolIcon = useMemo(() => getToolIcon(toolCall.name), [toolCall.name]);
  const preview = useMemo(
    () => (toolCall.input ? getToolPreview(toolCall.name, toolCall.input) : null),
    [toolCall.name, toolCall.input],
  );

  const formattedInput = useMemo(() => formatJson(toolCall.input), [toolCall.input]);

  const rawOutput = toolCall.output ?? "";
  const isOutputTruncatable = rawOutput.length > OUTPUT_TRUNCATE_LENGTH;

  const displayedOutput = useMemo(() => {
    if (!isOutputTruncatable || showFullOutput) return rawOutput;
    return rawOutput.slice(0, OUTPUT_TRUNCATE_LENGTH);
  }, [rawOutput, isOutputTruncatable, showFullOutput]);

  const outputLines = useMemo(() => displayedOutput.split("\n"), [displayedOutput]);
  const showLineNumbers = outputLines.length > LINE_NUMBER_THRESHOLD;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawOutput);
      const btn = copyBtnRef.current;
      if (btn) {
        btn.classList.add("copy-success");
        btn.addEventListener("animationend", () => btn.classList.remove("copy-success"), { once: true });
      }
    } catch {
      // silently ignore
    }
  }, [rawOutput]);

  const iconColorClass = toneClass(toolCall.status, isError);

  // Status indicator — compact dot or spinner
  const statusIndicator = (() => {
    switch (toolCall.status) {
      case "started":
      case "running":
        return <Loader2 className="size-3 animate-spin text-muted-foreground/60" />;
      case "completed":
        return <Check className="size-3 text-status-active/70" />;
      case "error":
        return <X className="size-3 text-destructive/70" />;
    }
  })();

  return (
    <div className="rounded-lg px-1 py-0.5">
      {/* --- Compact single-line header --- */}
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/30"
        onClick={() => hasContent && setExpanded(!expanded)}
        disabled={!hasContent}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150",
            expanded && "rotate-90",
            !hasContent && "opacity-0",
          )}
        />
        <span className={cn("flex size-5 shrink-0 items-center justify-center", iconColorClass)}>
          <ToolIcon className="size-3" />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-xs leading-5" title={preview ? `${toolCall.name} - ${preview}` : toolCall.name}>
            <span className={cn("text-foreground/80", iconColorClass)}>{toolCall.name}</span>
            {preview && <span className="text-muted-foreground/50"> - {preview}</span>}
          </p>
        </div>
        <span className="shrink-0">{statusIndicator}</span>
      </button>

      {/* --- Expanded content --- */}
      {expanded && hasContent && (
        <div className="ml-6 mt-1 space-y-2 pb-1">
          {/* Input */}
          {toolCall.input && (
            <div>
              <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground/45 mb-1">
                Input
              </div>
              <pre className="text-xs leading-relaxed whitespace-pre-wrap break-all font-mono bg-muted/15 rounded-md p-2 max-h-[160px] overflow-auto border border-border/30">
                <JsonHighlight json={formattedInput} />
              </pre>
            </div>
          )}

          {/* Output */}
          {toolCall.output && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground/45">
                  {isError ? "Error" : "Output"}
                </div>
                <button
                  ref={copyBtnRef}
                  type="button"
                  onClick={handleCopy}
                  className="copy-btn flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30"
                  aria-label="Copy output"
                >
                  <Copy className="copy-btn-icon size-2.5" />
                  <ClipboardCheck className="copy-btn-icon-done size-2.5" />
                  <span className="copy-btn-label">Copy</span>
                  <span className="copy-btn-label-done">Copied</span>
                </button>
              </div>

              <div
                className={cn(
                  "rounded-md overflow-auto font-mono border border-border/30",
                  isError ? "bg-destructive/5" : "bg-muted/15",
                  showLineNumbers ? "max-h-[300px]" : "max-h-[200px]",
                )}
              >
                <pre
                  className={cn(
                    "text-xs leading-relaxed whitespace-pre-wrap break-all p-2",
                    isError ? "text-destructive/80" : "text-foreground/60",
                  )}
                >
                  {showLineNumbers ? (
                    <code className="tool-output-lined">
                      {outputLines.map((line: string, i: number) => (
                        <span key={i} className="tool-output-line">
                          <span className="tool-output-line-number" data-line={i + 1} />
                          {line}
                          {i < outputLines.length - 1 ? "\n" : ""}
                        </span>
                      ))}
                    </code>
                  ) : (
                    displayedOutput
                  )}
                </pre>
              </div>

              {isOutputTruncatable && (
                <button
                  type="button"
                  onClick={() => setShowFullOutput((v) => !v)}
                  className="mt-1 text-xs text-primary/70 hover:text-primary hover:underline focus:outline-none"
                >
                  {showFullOutput
                    ? "Show less"
                    : `Show ${(rawOutput.length - OUTPUT_TRUNCATE_LENGTH).toLocaleString()} more chars`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

ToolCallBlock.displayName = "ToolCallBlock";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

const JsonHighlight = memo(function JsonHighlight({ json }: { json: string }) {
  const trimmed = json.trimStart();
  const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");

  if (!isJson) {
    return <span className="text-foreground/70">{json}</span>;
  }

  const tokens = tokenizeJson(json);

  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={tokenClass(token.type)}>
          {token.value}
        </span>
      ))}
    </>
  );
});
JsonHighlight.displayName = "JsonHighlight";

type TokenType = "key" | "string" | "number" | "boolean" | "null" | "punctuation" | "whitespace";

interface Token {
  type: TokenType;
  value: string;
}

function tokenizeJson(json: string): Token[] {
  const tokens: Token[] = [];
  const regex =
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])|([\s]+)/g;

  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "whitespace", value: json.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      tokens.push({ type: "key", value: match[1] });
      const afterQuote = match[1].length;
      const remainder = match[0].slice(afterQuote);
      if (remainder) {
        tokens.push({ type: "punctuation", value: remainder });
      }
    } else if (match[2] !== undefined) {
      tokens.push({ type: "string", value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "boolean", value: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: "null", value: match[4] });
    } else if (match[5] !== undefined) {
      tokens.push({ type: "number", value: match[5] });
    } else if (match[6] !== undefined) {
      tokens.push({ type: "punctuation", value: match[6] });
    } else if (match[7] !== undefined) {
      tokens.push({ type: "whitespace", value: match[7] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < json.length) {
    tokens.push({ type: "whitespace", value: json.slice(lastIndex) });
  }

  return tokens;
}

function tokenClass(type: TokenType): string {
  switch (type) {
    case "key":
      return "text-primary";
    case "string":
      return "text-emerald-400";
    case "number":
      return "text-amber-400";
    case "boolean":
      return "text-purple-400";
    case "null":
      return "text-muted-foreground italic";
    case "punctuation":
      return "text-muted-foreground";
    case "whitespace":
      return "";
  }
}
