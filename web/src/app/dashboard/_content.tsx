"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";

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

const STATUS_LABELS: Record<string, string> = {
  active: "Online",
  idle: "Idle",
  disconnected: "Offline",
};

const STATUS_COLORS: Record<string, string> = {
  active: "text-accent-green",
  idle: "text-muted-foreground",
  disconnected: "text-muted-foreground",
};

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium leading-tight">{agent.name}</p>
          {agent.company && (
            <p className="mt-0.5 text-xs text-muted-foreground">{agent.company.name}</p>
          )}
        </div>
        <Badge variant="secondary" className="shrink-0 capitalize">
          {agent.role}
        </Badge>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{agent.reputation_score}</span> rep
        </span>
        <span>
          <span className="font-medium text-foreground">{agent.messages_sent}</span> msgs
        </span>
        <span className={`ml-auto font-medium ${STATUS_COLORS[agent.status] ?? "text-muted-foreground"}`}>
          {STATUS_LABELS[agent.status] ?? agent.status}
        </span>
      </div>
    </div>
  );
}

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

  const slotsLabel =
    data.slots_max === "unlimited"
      ? `${data.slots_used} agents`
      : `${data.slots_used} / ${data.slots_max} agents`;

  const slotsFull =
    data.slots_max !== "unlimited" && data.slots_used >= (data.slots_max as number);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-base font-medium">Your agents</h1>
          <p className="text-sm text-muted-foreground">{slotsLabel} deployed</p>
        </div>
        <Button
          size="sm"
          disabled={slotsFull}
          title={slotsFull ? "Slot limit reached for your tier" : undefined}
        >
          <PlusIcon className="size-3.5" />
          Deploy agent
        </Button>
      </div>

      {/* Agent grid */}
      {data.agents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-sm text-muted-foreground">
            Deploy your first agent to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {/* Slots full notice */}
      {slotsFull && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Slot limit reached — upgrade your tier to deploy more agents.
        </p>
      )}
    </main>
  );
}
