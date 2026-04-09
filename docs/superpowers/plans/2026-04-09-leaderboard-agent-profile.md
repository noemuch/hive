# Leaderboard + Agent Profile Slide-over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/leaderboard` page (podium top 3 + table top 50 + company filter) and the `AgentProfile` slide-over (spider chart, stats, sparkline), plus the `/agent/:id` standalone route.

**Architecture:** Three shared components (`PixelAvatar`, `SpiderChart`, `AgentProfile`) consumed by a client-side leaderboard page and a thin agent detail page. No new API routes — `GET /api/leaderboard` and `GET /api/agents/:id` already exist. Charts are pure inline SVG (no chart libraries).

**Tech Stack:** Next.js 16 App Router, Tailwind v4, Base UI (Sheet + Menu), @dicebear/core + @dicebear/collection v9, inline SVG for radar + sparkline.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/app/globals.css` | Modify | Add `--accent-blue` + `--shadow-glow-blue` tokens |
| `web/src/components/PixelAvatar.tsx` | Create | DiceBear pixel-art avatar → `<img>` with data URI |
| `web/src/components/SpiderChart.tsx` | Create | Inline SVG radar chart, 8 axes, exports `ReputationAxes` type |
| `web/src/components/AgentProfile.tsx` | Create | Sheet slide-over: header, spider chart, stats grid, sparkline, company link |
| `web/src/app/leaderboard/_content.tsx` | Create | "use client" — fetches leaderboard, podium, table, company filter, URL sync, opens AgentProfile |
| `web/src/app/leaderboard/page.tsx` | Rewrite | Server component — Suspense wrapper around `_content.tsx` |
| `web/src/app/agent/[id]/page.tsx` | Rewrite | "use client" — forces AgentProfile open for a given id |

---

## Task 1: Design tokens

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add `--accent-blue` to `@theme inline`**

In the `@theme inline { ... }` block, after the `--color-accent-cyan` line:

```css
  --color-accent-blue: var(--accent-blue);
```

- [ ] **Step 2: Add `--accent-blue` value in `:root`**

In `:root`, after `--accent-cyan`:

```css
  --accent-blue: oklch(0.650 0.190 240);
```

- [ ] **Step 3: Add `--shadow-glow-blue` in `:root`**

After `--shadow-glow-green`:

```css
  --shadow-glow-blue: 0 0 8px oklch(0.650 0.190 240 / 0.3);
```

- [ ] **Step 4: Verify the globals.css `:root` block now looks like this (relevant lines)**

```css
  --accent-green: oklch(0.745 0.190 149.59);
  --accent-purple: oklch(0.606 0.219 292.72);
  --accent-cyan: oklch(0.703 0.113 206.15);
  --accent-blue: oklch(0.650 0.190 240);

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.08);
  --shadow-glow-green: 0 0 8px oklch(0.745 0.190 149.59 / 0.3);
  --shadow-glow-blue: 0 0 8px oklch(0.650 0.190 240 / 0.3);
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/globals.css
git commit -m "feat: add accent-blue and shadow-glow-blue tokens"
```

---

## Task 2: PixelAvatar component

**Files:**
- Create: `web/src/components/PixelAvatar.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { pixelArt } from "@dicebear/collection";
import { cn } from "@/lib/utils";

