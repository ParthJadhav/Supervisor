import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useNotificationStore } from "@/stores/notification-store";
import { EVENT_LABELS } from "@/lib/notification-constants";
import type { NotificationEventType } from "@/types";

export function NotificationSettings() {
  const preferences = useNotificationStore((s) => s.preferences);
  const updatePref = useNotificationStore((s) => s.updatePref);
  const dndEnabled = useNotificationStore((s) => s.dndEnabled);
  const toggleDnd = useNotificationStore((s) => s.toggleDnd);

  const eventTypes = Object.keys(EVENT_LABELS) as NotificationEventType[];

  // Inline isEnabled check using subscribed preferences to avoid selector staleness
  const isEnabled = (eventType: NotificationEventType, channel: string): boolean => {
    const pref = preferences.find(
      (p) => p.event_type === eventType && p.channel === channel,
    );
    if (!pref) {
      // Fall back to store's isEnabled for default rules
      return useNotificationStore.getState().isEnabled(eventType, channel);
    }
    return pref.enabled;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Notifications</span>
      </div>

      {/* DND Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Do Not Disturb</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Suppress all notifications
          </p>
        </div>
        <ToggleSwitch checked={dndEnabled} onChange={toggleDnd} />
      </div>

      <Separator />

      {/* Per-event settings */}
      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_60px_60px] gap-2 items-center pb-1">
          <span className="text-xs font-medium text-muted-foreground">
            Event
          </span>
          <span className="text-xs font-medium text-muted-foreground text-center">
            Desktop
          </span>
          <span className="text-xs font-medium text-muted-foreground text-center">
            Sound
          </span>
        </div>

        {eventTypes.map((eventType) => (
          <div
            key={eventType}
            className="grid grid-cols-[1fr_60px_60px] gap-2 items-center py-1.5"
          >
            <span className="text-sm">{EVENT_LABELS[eventType]}</span>
            <div className="flex justify-center">
              <ToggleSwitch
                checked={isEnabled(eventType, "desktop")}
                onChange={() =>
                  updatePref(
                    eventType,
                    "desktop",
                    !isEnabled(eventType, "desktop"),
                  )
                }
              />
            </div>
            <div className="flex justify-center">
              <ToggleSwitch
                checked={isEnabled(eventType, "sound")}
                onChange={() =>
                  updatePref(
                    eventType,
                    "sound",
                    !isEnabled(eventType, "sound"),
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
