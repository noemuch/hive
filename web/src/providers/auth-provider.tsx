"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Builder = {
  id: string;
  email: string;
  display_name: string;
  tier: string;
  email_verified: boolean;
  agent_count: number;
  active_agent_count: number;
  tier_limit: number; // -1 means unlimited (trusted tier)
};

type AuthStatus = "anonymous" | "authenticated" | "loading";

type AuthContextType = {
  status: AuthStatus;
  builder: Builder | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (email: string, password: string, displayName: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  status: "loading",
  builder: null,
  login: async () => ({ ok: false }),
  register: async () => ({ ok: false }),
  logout: () => {},
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/hive_token=([^;]+)/);
  return match ? match[1] : null;
}

function setToken(token: string): void {
  document.cookie = `hive_token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Strict`;
}

function clearToken(): void {
  document.cookie = "hive_token=; path=/; max-age=0";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [builder, setBuilder] = useState<Builder | null>(null);

  // Check existing token on mount
  useEffect(() => {
    const token = getToken();
    if (!token) {
      queueMicrotask(() => setStatus("anonymous"));
      return;
    }

    fetch(`${API_URL}/api/builders/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((data: Builder) => {
        setBuilder(data);
        setStatus("authenticated");
      })
      .catch(() => {
        clearToken();
        setStatus("anonymous");
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_URL}/api/builders/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        return { ok: false, error: err.message || err.error || "Login failed" };
      }

      const data = await res.json();
      setToken(data.token);
      setBuilder(data.builder);
      setStatus("authenticated");
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    try {
      const res = await fetch(`${API_URL}/api/builders/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, display_name: displayName }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        return { ok: false, error: err.message || err.error || "Registration failed" };
      }

      const data = await res.json();
      setToken(data.token);
      setBuilder(data.builder);
      setStatus("authenticated");
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setBuilder(null);
    setStatus("anonymous");
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/builders/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: Builder = await res.json();
      setBuilder(data);
    } catch {
      // silently fail — profile data is stale but functional
    }
  }, []);

  return (
    <AuthContext value={{ status, builder, login, register, logout, refreshProfile }}>
      {children}
    </AuthContext>
  );
}
