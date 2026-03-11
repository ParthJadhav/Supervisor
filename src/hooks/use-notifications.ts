import { useEffect, useRef } from "react";
import { useAgentStore } from "../stores/agent-store";
import { useNotificationStore } from "../stores/notification-store";
import type { Agent } from "../types";

export function useNotifications() {
  const prevAgentsRef = useRef<Map<string, string>>(new Map());
  const hasInitialized = useRef(false);
  const agents = useAgentStore((s) => s.agents);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const fetchPrefs = useNotificationStore((s) => s.fetchPrefs);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);

  // Load initial data
  useEffect(() => {
    fetchNotifications();
    fetchPrefs();
    fetchUnreadCount();
  }, [fetchNotifications, fetchPrefs, fetchUnreadCount]);

  // Watch for agent status changes
  useEffect(() => {
    const prevMap = prevAgentsRef.current;
    const newMap = new Map<string, string>();

    for (const agent of agents) {
      newMap.set(agent.id, agent.status);
    }

    if (!hasInitialized.current) {
      hasInitialized.current = true;
      prevAgentsRef.current = newMap;
      return;
    }

    for (const agent of agents) {
      const prevStatus = prevMap.get(agent.id);

      // Skip if no previous status (initial load) or status unchanged
      if (!prevStatus || prevStatus === agent.status) continue;

      handleStatusChange(agent, prevStatus, addNotification);
    }

    // Check if all agents are idle
    const allIdle =
      agents.length > 0 &&
      agents.every(
        (a) =>
          a.status === "completed" ||
          a.status === "stopped" ||
          a.status === "created" ||
          a.status === "waiting_input",
      );
    const wasAnyRunning = Array.from(prevMap.values()).some((s) => s === "running");

    if (allIdle && wasAnyRunning && agents.length > 1) {
      // Single agent already gets individual notification; suppress "all agents idle" for 1 agent
      addNotification(
        "all_agents_idle",
        "All agents idle",
        "All agents have finished their current work.",
      );
    }

    prevAgentsRef.current = newMap;
  }, [agents, addNotification]);
}

function handleStatusChange(
  agent: Agent,
  prevStatus: string,
  addNotification: (
    eventType: "agent_completed" | "agent_failed" | "agent_waiting_input" | "agent_started" | "all_agents_idle",
    title: string,
    body?: string,
    agentId?: string,
    agentName?: string,
  ) => Promise<void>,
) {
  switch (agent.status) {
    case "completed":
      addNotification(
        "agent_completed",
        `${agent.name} completed`,
        `Agent "${agent.name}" has finished its task.`,
        agent.id,
        agent.name,
      );
      break;
    case "failed":
      addNotification(
        "agent_failed",
        `${agent.name} failed`,
        `Agent "${agent.name}" encountered an error.`,
        agent.id,
        agent.name,
      );
      break;
    case "waiting_input":
      if (prevStatus === "running") {
        addNotification(
          "agent_waiting_input",
          `${agent.name} needs input`,
          `Agent "${agent.name}" is waiting for your input.`,
          agent.id,
          agent.name,
        );
      }
      break;
    case "running":
      // Don't show started notifications — too noisy
      break;
  }
}
