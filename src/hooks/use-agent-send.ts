import { useCallback, useState } from "react";
import { useAgentStore } from "@/stores/agent-store";
import type { ImageAttachment } from "@/types";

export function useAgentSend(agentId: string) {
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const addUserMessage = useAgentStore((s) => s.addUserMessage);
  const clearAgentSession = useAgentStore((s) => s.clearAgentSession);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(
    async (msg: string, images?: ImageAttachment[]) => {
      // Intercept /clear — stop current process, clear UI, respawn fresh session
      if (msg.trim() === "/clear") {
        setSending(true);
        try {
          await clearAgentSession(agentId);
          await fetchAgents();
        } catch (err) {
          console.error("Failed to clear session:", err);
        } finally {
          setSending(false);
        }
        return;
      }

      setSending(true);
      // Strip large base64 data from path-based images before storing in state.
      // ChatMessage uses convertFileSrc(path) for display instead.
      const lightImages = images?.map((img) =>
        img.path ? { ...img, data: "" } : img,
      );
      addUserMessage(agentId, msg, lightImages);
      try {
        await sendMessage(agentId, msg, images);
        await fetchAgents();
      } catch (err) {
        console.error("Failed to send message:", err);
      } finally {
        setSending(false);
      }
    },
    [agentId, addUserMessage, clearAgentSession, sendMessage, fetchAgents],
  );

  return { sending, handleSend };
}
