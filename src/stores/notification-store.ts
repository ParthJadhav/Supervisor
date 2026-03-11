import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AppNotification, NotificationEventType, NotificationPref } from "../types";

// Default notification rules: which events get desktop/sound by default
const DEFAULT_RULES: Record<NotificationEventType, { desktop: boolean; sound: boolean }> = {
  agent_completed: { desktop: true, sound: false },
  agent_failed: { desktop: true, sound: true },
  agent_waiting_input: { desktop: true, sound: true },
  agent_started: { desktop: false, sound: false },
  all_agents_idle: { desktop: true, sound: true },
};

// Shared AudioContext singleton to avoid creating one per notification sound
let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContext();
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

// Simple notification sound using Web Audio API
function playNotificationSound(type: "info" | "error" | "alert") {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "error") {
      osc.frequency.value = 300;
      gain.gain.value = 0.15;
    } else if (type === "alert") {
      osc.frequency.value = 600;
      gain.gain.value = 0.1;
    } else {
      osc.frequency.value = 800;
      gain.gain.value = 0.08;
    }

    osc.type = "sine";
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available, silently ignore
  }
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  dndEnabled: boolean;
  preferences: NotificationPref[];
  toasts: AppNotification[];
  settingsOpen: boolean;

  fetchNotifications: () => Promise<void>;
  fetchPrefs: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  addNotification: (
    eventType: NotificationEventType,
    title: string,
    body?: string,
    agentId?: string,
    agentName?: string,
  ) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismissToast: (id: number) => void;
  toggleDnd: () => Promise<void>;
  updatePref: (eventType: NotificationEventType, channel: string, enabled: boolean) => Promise<void>;
  isEnabled: (eventType: NotificationEventType, channel: string) => boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => {
  // Throttle: only allow 1 toast/desktop/sound dispatch per 2 seconds
  let lastDispatchTime = 0;

  // Track toast auto-dismiss timeouts so they can be cleared on manual dismiss
  const toastTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

  return {
    notifications: [],
    unreadCount: 0,
    dndEnabled: false,
    preferences: [],
    toasts: [],
    settingsOpen: false,

    fetchNotifications: async () => {
      try {
        const notifications = await invoke<AppNotification[]>("get_notification_log", {
          limit: 50,
        });
        set({ notifications });
      } catch (err) {
        console.error("Failed to fetch notifications:", err);
      }
    },

    fetchPrefs: async () => {
      try {
        const prefs = await invoke<NotificationPref[]>("get_notification_prefs");
        // Hydrate DND state from persisted prefs
        const dndPref = prefs.find(
          (p) => p.event_type === "global" && p.channel === "dnd",
        );
        set({
          preferences: prefs,
          dndEnabled: dndPref?.enabled ?? false,
        });
      } catch (err) {
        console.error("Failed to fetch notification prefs:", err);
      }
    },

    fetchUnreadCount: async () => {
      try {
        const count = await invoke<number>("get_unread_notification_count");
        set({ unreadCount: count });
      } catch (err) {
        console.error("Failed to fetch unread count:", err);
      }
    },

    addNotification: async (eventType, title, body, agentId, agentName) => {
      const { dndEnabled, isEnabled } = get();

      // Always persist to DB
      try {
        const id = await invoke<number>("log_notification", {
          eventType,
          title,
          body: body ?? null,
          agentId: agentId ?? null,
          agentName: agentName ?? null,
        });

        const notification: AppNotification = {
          id,
          event_type: eventType,
          title,
          body,
          agent_id: agentId,
          agent_name: agentName,
          read: false,
          created_at: new Date().toISOString(),
        };

        // Always update the notification list and unread count
        set((s) => ({
          notifications: [notification, ...s.notifications].slice(0, 50),
          unreadCount: s.unreadCount + 1,
        }));

        // Throttle: skip toast/desktop/sound if within 2s of last dispatch
        const now = Date.now();
        if (dndEnabled || now - lastDispatchTime < 2000) {
          // Still persisted to DB and in-app list, just no toast/desktop/sound
        } else {
          lastDispatchTime = now;

          // In-app toast
          set((s) => ({
            toasts: [...s.toasts, notification],
          }));
          const timeoutId = setTimeout(() => {
            get().dismissToast(id);
          }, 5000);
          toastTimeouts.set(id, timeoutId);

          // Desktop notification — only if window is NOT focused
          if (!document.hasFocus() && isEnabled(eventType, "desktop")) {
            try {
              let granted = await isPermissionGranted();
              if (!granted) {
                const permission = await requestPermission();
                granted = permission === "granted";
              }
              if (granted) {
                sendNotification({ title, body: body ?? undefined });
              }
            } catch {
              // Notification API not available
            }
          }

          // Sound
          if (isEnabled(eventType, "sound")) {
            const soundType =
              eventType === "agent_failed"
                ? "error"
                : eventType === "agent_waiting_input"
                  ? "alert"
                  : "info";
            playNotificationSound(soundType);
          }
        }
      } catch (err) {
        console.error("Failed to log notification:", err);
      }
    },

    markAllRead: async () => {
      try {
        await invoke("mark_notifications_read");
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        }));
      } catch (err) {
        console.error("Failed to mark notifications read:", err);
      }
    },

    dismissToast: (id) => {
      const existingTimeout = toastTimeouts.get(id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        toastTimeouts.delete(id);
      }
      set((s) => ({
        toasts: s.toasts.filter((t) => t.id !== id),
      }));
    },

    toggleDnd: async () => {
      const newDnd = !get().dndEnabled;
      set({ dndEnabled: newDnd });
      try {
        await invoke("set_notification_pref", {
          eventType: "global",
          channel: "dnd",
          enabled: newDnd,
        });
      } catch (err) {
        console.error("Failed to persist DND state:", err);
      }
    },

    updatePref: async (eventType, channel, enabled) => {
      try {
        await invoke("set_notification_pref", { eventType, channel, enabled });
        set((s) => {
          const existing = s.preferences.findIndex(
            (p) => p.event_type === eventType && p.channel === channel,
          );
          const prefs = [...s.preferences];
          if (existing !== -1) {
            prefs[existing] = { ...prefs[existing], enabled };
          } else {
            prefs.push({ event_type: eventType, channel, enabled });
          }
          return { preferences: prefs };
        });
      } catch (err) {
        console.error("Failed to update notification pref:", err);
      }
    },

    isEnabled: (eventType, channel) => {
      const { preferences } = get();
      const pref = preferences.find(
        (p) => p.event_type === eventType && p.channel === channel,
      );
      // If no explicit pref, use default rules
      if (!pref) {
        const defaults = DEFAULT_RULES[eventType];
        return defaults ? defaults[channel as keyof typeof defaults] ?? false : false;
      }
      return pref.enabled;
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
  };
});
