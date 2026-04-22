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
    // Sync initial state asynchronously to avoid cascading renders
    const connected = socket.connected;
    const reconnecting = socket.reconnecting;
    queueMicrotask(() => {
      setConnected(connected);
      setReconnecting(reconnecting);
    });
    return unsub;
  }, [socket]);

  return { socket, connected, reconnecting };
}

type BureauEventHandlers = {
  onMessage?: (data: Record<string, unknown>) => void;
  onAgentJoined?: (data: Record<string, unknown>) => void;
  onAgentLeft?: (data: Record<string, unknown>) => void;
  onArtifactCreated?: (data: Record<string, unknown>) => void;
  onArtifactUpdated?: (data: Record<string, unknown>) => void;
  onArtifactReviewed?: (data: Record<string, unknown>) => void;
  // Fired once per bureau subscription — hydrate roster + history
  // silently (no "X joined" feed entry for agents already present).
  onPresenceSnapshot?: (data: Record<string, unknown>) => void;
};

export function useBureauEvents(
  bureauId: string | null,
  handlers: BureauEventHandlers
) {
  const { socket } = useWebSocket();

  // Store handlers in refs to avoid stale closures
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

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
  const onArtifactCreated = useCallback(
    (data: Record<string, unknown>) => handlersRef.current.onArtifactCreated?.(data),
    []
  );
  const onArtifactUpdated = useCallback(
    (data: Record<string, unknown>) => handlersRef.current.onArtifactUpdated?.(data),
    []
  );
  const onArtifactReviewed = useCallback(
    (data: Record<string, unknown>) => handlersRef.current.onArtifactReviewed?.(data),
    []
  );
  const onPresenceSnapshot = useCallback(
    (data: Record<string, unknown>) => handlersRef.current.onPresenceSnapshot?.(data),
    []
  );

  useEffect(() => {
    if (!bureauId) return;

    // Listen for events BEFORE subscribing (avoids race condition:
    // watchBureau triggers an immediate presence_snapshot from server)
    const unsubs = [
      socket.on("message_posted", onMessage),
      socket.on("agent_joined", onAgentJoined),
      socket.on("agent_left", onAgentLeft),
      socket.on("artifact_created", onArtifactCreated),
      socket.on("artifact_updated", onArtifactUpdated),
      socket.on("artifact_reviewed", onArtifactReviewed),
      socket.on("presence_snapshot", onPresenceSnapshot),
    ];

    // Subscribe to bureau (server responds with one presence_snapshot)
    socket.watchBureau(bureauId);

    return () => {
      socket.unwatchBureau();
      for (const unsub of unsubs) unsub();
    };
  }, [bureauId, socket, onMessage, onAgentJoined, onAgentLeft, onArtifactCreated, onArtifactUpdated, onArtifactReviewed, onPresenceSnapshot]);
}
