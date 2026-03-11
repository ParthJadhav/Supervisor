import { X, CheckCircle2 } from "lucide-react";
import { useNotificationStore } from "@/stores/notification-store";
import { EVENT_ICONS, EVENT_COLORS } from "@/lib/notification-constants";

export function NotificationToast() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = EVENT_ICONS[toast.event_type] || CheckCircle2;
        const colorClass = EVENT_COLORS[toast.event_type] || "text-muted-foreground";

        return (
          <div
            key={toast.id}
            className="bg-card border border-border/50 rounded-lg p-3 shadow-lg animate-in slide-in-from-right-5 fade-in duration-200 flex items-start gap-3"
          >
            <Icon className={`size-4 mt-0.5 shrink-0 ${colorClass}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{toast.title}</p>
              {toast.body && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {toast.body}
                </p>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
