import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bell,
  BellOff,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStore } from "@/stores/notification-store";
import { useLayerStore } from "@/stores/layer-store";
import { EVENT_ICONS, EVENT_COLORS } from "@/lib/notification-constants";
import { CheckCircle2 } from "lucide-react";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = Math.max(0, now - date);
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const dndEnabled = useNotificationStore((s) => s.dndEnabled);
  const toggleDnd = useNotificationStore((s) => s.toggleDnd);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const enterFocus = useLayerStore((s) => s.enterFocus);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  // Close dropdown on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="sm"
        className="relative size-8 p-0"
        onClick={() => setOpen(!open)}
      >
        {dndEnabled ? (
          <BellOff className="size-4 text-muted-foreground" />
        ) : (
          <Bell className="size-4" />
        )}
        {unreadCount > 0 && !dndEnabled && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-xs leading-none flex items-center justify-center"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border/50 rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  toggleDnd();
                }}
                title={dndEnabled ? "Turn off DND" : "Do Not Disturb"}
              >
                {dndEnabled ? (
                  <BellOff className="size-3.5 text-status-waiting" />
                ) : (
                  <BellOff className="size-3.5" />
                )}
              </Button>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={markAllRead}
                  title="Mark all read"
                >
                  <CheckCheck className="size-3.5" />
                </Button>
              )}
            </div>
          </div>

          <Separator />

          {/* Notification list */}
          <ScrollArea className="max-h-80">
            {notifications.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              <div className="py-1">
                {notifications.map((n) => {
                  const Icon = EVENT_ICONS[n.event_type] || CheckCircle2;
                  const colorClass =
                    EVENT_COLORS[n.event_type] || "text-muted-foreground";

                  const content = (
                    <>
                      <Icon
                        className={`size-4 mt-0.5 shrink-0 ${colorClass}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-xs ${!n.read ? "font-medium text-foreground" : "text-muted-foreground"}`}
                        >
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {n.body}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground/60 mt-1 tabular-nums">
                          {timeAgo(n.created_at)}
                        </p>
                      </div>
                      {!n.read && (
                        <div className="size-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      )}
                    </>
                  );

                  const sharedClassName = `w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-muted/50 transition-colors ${
                    !n.read ? "bg-muted/20" : ""
                  }`;

                  // Render as interactive button only when there's an agent to navigate to
                  if (n.agent_id) {
                    return (
                      <button
                        key={n.id}
                        className={sharedClassName}
                        onClick={() => {
                          enterFocus(n.agent_id!);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </button>
                    );
                  }

                  return (
                    <div
                      key={n.id}
                      className={sharedClassName}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

    </div>
  );
}
