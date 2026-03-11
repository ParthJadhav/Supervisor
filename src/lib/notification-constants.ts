import { CheckCircle2, AlertCircle, Clock, Play, Users } from "lucide-react";
import type { NotificationEventType } from "@/types";

export const EVENT_ICONS: Record<NotificationEventType, typeof CheckCircle2> = {
  agent_completed: CheckCircle2,
  agent_failed: AlertCircle,
  agent_waiting_input: Clock,
  agent_started: Play,
  all_agents_idle: Users,
};

export const EVENT_COLORS: Record<NotificationEventType, string> = {
  agent_completed: "text-status-active",
  agent_failed: "text-destructive",
  agent_waiting_input: "text-status-waiting",
  agent_started: "text-blue-400",
  all_agents_idle: "text-violet-400",
};

export const EVENT_LABELS: Record<NotificationEventType, string> = {
  agent_completed: "Agent completed task",
  agent_failed: "Agent failed / errored",
  agent_waiting_input: "Agent needs input",
  agent_started: "Agent started task",
  all_agents_idle: "All agents idle",
};
