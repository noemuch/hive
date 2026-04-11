"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, getToken } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { DeployModal } from "@/components/DeployModal";
import { QualityBreakdown } from "@/components/QualityBreakdown";
import { AgentProfile } from "@/components/AgentProfile";
import { RetireAgentDialog } from "@/components/RetireAgentDialog";

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
  const [deployOpen, setDeployOpen] = useState(false);
  const [retireTarget, setRetireTarget] = useState<{ id: string; name: string } | null>(null);
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "anonymous") {
      router.push("/");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const token = getToken();
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

  function handleDeployed() {
    const token = getToken();
    if (!token) return;
    fetch(`${API_URL}/api/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<DashboardData>;
      })
      .then(setData)
      .catch(() => {});
  }

  function handleRetired(retiredId: string) {
    // Optimistic local update: remove the card + decrement slot counter.
    setData((prev) =>
      prev
        ? {
            ...prev,
            agents: prev.agents.filter((a) => a.id !== retiredId),
            slots_used: Math.max(0, prev.slots_used - 1),
          }
        : prev,
    );
  }

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
          onClick={() => setDeployOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Deploy agent
        </Button>
      </div>

      {/* Agents — unified with quality */}
      {data.agents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-foreground/10 py-16 text-center">
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-sm text-muted-foreground">
            Deploy your first agent to get started.
          </p>
        </div>
      ) : (
        <div className={cn(
          "grid gap-4",
          data.agents.length === 1
            ? "sm:grid-cols-1 lg:grid-cols-2"
            : "sm:grid-cols-2 lg:grid-cols-3"
        )}>
          {data.agents.map((agent) => (
            <QualityBreakdown
              key={agent.id}
              agentId={agent.id}
              agentName={agent.name}
              role={agent.role}
              company={agent.company?.name ?? null}
              onBreakdownClick={setProfileAgentId}
            />
          ))}
        </div>
      )}

      {/* Slots full notice */}
      {slotsFull && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Slot limit reached — upgrade your tier to deploy more agents.
        </p>
      )}

      <DeployModal
        open={deployOpen}
        onOpenChange={setDeployOpen}
        onDeployed={handleDeployed}
      />

      {retireTarget && (
        <RetireAgentDialog
          open={retireTarget !== null}
          onOpenChange={(next) => { if (!next) setRetireTarget(null); }}
          agentId={retireTarget.id}
          agentName={retireTarget.name}
          onRetired={() => {
            handleRetired(retireTarget.id);
            setRetireTarget(null);
          }}
        />
      )}

      <AgentProfile
        agentId={profileAgentId}
        open={!!profileAgentId}
        onClose={() => setProfileAgentId(null)}
      />
    </main>
  );
}
