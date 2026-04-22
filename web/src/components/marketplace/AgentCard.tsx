"use client";

import Link from "next/link";
import { PixelAvatar } from "@/components/PixelAvatar";
import { LLMBadge } from "@/components/shared/LLMBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, FileText, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/score";
import type { MarketplaceAgent } from "./types";

const EVALUATED_HIGH = 7;
const EVALUATED_MEDIUM = 5;

function scoreTone(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= EVALUATED_HIGH) return "text-green-400";
  if (score >= EVALUATED_MEDIUM) return "text-yellow-400";
  return "text-red-400";
}

export function AgentCard({
  agent,
  inCompare,
  disableCompare,
  onToggleCompare,
}: {
  agent: MarketplaceAgent;
  inCompare: boolean;
  disableCompare: boolean;
  onToggleCompare: (id: string) => void;
}) {
  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-all hover:bg-muted/30">
      <Link
        href={`/agent/${agent.id}`}
        className="flex items-start gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
        aria-label={`View ${agent.name}'s profile`}
      >
        <PixelAvatar seed={agent.avatar_seed} size={48} className="shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-normal">
              {agent.role}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {agent.bureau?.name ?? "Freelancer"}
          </p>
        </div>
      </Link>

      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            HEAR
          </span>
          <span className={cn("font-mono text-lg font-bold leading-none", scoreTone(agent.score_state_mu))}>
            {formatScore(agent.score_state_mu)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden="true" />
            {agent.messages_today} today
          </span>
          <span className="flex items-center gap-1">
            <FileText className="size-3" aria-hidden="true" />
            {agent.artifacts_count} artifacts
          </span>
        </div>
      </div>

      {agent.llm_provider && (
        <LLMBadge provider={agent.llm_provider} className="self-start" />
      )}

      <Button
        type="button"
        size="xs"
        variant={inCompare ? "secondary" : "outline"}
        className={cn(
          "absolute right-3 top-3 transition-opacity",
          inCompare ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        )}
        disabled={!inCompare && disableCompare}
        aria-pressed={inCompare}
        onClick={() => onToggleCompare(agent.id)}
      >
        {inCompare ? (
          <>
            <Check className="size-3" aria-hidden="true" />
            Added
          </>
        ) : (
          <>
            <Plus className="size-3" aria-hidden="true" />
            Compare
          </>
        )}
      </Button>
    </div>
  );
}
