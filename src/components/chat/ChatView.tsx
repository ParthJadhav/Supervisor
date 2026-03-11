import {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type UIEvent as ReactUIEvent,
  type CSSProperties,
} from "react";
import { MessageSquare, ChevronDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agent-store";
import { useProjectStore } from "@/stores/project-store";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { isNearBottom, estimateMessageSize, TAIL_SIZE } from "./ChatView.logic";
import type { ChatMessage as ChatMessageType } from "@/types";

const EMPTY: ChatMessageType[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatViewProps {
  agentId: string;
  readOnly?: boolean;
}

export function ChatView({ agentId, readOnly }: ChatViewProps) {
  const messages = useAgentStore((s) => s.chatMessages[agentId]) ?? EMPTY;
  const { agentStatus, projectId } = useAgentStore(
    useShallow((s) => {
      const agent = s.agents.find((a) => a.id === agentId);
      return {
        agentStatus: agent?.status,
        projectId: agent?.project_id ?? null,
      };
    }),
  );
  const resolvedColor = useProjectStore((s) => {
    if (!projectId) return undefined;
    const project = s.projects.find((p) => p.id === projectId);
    return project?.color ?? undefined;
  });

  // --- Refs ---
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitially = useRef(false);
  const initialCountRef = useRef<number | null>(null);

  // Scroll state machine refs
  const shouldAutoScrollRef = useRef(true);
  const lastKnownScrollTopRef = useRef(0);
  const isPointerScrollActiveRef = useRef(false);
  const pendingUserScrollUpIntentRef = useRef(false);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);

  // Interaction anchor preservation
  const anchorRef = useRef<{ element: HTMLElement; top: number } | null>(null);

  // rAF ID from handleClickCapture for cleanup
  const clickCaptureRafRef = useRef<number | null>(null);

  // Composer ResizeObserver ref (set from parent via data attribute lookup)
  const composerHeightRef = useRef(0);

  // UI state for scroll-to-bottom button visibility
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track initial message count for animate-enter
  if (initialCountRef.current === null && messages.length > 0) {
    initialCountRef.current = messages.length;
  }

  // Thinking indicator
  const lastMsg = messages[messages.length - 1];
  const isThinking =
    agentStatus === "running" && (!lastMsg || !lastMsg.isStreaming);

  // -------------------------------------------------------------------------
  // Scroll primitives
  // -------------------------------------------------------------------------

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scheduleStickToBottom = useCallback(() => {
    if (pendingAutoScrollFrameRef.current !== null) return;
    pendingAutoScrollFrameRef.current = requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (shouldAutoScrollRef.current) {
        scrollToBottom();
      }
    });
  }, [scrollToBottom]);

  // -------------------------------------------------------------------------
  // User intent detection handlers
  // -------------------------------------------------------------------------

  const handleWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      pendingUserScrollUpIntentRef.current = true;
    }
  }, []);

  const handlePointerDown = useCallback(
    (_e: ReactPointerEvent<HTMLDivElement>) => {
      isPointerScrollActiveRef.current = true;
    },
    [],
  );

  const handlePointerUp = useCallback(
    (_e: ReactPointerEvent<HTMLDivElement>) => {
      isPointerScrollActiveRef.current = false;
    },
    [],
  );

  const handleScroll = useCallback(
    (_e: ReactUIEvent<HTMLDivElement>) => {
      const el = scrollContainerRef.current;
      if (!el) return;

      const currentTop = el.scrollTop;
      const wasScrollingUp = currentTop < lastKnownScrollTopRef.current;
      lastKnownScrollTopRef.current = currentTop;

      const nearBottom = isNearBottom(el);

      if (shouldAutoScrollRef.current) {
        // User scrolled up intentionally — disable auto-scroll
        if (pendingUserScrollUpIntentRef.current && wasScrollingUp) {
          shouldAutoScrollRef.current = false;
          setShowScrollButton(true);
          pendingUserScrollUpIntentRef.current = false;
          return;
        }
        // User dragged up with pointer — disable auto-scroll
        if (isPointerScrollActiveRef.current && wasScrollingUp) {
          shouldAutoScrollRef.current = false;
          setShowScrollButton(true);
          return;
        }
      } else {
        // User scrolled back to bottom — re-enable auto-scroll
        if (nearBottom) {
          shouldAutoScrollRef.current = true;
          setShowScrollButton(false);
        }
      }

      pendingUserScrollUpIntentRef.current = false;
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Scroll-to-bottom button click
  // -------------------------------------------------------------------------

  const handleScrollToBottomClick = useCallback(() => {
    shouldAutoScrollRef.current = true;
    setShowScrollButton(false);
    scrollToBottom();
  }, [scrollToBottom]);

  // -------------------------------------------------------------------------
  // Interaction anchor preservation (click capture on chat content)
  // -------------------------------------------------------------------------

  const handleClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only anchor for interactive elements inside messages
      const target = e.target as HTMLElement;
      const interactive = target.closest(
        "button, summary, [data-collapsible], details, [role='button']",
      );
      if (!interactive || !scrollContainerRef.current) return;

      const rect = interactive.getBoundingClientRect();
      anchorRef.current = {
        element: interactive as HTMLElement,
        top: rect.top,
      };

      // After the DOM updates, restore the element's visual position
      clickCaptureRafRef.current = requestAnimationFrame(() => {
        clickCaptureRafRef.current = null;
        const anchor = anchorRef.current;
        if (!anchor || !scrollContainerRef.current) return;
        const newRect = anchor.element.getBoundingClientRect();
        const delta = newRect.top - anchor.top;
        if (Math.abs(delta) > 1) {
          scrollContainerRef.current.scrollTop += delta;
        }
        anchorRef.current = null;
      });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Virtual scrolling setup
  // -------------------------------------------------------------------------

  // Split messages: virtualized head + always-rendered tail
  const splitIndex = useMemo(
    () => Math.max(0, messages.length - TAIL_SIZE),
    [messages.length],
  );

  const virtualizedMessages = useMemo(
    () => messages.slice(0, splitIndex),
    [messages, splitIndex],
  );

  const tailMessages = useMemo(
    () => messages.slice(splitIndex),
    [messages, splitIndex],
  );

  const virtualizer = useVirtualizer({
    count: virtualizedMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => estimateMessageSize(virtualizedMessages[index].role),
    overscan: 5,
  });

  // -------------------------------------------------------------------------
  // Initial scroll (poll until container is ready)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (hasScrolledInitially.current || messages.length === 0) return;

    const el = scrollContainerRef.current;
    if (!el) return;

    // If content doesn't overflow yet, mark as initialized (we're already at bottom)
    if (el.scrollHeight <= el.clientHeight) {
      hasScrolledInitially.current = true;
      return;
    }

    // If already has height, scroll immediately
    if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight) {
      el.scrollTop = el.scrollHeight;
      hasScrolledInitially.current = true;
      lastKnownScrollTopRef.current = el.scrollTop;
      return;
    }

    // Otherwise observe until the container has height
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (hasScrolledInitially.current) {
        observer.disconnect();
        return;
      }
      if (el.scrollHeight <= el.clientHeight) {
        hasScrolledInitially.current = true;
        observer.disconnect();
        return;
      }
      if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
        hasScrolledInitially.current = true;
        lastKnownScrollTopRef.current = el.scrollTop;
        observer.disconnect();
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length > 0]);

  // -------------------------------------------------------------------------
  // Auto-scroll on content changes
  // -------------------------------------------------------------------------

  // Track message count to detect when user sends a new message
  const prevMessageCountRef = useRef(messages.length);

  useLayoutEffect(() => {
    if (!hasScrolledInitially.current) return;

    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    // If new messages were added, check if any of them are from the user.
    // When the user hits send we always force-scroll to bottom regardless
    // of the current auto-scroll state.
    if (messages.length > prevCount) {
      const newMessages = messages.slice(prevCount);
      const hasUserMessage = newMessages.some((m) => m.role === "user");
      if (hasUserMessage) {
        shouldAutoScrollRef.current = true;
        setShowScrollButton(false);
        // Use rAF to ensure the DOM has laid out the new message
        requestAnimationFrame(() => scrollToBottom());
        return;
      }
    }

    if (shouldAutoScrollRef.current) {
      scheduleStickToBottom();
    }
  }, [messages, isThinking, scheduleStickToBottom, scrollToBottom]);

  // -------------------------------------------------------------------------
  // Composer ResizeObserver — scroll when composer grows/shrinks
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    // Find the composer element in the same parent layout
    const composer = scrollEl.closest("[data-focus-view]")?.querySelector(
      "[data-chat-composer]",
    ) as HTMLElement | null;
    if (!composer || typeof ResizeObserver === "undefined") return;

    composerHeightRef.current = composer.getBoundingClientRect().height;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextHeight = entry.contentRect.height;
      const prevHeight = composerHeightRef.current;
      composerHeightRef.current = nextHeight;

      if (prevHeight > 0 && Math.abs(nextHeight - prevHeight) < 0.5) return;
      if (!shouldAutoScrollRef.current) return;
      scheduleStickToBottom();
    });

    observer.observe(composer);
    return () => observer.disconnect();
  }, [scheduleStickToBottom]);

  // -------------------------------------------------------------------------
  // Cleanup RAF on unmount
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (pendingAutoScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingAutoScrollFrameRef.current);
      }
      if (clickCaptureRafRef.current !== null) {
        cancelAnimationFrame(clickCaptureRafRef.current);
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Render: empty state
  // -------------------------------------------------------------------------

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <MessageSquare className="size-10 text-muted-foreground/25" strokeWidth={1.5} />
          {!readOnly && (
            <p className="text-xs text-muted-foreground/40">
              Send a message to start
            </p>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: chat with virtual scroll
  // -------------------------------------------------------------------------

  const virtualItems = virtualizer.getVirtualItems();
  const totalVirtualHeight = virtualizer.getTotalSize();

  return (
    <div className="relative h-full">
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onScroll={handleScroll}
        onClickCapture={handleClickCapture}
      >
        <div className="mx-auto w-full min-w-0 max-w-3xl flex flex-col gap-2 p-5">
          {/* --- Virtualized head --- */}
          {virtualizedMessages.length > 0 && (
            <div
              className="relative w-full"
              style={{ height: totalVirtualHeight }}
            >
              {virtualItems.map((virtualRow) => {
                const message = virtualizedMessages[virtualRow.index];
                const isNew =
                  initialCountRef.current !== null &&
                  virtualRow.index >= initialCountRef.current;
                return (
                  <div
                    key={message.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className={`absolute left-0 top-0 w-full${isNew ? " animate-enter" : ""}`}
                    style={
                      {
                        transform: `translateY(${virtualRow.start}px)`,
                        ...(isNew ? { "--stagger": 0 } : {}),
                      } as CSSProperties
                    }
                  >
                    <ChatMessage message={message} projectColor={resolvedColor} />
                  </div>
                );
              })}
            </div>
          )}

          {/* --- Always-rendered tail --- */}
          {tailMessages.map((message, i) => {
            const originalIndex = splitIndex + i;
            const isNew =
              initialCountRef.current !== null &&
              originalIndex >= initialCountRef.current;
            return (
              <div
                key={message.id}
                className={`chat-message-item${isNew ? " animate-enter" : ""}`}
                style={
                  isNew
                    ? ({ "--stagger": 0 } as CSSProperties)
                    : undefined
                }
              >
                <ChatMessage message={message} projectColor={resolvedColor} />
              </div>
            );
          })}

          {/* --- Thinking indicator --- */}
          {isThinking && (
            <div className="px-1" aria-live="polite">
              <span className="thinking-shine text-sm font-medium">
                Thinking
              </span>
            </div>
          )}
        </div>
      </div>

      {/* --- Scroll-to-bottom button --- */}
      <div
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-10 transition-all duration-200 ${
          showScrollButton
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-2 pointer-events-none"
        }`}
      >
        <button
          type="button"
          onClick={handleScrollToBottomClick}
          style={{
            display: "grid", placeItems: "center",
            width: 28, height: 28, borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.10)",
            cursor: "pointer",
            color: "var(--studio-text-secondary)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            transition: "background 150ms ease, opacity 150ms ease",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.14)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }}
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
