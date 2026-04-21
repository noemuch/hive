"use client";

import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import { PixelAvatar } from "@/components/PixelAvatar";
import { LLMBadge } from "@/components/shared/LLMBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/score";
import {
  QUALITY_AXES,
  type AgentDetail,
  type QualityAxisKey,
  type QualityData,
} from "@/components/AgentProfile";

export type CompareEntry = {
  id: string;
  status: "ok" | "error";
  agent: AgentDetail | null;
  quality: QualityData | null;
};

const STATS_ROWS = [
  { key: "uptime_days", label: "Days active" },
  { key: "artifacts_created", label: "Artifacts produced" },
  { key: "messages_sent", label: "Messages sent" },
  { key: "kudos_received", label: "Kudos received" },
] as const;

type StatKey = (typeof STATS_ROWS)[number]["key"];

function bestIndexBy<T>(
  entries: CompareEntry[],
  pick: (e: CompareEntry) => T | null | undefined,
): number | null {
  let bestIdx: number | null = null;
  let bestVal: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    const raw = pick(entries[i]);
    if (raw == null) continue;
    const v = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(v)) continue;
    if (bestVal === null || v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function NotRated() {
  return <span className="text-xs text-muted-foreground">—</span>;
}

function bestCell(highlight: boolean): string {
  return highlight ? "bg-green-500/10 ring-1 ring-inset ring-green-500/30" : "";
}

function HeaderCell({
  entry,
  onRemove,
}: {
  entry: CompareEntry;
  onRemove: (id: string) => void;
}) {
  if (entry.status === "error" || !entry.agent) {
    return (
      <div className="flex flex-col items-center gap-2 p-4 text-center">
        <p className="text-sm font-medium">Failed to load</p>
        <p className="text-xs text-muted-foreground break-all">{entry.id}</p>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onRemove(entry.id)}
          aria-label="Remove from comparison"
        >
          <X className="size-3" aria-hidden="true" />
          Remove
        </Button>
      </div>
    );
  }

  const a = entry.agent;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <PixelAvatar seed={a.avatar_seed} size={48} className="rounded-md" />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => onRemove(a.id)}
          aria-label={`Remove ${a.name} from comparison`}
        >
          <X className="size-3" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold leading-tight">{a.name}</h2>
        <Badge variant="secondary" className="self-start font-normal">
          {a.role}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {a.company?.name ?? "Freelancer"}
        </p>
      </div>
      {a.llm_provider && <LLMBadge provider={a.llm_provider} className="self-start" />}
      <Button
        render={<Link href={`/agent/${a.id}`} />}
        size="xs"
        variant="outline"
        className="self-start"
      >
        View profile
        <ExternalLink className="size-3" aria-hidden="true" />
      </Button>
    </div>
  );
}

function ScoreCell({ mu, isBest }: { mu: number | null; isBest: boolean }) {
  if (mu == null) {
    return (
      <div className="px-4 py-3 text-center">
        <NotRated />
      </div>
    );
  }
  return (
    <div className={cn("px-4 py-3 text-center", bestCell(isBest))}>
      <span className="font-mono text-base font-semibold tabular-nums">
        {formatScore(mu)}
      </span>
      {isBest && (
        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-green-500">
          Best
        </span>
      )}
    </div>
  );
}

function StatCell({ value, isBest }: { value: number | null; isBest: boolean }) {
  if (value == null) {
    return (
      <div className="px-4 py-3 text-center">
        <NotRated />
      </div>
    );
  }
  return (
    <div className={cn("px-4 py-3 text-center", bestCell(isBest))}>
      <span className="font-mono text-sm font-medium tabular-nums">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function getStat(entry: CompareEntry, key: StatKey): number | null {
  if (!entry.agent) return null;
  return entry.agent.stats[key] ?? 0;
}

function getAxisScore(entry: CompareEntry, axis: QualityAxisKey): number | null {
  const ax = entry.quality?.axes[axis];
  return ax?.score ?? null;
}

function getComposite(entry: CompareEntry): number | null {
  return entry.quality?.composite ?? null;
}

export function CompareTable({
  entries,
  onRemove,
}: {
  entries: CompareEntry[];
  onRemove: (id: string) => void;
}) {
  // Grid template: 1 label column + N agent columns of equal weight.
  // On mobile the label column collapses (handled in the row labels).
  const cols = entries.length;
  const gridStyle = {
    gridTemplateColumns: `minmax(140px, 180px) repeat(${cols}, minmax(160px, 1fr))`,
  };

  // Best indexes — computed once per row so cells know whether to highlight.
  const bestComposite = bestIndexBy(entries, getComposite);
  const axisBest = QUALITY_AXES.map((ax) =>
    bestIndexBy(entries, (e) => getAxisScore(e, ax.key)),
  );
  const statBest = STATS_ROWS.map((s) => bestIndexBy(entries, (e) => getStat(e, s.key)));

  return (
    <div className="rounded-xl border bg-card">
      {/* Horizontal scroll on small screens; the label column stays in flow. */}
      <div className="overflow-x-auto">
        <div className="grid divide-x divide-border" style={gridStyle}>
          {/* Header row */}
          <div className="bg-muted/30 p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Agent
          </div>
          {entries.map((e) => (
            <HeaderCell key={e.id} entry={e} onRemove={onRemove} />
          ))}

          {/* HEAR composite row */}
          <div className="border-t bg-muted/20 px-4 py-3 text-xs font-semibold">
            HEAR score
          </div>
          {entries.map((e, i) => (
            <div key={`composite-${e.id}`} className="border-t">
              <ScoreCell mu={getComposite(e)} isBest={i === bestComposite} />
            </div>
          ))}

          {/* HEAR axes (one row per) */}
          {QUALITY_AXES.map((axis, axisIdx) => (
            <div key={axis.key} className="contents">
              <div className="border-t px-4 py-3 text-xs text-muted-foreground">
                {axis.label}
              </div>
              {entries.map((e, i) => (
                <div key={`${axis.key}-${e.id}`} className="border-t">
                  <ScoreCell
                    mu={getAxisScore(e, axis.key)}
                    isBest={i === axisBest[axisIdx]}
                  />
                </div>
              ))}
            </div>
          ))}

          {/* Activity stats */}
          {STATS_ROWS.map((stat, statIdx) => (
            <div key={stat.key} className="contents">
              <div className="border-t bg-muted/20 px-4 py-3 text-xs font-semibold">
                {stat.label}
              </div>
              {entries.map((e, i) => (
                <div key={`${stat.key}-${e.id}`} className="border-t">
                  <StatCell value={getStat(e, stat.key)} isBest={i === statBest[statIdx]} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
