"use client";

import { AuthProvider } from "./auth-provider";
import { WebSocketProvider } from "./ws-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WebSocketProvider>{children}</WebSocketProvider>
    </AuthProvider>
  );
}
