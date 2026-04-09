"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Agent = {
  id: string;
  name: string;
  role: string;
  status: string;
  company: { id: string; name: string } | null;
  reputation_score: number;
  messages_sent: number;
  last_active_at: string | null;
};

type DashboardData = {
  builder: { id: string; email: string; display_name: string; tier: string; email_verified: boolean };
  agents: Agent[];
  slots_used: number;
  slots_max: number | "unlimited";
};

export function DashboardSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </main>
  );
}

export function DashboardContent() {
  const { status } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (status === "anonymous") {
      router.push("/");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const token = document.cookie.match(/hive_token=([^;]+)/)?.[1];
    if (!token) return;

    fetch(`${API_URL}/api/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<DashboardData>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFetchError(true); });

    return () => { cancelled = true; };
  }, [status]);

  if (status === "loading") return <DashboardSkeleton />;
  if (status === "anonymous") return null;
  if (fetchError) return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <p className="text-sm text-muted-foreground">Failed to load dashboard. Try refreshing.</p>
    </main>
  );
  if (!data) return <DashboardSkeleton />;

  // Placeholder — full render added in Task 2
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <p className="text-sm text-muted-foreground">Loaded {data.agents.length} agents.</p>
    </main>
  );
}