export function PixelAvatar({
  seed,
  size = 40,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const src = useMemo(() => {
    try {
      const avatar = createAvatar(pixelArt, { seed, size });
      const svg = avatar.toString();
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {
      return "";
    }
  }, [seed, size]);

  if (!src) {
    return (
      <div
        style={{ width: size, height: size }}
        className={cn(
          "flex items-center justify-center rounded-sm bg-muted font-mono text-xs text-muted-foreground",
          className
        )}
        aria-hidden="true"
      >
        {seed.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={cn("rounded-sm", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/maxime/hive && npx nx typecheck agent-app 2>&1 | head -30
```

Expected: no errors related to `PixelAvatar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PixelAvatar.tsx
git commit -m "feat: add PixelAvatar component (DiceBear pixel-art)"
```

---

## Task 3: SpiderChart component

**Files:**
- Create: `web/src/components/SpiderChart.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

const AXES = [
  { key: "output",                label: "Output"    },
  { key: "timing",                label: "Timing"    },
  { key: "consistency",           label: "Consistency" },
  { key: "silence_discipline",    label: "Silence"   },
  { key: "decision_contribution", label: "Decisions" },
  { key: "artifact_quality",      label: "Quality"   },
  { key: "collaboration",         label: "Collab"    },
  { key: "peer_signal",           label: "Peer"      },
] as const;

export type ReputationAxes = {
  output: number;
  timing: number;
  consistency: number;
  silence_discipline: number;
  decision_contribution: number;
  artifact_quality: number;
  collaboration: number;
  peer_signal: number;
};

export function SpiderChart({
  axes,
  score,
}: {
  axes: ReputationAxes;
  score: number;
}) {
  const cx = 140, cy = 140, maxR = 95, labelR = 120;
  const n = AXES.length;

  const angleAt = (i: number) => ((i / n) * 2 * Math.PI) - Math.PI / 2;

  const outerPts = AXES.map((_, i) => ({
    x: cx + maxR * Math.cos(angleAt(i)),
    y: cy + maxR * Math.sin(angleAt(i)),
  }));

  const dataPts = AXES.map((ax, i) => ({
    x: cx + (axes[ax.key] / 100) * maxR * Math.cos(angleAt(i)),
    y: cy + (axes[ax.key] / 100) * maxR * Math.sin(angleAt(i)),
  }));

  const labelPts = AXES.map((_, i) => {
    const a = angleAt(i);
    const cos = Math.cos(a), sin = Math.sin(a);
    return {
      x: cx + labelR * cos,
      y: cy + labelR * sin,
      label: AXES[i].label,
      textAnchor: (cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle") as React.SVGAttributes<SVGTextElement>["textAnchor"],
      dy: sin > 0.3 ? "1em" : sin < -0.3 ? "-0.2em" : "0.35em",
    };
  });

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + " Z";

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1].map(s =>
    toPath(
      AXES.map((_, i) => ({
        x: cx + s * maxR * Math.cos(angleAt(i)),
        y: cy + s * maxR * Math.sin(angleAt(i)),
      }))
    )
  );

  return (
    <svg
      viewBox="0 0 280 280"
      width={240}
      height={240}
      className="mx-auto"
      aria-label={`Reputation radar chart, score ${Math.round(score)}`}
    >
      {/* Grid rings */}
      {rings.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
      ))}
      {/* Axis spokes */}
      {outerPts.map((p, i) => (
        <line
          key={i}
          x1={cx} y1={cy}
          x2={p.x.toFixed(2)} y2={p.y.toFixed(2)}
          stroke="currentColor" strokeOpacity={0.08} strokeWidth={1}
        />
      ))}
      {/* Data polygon */}
      <path
        d={toPath(dataPts)}
        fill="var(--accent-blue)"
        fillOpacity={0.2}
        stroke="var(--accent-blue)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Data point dots */}
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={2.5} fill="var(--accent-blue)" />
      ))}
      {/* Axis labels */}
      {labelPts.map((p, i) => (
        <text
          key={i}
          x={p.x.toFixed(2)} y={p.y.toFixed(2)}
          textAnchor={p.textAnchor}
          dy={p.dy}
          fontSize={8.5}
          fill="currentColor"
          fillOpacity={0.55}
        >
          {p.label}
        </text>
      ))}
      {/* Central score */}
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize={24} fontWeight={700} fill="currentColor">
        {Math.round(score)}
      </text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.45}>
        score
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Check TypeScript**

```bash
cd /Users/maxime/hive && npx nx typecheck agent-app 2>&1 | head -30
```

Expected: no errors in `SpiderChart.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SpiderChart.tsx
git commit -m "feat: add SpiderChart SVG radar component"
```

---

## Task 4: AgentProfile slide-over

**Files:**
- Create: `web/src/components/AgentProfile.tsx`

Depends on: `PixelAvatar`, `SpiderChart`, `Sheet`, `Badge` (all exist).

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PixelAvatar } from "@/components/PixelAvatar";
import { SpiderChart, type ReputationAxes } from "@/components/SpiderChart";
import { MessageSquare, Package, Heart, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentDetail = {
  id: string;
  name: string;
  role: string;
  personality_brief: string;
  status: "active" | "idle" | "sleeping" | "disconnected" | string;
  avatar_seed: string;
  reputation_score: number;
  company: { id: string; name: string };
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

const ROLE_BADGE: Record<string, string> = {
  pm:          "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  designer:    "bg-purple-500/15 text-purple-400 border border-purple-500/20",
  developer:   "bg-green-500/15 text-green-400 border border-green-500/20",
  qa:          "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
  ops:         "bg-orange-500/15 text-orange-400 border border-orange-500/20",
  generalist:  "bg-neutral-500/15 text-neutral-400 border border-neutral-500/20",
};

const STATUS_CFG: Record<string, { dot: string; label: string; suffix?: string }> = {
  active:       { dot: "bg-green-400",   label: "Active" },
  idle:         { dot: "bg-yellow-400",  label: "Idle" },
  sleeping:     { dot: "bg-neutral-500", label: "Sleeping", suffix: " zzz" },
  disconnected: { dot: "bg-neutral-500", label: "Disconnected", suffix: " ⚡" },
};

function Sparkline({ history }: { history: { date: string; score: number }[] }) {
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
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--accent-blue)" stopOpacity={0.3} />
          <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-fill)" />
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

  useEffect(() => {
    if (!open || !agentId) {
      setAgent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agents/${agentId}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setAgent(data); })
      .catch(() => { if (!cancelled) setAgent(null); })
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

        {!loading && !agent && open && (
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
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        ROLE_BADGE[agent.role] ?? ROLE_BADGE.generalist
                      )}
                    >
                      {agent.role}
                    </span>
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

            <div className="flex flex-col gap-6 px-5 py-5">
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

              {/* Company link */}
              <section className="border-t pt-4">
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
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/maxime/hive && npx nx typecheck agent-app 2>&1 | head -40
```

Expected: no errors in `AgentProfile.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AgentProfile.tsx
git commit -m "feat: add AgentProfile sheet slide-over with radar chart + sparkline"
```

---

## Task 5: Leaderboard page

**Files:**
- Create: `web/src/app/leaderboard/_content.tsx`
- Rewrite: `web/src/app/leaderboard/page.tsx`

Pattern: same as home page — `page.tsx` is a server component with Suspense; `_content.tsx` is the `"use client"` component that holds state, fetching, and rendering.

### 5a — `_content.tsx`

**Style alignment with existing codebase:**
- `DropdownMenuTrigger` uses `render={<Button variant="outline" size="sm" />}` (same as GridControls)
- Containers use `ring-1 ring-foreground/10` not `border border-border` (same as CompanyGrid skeletons)
- Loading state uses `<Skeleton />` component (same as CompanyGrid)
- `API_URL` constant at top (same as CompanyGrid)
- `py-8` spacing (same as home page)
- `cursor-pointer` on interactive elements (same as GridControls)

- [ ] **Step 1: Create `web/src/app/leaderboard/_content.tsx`**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { PixelAvatar } from "@/components/PixelAvatar";
import { AgentProfile } from "@/components/AgentProfile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type LeaderboardAgent = {
  rank: number;
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  company: { id: string; name: string };
  reputation_score: number;
  trend: "up" | "down" | "stable";
};

const ROLE_BADGE: Record<string, string> = {
  pm:         "bg-blue-500/15 text-blue-400",
  designer:   "bg-purple-500/15 text-purple-400",
  developer:  "bg-green-500/15 text-green-400",
  qa:         "bg-yellow-500/15 text-yellow-400",
  ops:        "bg-orange-500/15 text-orange-400",
  generalist: "bg-neutral-500/15 text-neutral-400",
};

// Podium layout: visual order left→right is [#2, #1, #3]
// PODIUM_AGENT_IDX[podiumPos] = index into top3 array
const PODIUM_AGENT_IDX = [1, 0, 2] as const;
const PODIUM_HEIGHT     = ["h-52", "h-64", "h-44"] as const;
const PODIUM_GLOW       = [
  "[box-shadow:var(--shadow-glow-blue)]",
  "[box-shadow:var(--shadow-glow-green)]",
  "[box-shadow:var(--shadow-glow-blue)]",
] as const;
// Rank color per podium position [#2-left, #1-center, #3-right]
const PODIUM_RANK_COLOR = ["text-neutral-300", "text-yellow-400", "text-orange-400"] as const;
// Rank color per rank number index (rank-1): [#1, #2, #3]
const TABLE_RANK_COLOR  = ["text-yellow-400", "text-neutral-300", "text-orange-400"] as const;

function Trend({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up")   return <span className="font-mono text-sm text-green-400">↑</span>;
  if (trend === "down") return <span className="font-mono text-sm text-red-400">↓</span>;
  return <span className="font-mono text-sm text-muted-foreground">—</span>;
}

function PodiumCard({
  agent,
  podiumIdx,
  onClick,
}: {
  agent: LeaderboardAgent;
  podiumIdx: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 cursor-pointer flex-col items-center justify-end gap-2 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-all hover:scale-[1.02] hover:ring-foreground/20",
        PODIUM_HEIGHT[podiumIdx],
        PODIUM_GLOW[podiumIdx],
      )}
    >
      <span className={cn("font-mono text-2xl font-bold", PODIUM_RANK_COLOR[podiumIdx])}>
        #{agent.rank}
      </span>
      <PixelAvatar seed={agent.avatar_seed} size={56} className="rounded-md" />
      <div className="text-center">
        <div className="max-w-[120px] truncate text-sm font-semibold">{agent.name}</div>
        <div className="max-w-[120px] truncate text-xs text-muted-foreground">{agent.company.name}</div>
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          ROLE_BADGE[agent.role] ?? ROLE_BADGE.generalist
        )}
      >
        {agent.role}
      </span>
      <span className="font-mono text-lg font-bold">{agent.reputation_score.toFixed(1)}</span>
    </button>
  );
}

function LeaderboardSkeleton() {
  return (
    <>
      {/* Podium skeleton */}
      <div className="mb-10 flex items-end gap-3">
        {[208, 256, 176].map((h, i) => (
          <div key={i} style={{ height: h }} className="flex-1 rounded-2xl bg-card ring-1 ring-foreground/10">
            <Skeleton className="h-full w-full rounded-2xl" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="size-7 rounded-sm" />
            <Skeleton className="h-4 w-36" />
            <div className="ml-auto flex items-center gap-4">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-6" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function LeaderboardContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [agents,        setAgents]        = useState<LeaderboardAgent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [selectedId,    setSelectedId]    = useState<string | null>(() => params.get("agent"));

  // Fetch leaderboard on mount
  useEffect(() => {
    fetch(`${API_URL}/api/leaderboard`)
      .then(r => r.json())
      .then(data => setAgents(data.agents ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("agent", id);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  const closeAgent = useCallback(() => {
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("agent");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  // Derived state
  const companies = [...new Map(agents.map(a => [a.company.id, a.company])).values()];
  const filtered  = companyFilter
    ? agents.filter(a => a.company.id === companyFilter)
    : agents;
  const top3 = filtered.slice(0, 3);
  const companyLabel = companyFilter
    ? (companies.find(c => c.id === companyFilter)?.name ?? "All companies")
    : "All companies";

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto max-w-5xl px-6 py-8" aria-label="Leaderboard">
        {/* Page header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Leaderboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">Top agents by reputation score</p>
          </div>

          {/* Company filter — same DropdownMenu pattern as GridControls */}
          {companies.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" className="cursor-pointer" />}
              >
                <ArrowUpDown className="size-3.5" />
                {companyLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCompanyFilter(null)} className="cursor-pointer">
                  All companies
                </DropdownMenuItem>
                {companies.map(c => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => setCompanyFilter(c.id)}
                    className="cursor-pointer"
                  >
                    {c.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {loading && <LeaderboardSkeleton />}

        {!loading && (
          <>
            {/* Podium top 3 */}
            {top3.length === 3 && (
              <section className="mb-8" aria-label="Top 3 agents">
                <div className="flex items-end gap-3">
                  {PODIUM_AGENT_IDX.map((agentIdx, podiumIdx) => {
                    const agent = top3[agentIdx];
                    if (!agent) return null;
                    return (
                      <PodiumCard
                        key={agent.id}
                        agent={agent}
                        podiumIdx={podiumIdx}
                        onClick={() => selectAgent(agent.id)}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Table top 50 */}
            <section aria-label="Full rankings">
              <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-14 px-4 py-3 text-left text-xs font-medium text-muted-foreground">Rank</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Agent</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground sm:table-cell">Role</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">Company</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Score</th>
                      <th className="w-14 px-4 py-3 text-center text-xs font-medium text-muted-foreground">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(agent => (
                      <tr
                        key={agent.id}
                        onClick={() => selectAgent(agent.id)}
                        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-secondary/50 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "font-mono text-sm font-semibold",
                              agent.rank <= 3
                                ? TABLE_RANK_COLOR[agent.rank - 1]
                                : "text-muted-foreground"
                            )}
                          >
                            #{agent.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <PixelAvatar seed={agent.avatar_seed} size={28} className="shrink-0 rounded-sm" />
                            <span className="font-medium">{agent.name}</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                              ROLE_BADGE[agent.role] ?? ROLE_BADGE.generalist
                            )}
                          >
                            {agent.role}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                          {agent.company.name}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {agent.reputation_score.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Trend trend={agent.trend} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>

      {/* Agent profile slide-over */}
      <AgentProfile
        agentId={selectedId}
        open={!!selectedId}
        onClose={closeAgent}
      />
    </div>
  );
}
```

### 5b — `page.tsx`

The `LeaderboardSkeleton` now lives in `_content.tsx` (co-located). The page.tsx is a thin Suspense wrapper — same pattern as `app/page.tsx` which wraps `HomeContent` in Suspense with its own `HomeSkeleton`.

- [ ] **Step 2: Rewrite `web/src/app/leaderboard/page.tsx`**

```tsx
import { Suspense } from "react";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";
import { LeaderboardContent } from "./_content";

function LeaderboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-8" aria-label="Leaderboard">
        <div className="mb-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        {/* Podium skeleton */}
        <div className="mb-8 flex items-end gap-3">
          {[208, 256, 176].map((h, i) => (
            <div key={i} style={{ height: h }} className="flex-1 rounded-2xl bg-card ring-1 ring-foreground/10">
              <Skeleton className="h-full w-full rounded-2xl" />
            </div>
          ))}
        </div>
        {/* Table skeleton */}
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="size-7 rounded-sm" />
              <Skeleton className="h-4 w-36" />
              <div className="ml-auto flex items-center gap-4">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-6" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<LeaderboardSkeleton />}>
      <LeaderboardContent />
    </Suspense>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/maxime/hive && npx nx typecheck agent-app 2>&1 | head -40
```

Expected: no errors in either file.

- [ ] **Step 4: Verify in dev server**

```bash
cd /Users/maxime/hive/web && bun run dev
```

Open `http://localhost:3001/leaderboard` (or whatever port the web app runs on).

Expected:
- Skeleton shows while fetching
- Podium renders 3 cards with #2 left / #1 center (taller) / #3 right
- Table shows all agents with rank, avatar, name, role, company, score, trend
- Clicking a row opens the slide-over with URL update (`?agent=:id`)
- Closing the slide-over removes `?agent` from URL
- Company filter dropdown filters both podium and table

- [ ] **Step 5: Commit**

```bash
git add web/src/app/leaderboard/_content.tsx web/src/app/leaderboard/page.tsx
git commit -m "feat: leaderboard page — podium + table + company filter + agent slide-over"
```

---

## Task 6: Agent detail page `/agent/[id]`

**Files:**
- Rewrite: `web/src/app/agent/[id]/page.tsx`

- [ ] **Step 1: Rewrite the file**

```tsx
"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { AgentProfile } from "@/components/AgentProfile";

export default function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router  = useRouter();

  return (
    <main className="h-screen w-screen bg-[#131620]">
      <AgentProfile
        agentId={id}
        open={true}
        onClose={() => router.back()}
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/maxime/hive && npx nx typecheck agent-app 2>&1 | head -20
```

Expected: clean.

- [ ] **Step 3: Verify in dev server**

Navigate to `http://localhost:<port>/agent/<valid-agent-uuid>`.

Expected:
- Dark background (`#131620`)
- Sheet opens immediately from the right with agent data
- Closing the sheet navigates back (browser back)

- [ ] **Step 4: Commit**

```bash
git add web/src/app/agent/\[id\]/page.tsx
git commit -m "feat: agent detail page — slide-over on dark backdrop"
```

---

## Self-review

**Spec coverage check:**

| Requirement | Task |
|-------------|------|
| Leaderboard page `/leaderboard` | Task 5 |
| Podium top 3 (pixel art avatar, glow) | Task 5 – PodiumCard |
| Table top 50 (Rank, Agent, Role, Company, Score, Trend) | Task 5 – table |
| Trend arrow colors | Task 5 – Trend component |
| Responsive (hide Role + Company on mobile) | Task 5 – `hidden sm:table-cell`, `hidden md:table-cell` |
| Company filter dropdown | Task 5 – DropdownMenu |
| Click agent → slide-over | Task 5 – selectAgent callback |
| Fetch `GET /api/leaderboard` | Task 5 – useEffect fetch |
| AgentProfile Sheet side="right" | Task 4 |
| URL sync `?agent=:id` | Task 5 – router.replace |
| Header: avatar, name, role badge, status, builder | Task 4 – SheetHeader |
| Spider chart 8 axes | Task 3 – SpiderChart |
| Stats 2×2 grid | Task 4 – StatCard |
| Sparkline 30 days | Task 4 – Sparkline |
| Company link | Task 4 – Link to /company/:id |
| Route `/agent/[id]` | Task 6 |
| `--accent-blue` token | Task 1 |
| `--shadow-glow-blue` token | Task 1 |
| Pixel art avatars | Task 2 – PixelAvatar |

**Placeholder scan:** None found — all code is complete.

**Style alignment with existing codebase:**
| Pattern | Codebase standard | Plan uses |
|---------|-------------------|-----------|
| Container borders | `ring-1 ring-foreground/10` | ✓ (table + podium cards) |
| Loading state | `<Skeleton />` component | ✓ |
| API URL | `const API_URL = ... \|\| "http://localhost:3000"` | ✓ |
| DropdownMenuTrigger | `render={<Button variant="outline" size="sm" />}` | ✓ |
| Spacing | `py-8`, `max-w-5xl px-6` | ✓ |
| Interactive cursors | `cursor-pointer` explicit | ✓ |
| Hover rows | `hover:bg-secondary/50` | ✓ |

**Type consistency:**
- `ReputationAxes` exported from `SpiderChart.tsx`, imported in `AgentProfile.tsx` ✓
- `AgentDetail` exported from `AgentProfile.tsx` (not needed externally but available) ✓
- `LeaderboardContent` exported from `_content.tsx`, imported in `page.tsx` ✓
- `PixelAvatar` props consistent (`seed`, `size`, `className`) across all usages ✓
