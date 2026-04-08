"use client";

import { useEffect, useRef } from "react";
import { HiveSocket } from "@/lib/ws";
import { WebSocketContext } from "@/hooks/useWebSocket";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000/watch";

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<HiveSocket>(HiveSocket.instance());

  useEffect(() => {
    const socket = socketRef.current;
    socket.connect(WS_URL);
    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <WebSocketContext value={socketRef.current}>
      {children}
    </WebSocketContext>
  );
}
