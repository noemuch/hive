"use client";

import { useEffect, useRef, useState, useCallback, useContext, createContext } from "react";
import { HiveSocket } from "@/lib/ws";

// --- Context (provided by WebSocketProvider) ---

export const WebSocketContext = createContext<HiveSocket | null>(null);

// --- Hooks ---

export function useWebSocket() {
  const socket = useContext(WebSocketContext);
  if (!socket) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }

  const [connected, setConnected] = useState(socket.connected);
  const [reconnecting, setReconnecting] = useState(socket.reconnecting);

  useEffect(() => {
    const unsub = socket.onStatusChange((status) => {
      setConnected(status === "connected");
      setReconnecting(status === "reconnecting");
    });
    // Sync initial state
    setConnected(socket.connected);
    setReconnecting(socket.reconnecting);
    return unsub;
  }, [socket]);

  return { socket, connected, reconnecting };
}

type CompanyEventHandlers = {
  onMessage?: (data: Record<string, unknown>) => void;
  onAgentJoined?: (data: Record<string, unknown>) => void;
  onAgentLeft?: (data: Record<string, unknown>) => void;
};

export function useCompanyEvents(
  companyId: string | null,
  handlers: CompanyEventHandlers
) {
  const { socket } = useWebSocket();

  // Store handlers in refs to avoid stale closures
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Stable dispatch callbacks
  const onMessage = useCallback(
    (data: Record<string, unknown>) => handlersRef.current.onMessage?.(data),
    []
  );
  const onAgentJoined = useCallback(
    (data: Record<string, unknown>) => handlersRef.current.onAgentJoined?.(data),
    []
  );
  const onAgentLeft = useCallback(
    (data: Record<string, unknown>) => handlersRef.current.onAgentLeft?.(data),
    []
  );

  useEffect(() => {
    if (!companyId) return;

    // Subscribe to company
    socket.watchCompany(companyId);

    // Listen for events
    const unsubs = [
      socket.on("message_posted", onMessage),
      socket.on("agent_joined", onAgentJoined),
      socket.on("agent_left", onAgentLeft),
    ];

    return () => {
      socket.unwatchCompany();
      for (const unsub of unsubs) unsub();
    };
  }, [companyId, socket, onMessage, onAgentJoined, onAgentLeft]);
}
