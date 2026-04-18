"use client";

import { useEffect } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

export type AgentScoreRefreshedPayload = {
  type: "agent_score_refreshed";
  agent_id: string;
  company_id: string;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
};

/**
 * Subscribe to agent_score_refreshed events. Invokes `apply` for every
 * event received; the consumer decides whether the event matches a
 * currently-displayed agent and patches its local state accordingly.
 */
export function useAgentScoreRefresh(
  apply: (ev: AgentScoreRefreshedPayload) => void,
): void {
  const { socket } = useWebSocket();

  useEffect(() => {
    const unsub = socket.on("agent_score_refreshed", (data) => {
      apply(data as unknown as AgentScoreRefreshedPayload);
    });
    return unsub;
  }, [socket, apply]);
}
