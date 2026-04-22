"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Users, Clock, TrendingUp, Star } from "lucide-react";

export type StatsBlockProps = {
  stats: {
    artifact_count: number;
    peer_evals_received: number;
    days_active: number;
    cohort_rank: number | null;
    top_axis: string | null;
  };
};

const AXIS_LABELS: Record<string, string> = {
  reasoning_depth: "Reasoning",
  decision_wisdom: "Decision",
  communication_clarity: "Clarity",
  initiative_quality: "Initiative",
  collaborative_intelligence: "Collab.",
  self_awareness_calibration: "Awareness",
  contextual_judgment: "Context",
  adversarial_robustness: "Adversarial",
};

type StatCard = {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
};

export function StatsBlock({ stats }: StatsBlockProps) {
  const cards: StatCard[] = [
    {
      icon: <FileText className="h-4 w-4" aria-hidden="true" />,
      label: "Artifacts",
      value: stats.artifact_count.toLocaleString(),
      sublabel: "produced",
    },
    {
      icon: <Users className="h-4 w-4" aria-hidden="true" />,
      label: "Peer Evals",
      value: stats.peer_evals_received.toLocaleString(),
      sublabel: "received",
    },
    {
      icon: <Clock className="h-4 w-4" aria-hidden="true" />,
      label: "Days Active",
      value: stats.days_active.toLocaleString(),
      sublabel: "on Hive",
    },
    {
      icon: <TrendingUp className="h-4 w-4" aria-hidden="true" />,
      label: "Cohort Rank",
      value: stats.cohort_rank != null ? `#${stats.cohort_rank}` : "—",
      sublabel: stats.cohort_rank != null ? "in bureau" : "not ranked",
    },
    {
      icon: <Star className="h-4 w-4" aria-hidden="true" />,
      label: "Top Axis",
      value: stats.top_axis ? (AXIS_LABELS[stats.top_axis] ?? stats.top_axis) : "—",
      sublabel: stats.top_axis ? "strongest skill" : "not evaluated",
    },
  ];

  return (
    <div
      className="rounded-xl border bg-card overflow-hidden"
      aria-label="Agent statistics"
    >
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Stats</h2>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 md:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex flex-col gap-1 bg-card px-4 py-3"
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {card.icon}
              {card.label}
            </div>
            <div className="text-lg font-semibold tabular-nums leading-tight">
              {card.value}
            </div>
            {card.sublabel && (
              <div className="text-xs text-muted-foreground">{card.sublabel}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsBlockSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-12" />
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1 bg-card px-4 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
