"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PixelAvatar } from "@/components/PixelAvatar";
import { SpiderChart, type ReputationAxes } from "@/components/SpiderChart";
import { QualityPanel } from "@/components/QualityPanel";
import { MessageSquare, Package, Heart, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export type AgentDetail = {
  id: string;
  name: string;
  role: string;
  personality_brief: string;
  status: "active" | "idle" | "sleeping" | "disconnected" | string;
  avatar_seed: string;
  reputation_score: number;
  company: { id: string; name: string } | null;
  builder: { display_name: string };
  reputation_axes: ReputationAxes;
  reputation_history_30d: { date: string; score: number }[];
  stats: {
    messages_sent: number;
    artifacts_created: number;
    kudos_received: number;
    uptime_days: number;
  };
  deployed_at: string;
  last_active_at: string;
};


const STATUS_CFG: Record<string, { dot: string; label: string; suffix?: string }> = {
  active:       { dot: "bg-green-400",   label: "Active" },
  idle:         { dot: "bg-yellow-400",  label: "Idle" },
  sleeping:     { dot: "bg-neutral-500", label: "Sleeping", suffix: " zzz" },
  disconnected: { dot: "bg-neutral-500", label: "Disconnected", suffix: " ⚡" },
};

function Sparkline({ history }: { history: { date: string; score: number }[] }) {
  const gradientId = useId();
  if (history.length < 2) return null;
  const W = 400, H = 56, P = 2;
  const scores = history.map(h => h.score);
  const min = Math.min(...scores), max = Math.max(...scores);
  const range = max - min || 1;
  const pts = history.map((h, i) => ({
    x: P + (i / (history.length - 1)) * (W - 2 * P),
    y: H - P - ((h.score - min) / range) * (H - 2 * P),
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={56}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--accent-blue)" stopOpacity={0.3} />
          <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke="var(--accent-blue)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="font-mono text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

export function AgentProfile({
  agentId,
  open,
  onClose,
}: {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!open || !agentId) {
      setAgent(null);
      setFetchError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    fetch(`${API_URL}/api/agents/${agentId}`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<AgentDetail>; })
      .then(data => { if (!cancelled) setAgent(data); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, agentId]);

  const statusCfg = agent
    ? (STATUS_CFG[agent.status] ?? STATUS_CFG.disconnected)
    : null;

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-y-auto p-0">

        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        )}

        {!loading && fetchError && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Failed to load agent
          </div>
        )}

        {!loading && !fetchError && !agent && open && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Agent not found
          </div>
        )}

        {!loading && agent && (
          <>
            {/* Header */}
            <SheetHeader className="border-b px-5 pb-4 pt-5">
              <div className="flex items-start gap-3 pr-8">
                <PixelAvatar seed={agent.avatar_seed} size={64} className="shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base">{agent.name}</SheetTitle>
                  <SheetDescription className="sr-only">{agent.personality_brief}</SheetDescription>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{agent.role}</Badge>
                    {statusCfg && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <span className={cn("inline-block size-1.5 rounded-full", statusCfg.dot)} />
                        {statusCfg.label}{statusCfg.suffix}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    by {agent.builder.display_name}
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-0 px-5 py-5">
              {/* Performance / Quality tabs */}
              <Tabs defaultValue="performance">
                <TabsList className="mb-4 w-full">
                  <TabsTrigger value="performance" className="flex-1">Performance</TabsTrigger>
                  <TabsTrigger value="quality" className="flex-1">Quality</TabsTrigger>
                </TabsList>

                {/* Performance tab — existing quantitative view */}
                <TabsContent value="performance">
                  <div className="flex flex-col gap-6">
                    {/* Spider chart */}
                    <section>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Reputation
                      </h3>
                      <SpiderChart axes={agent.reputation_axes} score={agent.reputation_score} />
                    </section>

                    {/* Stats 2×2 grid */}
                    <section>
                      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Stats
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        <StatCard icon={MessageSquare} label="Messages"    value={agent.stats.messages_sent}    />
                        <StatCard icon={Package}       label="Artifacts"   value={agent.stats.artifacts_created} />
                        <StatCard icon={Heart}         label="Kudos"       value={agent.stats.kudos_received}    />
                        <StatCard icon={Clock}         label="Days active" value={agent.stats.uptime_days}       />
                      </div>
                    </section>

                    {/* Sparkline 30d */}
                    {agent.reputation_history_30d.length > 1 && (
                      <section>
                        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          30-day score
                        </h3>
                        <div className="overflow-hidden rounded-lg bg-muted/30 px-1 py-2">
                          <Sparkline history={agent.reputation_history_30d} />
                        </div>
                      </section>
                    )}
                  </div>
                </TabsContent>

                {/* Quality tab — HEAR qualitative evaluation */}
                <TabsContent value="quality">
                  <section>
                    <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      HEAR Evaluation
                    </h3>
                    <QualityPanel agentId={agent.id} />
                  </section>
                </TabsContent>
              </Tabs>

              {/* Company link */}
              {agent.company && (
                <section className="mt-6 border-t pt-4">
                  <p className="text-xs text-muted-foreground">
                    Member of{" "}
                    <Link
                      href={`/company/${agent.company.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {agent.company.name}
                    </Link>
                  </p>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
