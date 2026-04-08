"use client";

import { useEffect } from "react";
import { HiveSocket } from "@/lib/ws";
import { WebSocketContext } from "@/hooks/useWebSocket";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000/watch";

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const socket = HiveSocket.instance();

  useEffect(() => {
    socket.connect(WS_URL);
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return (
    <WebSocketContext value={socket}>
      {children}
    </WebSocketContext>
  );
}
