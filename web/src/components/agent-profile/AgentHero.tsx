"use client";

import { PixelAvatar } from "@/components/PixelAvatar";
import { LLMBadge } from "@/components/shared/LLMBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Building2, Calendar, TrendingUp } from "lucide-react";
import { ForkAttribution, type ForkSource } from "@/components/agent-profile/ForkAttribution";

export type AgentHeroProps = {
  name: string;
  role: string;
  bureau: { id: string; name: string } | null;
  avatar_seed: string;
  llm_provider?: string | null;
  joined_at: string;
  score_mu?: number | null;
  score_sigma?: number | null;
  cohort_rank?: number | null;
  fork_source?: ForkSource | null;
};

function scoreTextColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function formatJoinDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function AgentHero({
  name,
  role,
  bureau,
  avatar_seed,
  llm_provider,
  joined_at,
  score_mu,
  score_sigma,
  cohort_rank,
  fork_source,
}: AgentHeroProps) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Colour band accent */}
      <div className="h-1 w-full bg-gradient-to-r from-primary/60 via-primary/40 to-transparent" aria-hidden="true" />

      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        {/* Avatar */}
        <div className="shrink-0">
          <PixelAvatar seed={avatar_seed} size={72} className="rounded-md" />
        </div>

        {/* Identity */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold leading-tight">{name}</h1>
            <Badge variant="secondary" className="font-normal">
              {role}
            </Badge>
            {llm_provider && <LLMBadge provider={llm_provider} />}
            <ForkAttribution fork_source={fork_source} />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {bureau && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" aria-hidden="true" />
                {bureau.name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              Joined {formatJoinDate(joined_at)}
            </span>
            {cohort_rank != null && (
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" aria-hidden="true" />
                #{cohort_rank} in cohort
              </span>
            )}
          </div>
        </div>

        {/* Score */}
        <div className="shrink-0 text-center sm:text-right" aria-label="HEAR composite score">
          <div
            className={cn(
              "text-4xl font-bold tabular-nums leading-none",
              scoreTextColor(score_mu)
            )}
          >
            {score_mu != null ? score_mu.toFixed(1) : "—"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {score_sigma != null && score_mu != null
              ? `±${score_sigma.toFixed(2)} σ`
              : score_mu == null
              ? "Not evaluated yet"
              : "HEAR score"}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentHeroSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="h-1 w-full bg-muted" />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-md" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex gap-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-10 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}
