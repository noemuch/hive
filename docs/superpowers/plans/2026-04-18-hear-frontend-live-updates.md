# HEAR-only frontend + live score updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify every HEAR surface on `score_state_mu` (copy, types, read path) and make all four score-displaying surfaces update live over WebSocket when a peer evaluation or judge batch changes an agent's composite score — no page reload, no per-client HTTP refetch.

**Architecture:** Server refactors `recomputeAgentScoreState` to return the fresh snapshot and broadcasts a new additive `agent_score_refreshed` event (once per composite update). Frontend adds a shared hook that subscribes and patches local state on four surfaces, removes transitional aliases, and routes all null-score rendering through a single `formatScore` helper that renders "Not evaluated yet".

**Tech Stack:** Bun + pg (raw SQL) / Next.js 16 + React 19 / existing `useWebSocket` hook backed by `HiveSocket` / existing `router.broadcast`.

---

## File Structure

| File | Role |
|------|------|
| `server/src/protocol/types.ts` (modify) | Add `AgentScoreRefreshedEvent` type |
| `server/src/db/agent-score-state.ts` (modify) | Refactor to return `Snapshot | null` |
| `server/src/engine/peer-evaluation.ts` (modify) | Use return value, broadcast new event |
| `server/src/index.ts` (modify) | Broadcast from `/api/internal/quality/notify` + `/api/internal/quality/invalidate-batch` |
| `web/src/lib/score.ts` (new) | `formatScore(mu)` helper — single source of null copy |
| `web/src/hooks/useAgentScoreRefresh.ts` (new) | Generic subscribe-and-apply hook |
| `web/src/components/HomePage.tsx` (modify) | Subscribe + patch trending, unify copy, drop aliases |
| `web/src/app/leaderboard/_content.tsx` (modify) | Subscribe + patch + re-sort, unify copy, drop aliases |
| `web/src/app/dashboard/_content.tsx` (modify) | Subscribe + patch, unify copy, drop aliases |
| `web/src/components/AgentProfile.tsx` (modify) | Subscribe + patch composite card |

---

## Task 1: Add `AgentScoreRefreshedEvent` type

**Files:**
- Modify: `server/src/protocol/types.ts`

- [ ] **Step 1: Add the type after `QualityUpdatedEvent`**

Insert right after the `QualityUpdatedEvent` block (around line 201):

```ts
export type AgentScoreRefreshedEvent = {
  type: "agent_score_refreshed";
  agent_id: string;
  company_id: string;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
};
```

- [ ] **Step 2: Verify type compiles**

Run: `cd server && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/protocol/types.ts
git commit -m "feat(protocol): add AgentScoreRefreshedEvent type (#167)"
```

---

## Task 2: Refactor `recomputeAgentScoreState` to return snapshot

**Files:**
- Modify: `server/src/db/agent-score-state.ts`

- [ ] **Step 1: Change SQL to UPDATE ... RETURNING and return shape**

Replace the full content of `server/src/db/agent-score-state.ts` with:

```ts
// server/src/db/agent-score-state.ts
//
// Single source of truth for the agents.score_state_mu snapshot.
//
// Canonical formula:
//   agents.score_state_mu = AVG across axes of the LATEST non-invalidated
//     score_state_mu per axis from quality_evaluations, for this agent.
//
// NULL when no non-invalidated peer-eval / judge rows exist for the agent.
//
// Callers: peer-evaluation.ts (after per-axis INSERTs),
//          scripts/hear/lib/db.ts (after judge run INSERT, via HTTP notify),
//          index.ts invalidation path (after UPDATE ... invalidated_at).

import pool from "./pool";

type Queryable = {
  query: <R = unknown>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: R[] }>;
};

export type AgentScoreSnapshot = {
  agent_id: string;
  company_id: string;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
};

const RECOMPUTE_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (axis)
      axis, score_state_mu, score_state_sigma, computed_at
    FROM quality_evaluations
    WHERE agent_id = $1
      AND invalidated_at IS NULL
      AND score_state_mu IS NOT NULL
    ORDER BY axis, computed_at DESC
  ),
  agg AS (
    SELECT
      AVG(score_state_mu)::numeric(6,2)   AS mu,
      AVG(score_state_sigma)::numeric(6,2) AS sigma,
      MAX(computed_at)                     AS last_evaluated_at
    FROM latest
  )
  UPDATE agents
  SET
    score_state_mu    = agg.mu,
    score_state_sigma = agg.sigma,
    last_evaluated_at = agg.last_evaluated_at
  FROM agg
  WHERE id = $1
  RETURNING
    id               AS agent_id,
    company_id,
    score_state_mu,
    score_state_sigma,
    last_evaluated_at
`;

type RecomputeRow = {
  agent_id: string;
  company_id: string;
  score_state_mu: string | null;
  score_state_sigma: string | null;
  last_evaluated_at: Date | null;
};

function toSnapshot(row: RecomputeRow): AgentScoreSnapshot {
  return {
    agent_id: row.agent_id,
    company_id: row.company_id,
    score_state_mu: row.score_state_mu === null ? null : Number(row.score_state_mu),
    score_state_sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
    last_evaluated_at: row.last_evaluated_at === null ? null : row.last_evaluated_at.toISOString(),
  };
}

export async function recomputeAgentScoreState(
  agentId: string,
  db: Queryable = pool,
): Promise<AgentScoreSnapshot | null> {
  const { rows } = await db.query<RecomputeRow>(RECOMPUTE_SQL, [agentId]);
  return rows[0] ? toSnapshot(rows[0]) : null;
}

/**
 * Recompute the snapshot for every agent tied to the given artifact IDs.
 * Returns the fresh snapshot for each affected agent so callers can
 * broadcast composite-refresh events without an extra SELECT.
 */
export async function recomputeAgentScoreStateForArtifacts(
  artifactIds: string[],
  db: Queryable = pool,
): Promise<AgentScoreSnapshot[]> {
  if (artifactIds.length === 0) return [];
  const agentRes = await db.query<{ agent_id: string }>(
    `SELECT DISTINCT agent_id FROM quality_evaluations WHERE artifact_id = ANY($1)`,
    [artifactIds],
  );
  const snapshots: AgentScoreSnapshot[] = [];
  for (const row of agentRes.rows) {
    const { rows } = await db.query<RecomputeRow>(RECOMPUTE_SQL, [row.agent_id]);
    if (rows[0]) snapshots.push(toSnapshot(rows[0]));
  }
  return snapshots;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Verify no existing caller breaks on the new signature**

Run: `rg "recomputeAgentScoreStateForArtifacts|recomputeAgentScoreState" server/src scripts/`
Expected matches:
- `server/src/engine/peer-evaluation.ts` (uses return value → Task 3 will update)
- `server/src/index.ts` invalidation path (uses return as count → update expected type from `number` to `.length` of returned array)

The invalidation endpoint uses the count of agents rescored. Update it in this same task (small change, same concern).

Open `server/src/index.ts`, find `agentsRescored = await recomputeAgentScoreStateForArtifacts(...)` (line ~1231) and change to:

```ts
const rescoredSnapshots = await recomputeAgentScoreStateForArtifacts(
  artifactIds,
  client,
);
agentsRescored = rescoredSnapshots.length;
```

(Keep `rescoredSnapshots` in scope — Task 5 broadcasts from it.)

- [ ] **Step 4: Commit**

```bash
git add server/src/db/agent-score-state.ts server/src/index.ts
git commit -m "refactor(hear): recomputeAgentScoreState returns snapshot (#167)"
```

---

## Task 3: Broadcast `agent_score_refreshed` from peer-evaluation

**Files:**
- Modify: `server/src/engine/peer-evaluation.ts`

- [ ] **Step 1: Replace the recompute call with snapshot capture + broadcast**

Find the existing line (around 398):

```ts
  await recomputeAgentScoreState(pe.author_id);
```

Replace with:

```ts
  const snapshot = await recomputeAgentScoreState(pe.author_id);
  if (snapshot) {
    router.broadcast(snapshot.company_id, {
      type: "agent_score_refreshed",
      agent_id: snapshot.agent_id,
      company_id: snapshot.company_id,
      score_state_mu: snapshot.score_state_mu,
      score_state_sigma: snapshot.score_state_sigma,
      last_evaluated_at: snapshot.last_evaluated_at,
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd server && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/peer-evaluation.ts
git commit -m "feat(hear): broadcast agent_score_refreshed after peer eval (#167)"
```

---

## Task 4: Broadcast from `/api/internal/quality/notify`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: After the per-axis broadcast loop, collect unique agent_ids, recompute, and broadcast composite event**

Inside the `/api/internal/quality/notify` handler, find the `for (const ev of body.evaluations)` loop (around line 1139). After that loop completes and before `return json({ ok: true, ... })`, insert:

```ts
        // Composite-level refresh: for each unique agent touched, recompute
        // the snapshot and broadcast one agent_score_refreshed event.
        const uniqueAgentIds = Array.from(
          new Set(
            body.evaluations
              .map((ev) => ev.agent_id)
              .filter((id): id is string => !!id && UUID_RE.test(id)),
          ),
        );
        for (const agentId of uniqueAgentIds) {
          const snapshot = await recomputeAgentScoreState(agentId);
          if (!snapshot) continue;
          router.broadcast(snapshot.company_id, {
            type: "agent_score_refreshed",
            agent_id: snapshot.agent_id,
            company_id: snapshot.company_id,
            score_state_mu: snapshot.score_state_mu,
            score_state_sigma: snapshot.score_state_sigma,
            last_evaluated_at: snapshot.last_evaluated_at,
          });
        }
```

- [ ] **Step 2: Add the import at the top**

At the top of `server/src/index.ts`, find the existing import:

```ts
import { recomputeAgentScoreStateForArtifacts } from "./db/agent-score-state";
```

Change to:

```ts
import { recomputeAgentScoreState, recomputeAgentScoreStateForArtifacts } from "./db/agent-score-state";
```

- [ ] **Step 3: Typecheck**

Run: `cd server && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(hear): broadcast agent_score_refreshed from quality/notify (#167)"
```

---

## Task 5: Broadcast from `/api/internal/quality/invalidate-batch`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Broadcast from `rescoredSnapshots` produced in Task 2**

Inside the `/api/internal/quality/invalidate-batch` handler, find where `rescoredSnapshots` is assigned (from Task 2). After the transaction commits and before `return json(...)`, insert:

```ts
        for (const snapshot of rescoredSnapshots) {
          router.broadcast(snapshot.company_id, {
            type: "agent_score_refreshed",
            agent_id: snapshot.agent_id,
            company_id: snapshot.company_id,
            score_state_mu: snapshot.score_state_mu,
            score_state_sigma: snapshot.score_state_sigma,
            last_evaluated_at: snapshot.last_evaluated_at,
          });
        }
```

**Critical:** The `rescoredSnapshots` variable is assigned inside the transaction callback. If it's only scoped to the callback, hoist it (`let rescoredSnapshots: AgentScoreSnapshot[] = [];` before the transaction, then assign inside).

Check surrounding code around line 1231 to confirm. If the `pool.connect()/client.query('BEGIN')/COMMIT` pattern is used, declare `rescoredSnapshots` in the outer `try` scope so the broadcast after COMMIT can read it.

- [ ] **Step 2: Add type import**

At the top of `server/src/index.ts`, augment the existing import:

```ts
import { recomputeAgentScoreState, recomputeAgentScoreStateForArtifacts, type AgentScoreSnapshot } from "./db/agent-score-state";
```

- [ ] **Step 3: Typecheck**

Run: `cd server && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(hear): broadcast agent_score_refreshed after batch invalidate (#167)"
```

---

## Task 6: Frontend shared utilities — `formatScore` + `useAgentScoreRefresh`

**Files:**
- Create: `web/src/lib/score.ts`
- Create: `web/src/hooks/useAgentScoreRefresh.ts`

- [ ] **Step 1: Create `web/src/lib/score.ts`**

```ts
/**
 * Canonical score formatting for every HEAR surface.
 * Renders "Not evaluated yet" when the score is null/undefined,
 * otherwise a single-decimal 1-10 number.
 */
export function formatScore(mu: number | null | undefined): string {
  return mu == null ? "Not evaluated yet" : mu.toFixed(1);
}

/** True when the score is missing (agent not yet peer-evaluated). */
export function isScoreMissing(mu: number | null | undefined): boolean {
  return mu == null;
}
```

- [ ] **Step 2: Create `web/src/hooks/useAgentScoreRefresh.ts`**

```ts
"use client";

import { useEffect } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

export type AgentScoreRefreshedPayload = {
  type: "agent_score_refreshed";
  agent_id: string;
  company_id: string;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
};

/**
 * Subscribe to agent_score_refreshed events. Invokes `apply` for every
 * event received; the consumer decides whether the event matches a
 * currently-displayed agent and patches its local state accordingly.
 */
export function useAgentScoreRefresh(
  apply: (ev: AgentScoreRefreshedPayload) => void,
): void {
  const { socket } = useWebSocket();

  useEffect(() => {
    const unsub = socket.on("agent_score_refreshed", (data) => {
      apply(data as unknown as AgentScoreRefreshedPayload);
    });
    return unsub;
  }, [socket, apply]);
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd web && bunx tsc --noEmit 2>&1 | grep -v "^\.next/"`
Expected: 0 errors.

Run: `cd web && bun run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/score.ts web/src/hooks/useAgentScoreRefresh.ts
git commit -m "feat(web): formatScore helper + useAgentScoreRefresh hook (#167)"
```

---

## Task 7: Wire HomePage trending

**Files:**
- Modify: `web/src/components/HomePage.tsx`

- [ ] **Step 1: Add imports**

At the top of the file:

```ts
import { formatScore } from "@/lib/score";
import { useAgentScoreRefresh } from "@/hooks/useAgentScoreRefresh";
import { useCallback } from "react";
```

(If `useCallback` is already imported with the other hooks, merge into that import.)

- [ ] **Step 2: Remove transitional aliases from `AgentData` type**

Find the `AgentData` type (around line 37). Replace:

```ts
  // Canonical HEAR composite (null = not evaluated yet).
  score_state_mu: number | null;
  score_state_sigma?: number | null;
  last_evaluated_at?: string | null;
  // Transitional aliases, removed in #168.
  quality_score?: number | null;
  reputation_score?: number;
  trend?: "up" | "down" | "stable";
```

With:

```ts
  // Canonical HEAR composite (null = not evaluated yet).
  score_state_mu: number | null;
  score_state_sigma?: number | null;
  last_evaluated_at?: string | null;
  trend?: "up" | "down" | "stable";
```

- [ ] **Step 3: Unify render site + remove fallback**

Find the render block around line 190:

```tsx
            {agents.map((agent) => {
              const qualityScore = agent.score_state_mu ?? agent.quality_score ?? null;
              const displayScore = qualityScore !== null ? qualityScore.toFixed(1) : "—";
              return (
```

Replace with:

```tsx
            {agents.map((agent) => {
              const displayScore = formatScore(agent.score_state_mu);
              return (
```

- [ ] **Step 4: Add live subscription**

Find where the `agents` state is defined (it's likely `const [agents, setAgents] = useState<AgentData[]>([]);`). Immediately after the `useState` declarations block, before any `useEffect`, insert:

```tsx
  const applyScoreRefresh = useCallback((ev: { agent_id: string; score_state_mu: number | null; score_state_sigma: number | null; last_evaluated_at: string | null }) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.id === ev.agent_id
          ? {
              ...a,
              score_state_mu: ev.score_state_mu,
              score_state_sigma: ev.score_state_sigma,
              last_evaluated_at: ev.last_evaluated_at,
            }
          : a,
      ),
    );
  }, []);
  useAgentScoreRefresh(applyScoreRefresh);
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd web && bunx tsc --noEmit 2>&1 | grep -v "^\.next/"`
Run: `cd web && bun run lint`
Expected: 0 errors each.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/HomePage.tsx
git commit -m "feat(home): live HEAR score updates + unified copy (#167)"
```

---

## Task 8: Wire Leaderboard

**Files:**
- Modify: `web/src/app/leaderboard/_content.tsx`

- [ ] **Step 1: Add imports**

Near the top:

```ts
import { formatScore } from "@/lib/score";
import { useAgentScoreRefresh } from "@/hooks/useAgentScoreRefresh";
import { useCallback } from "react";
```

- [ ] **Step 2: Remove transitional aliases from `LeaderboardAgent`**

Find the type (around line 55). Remove the `quality_score?` and `reputation_score?` fields — leave the canonical ones.

- [ ] **Step 3: Simplify `formatScore` local function**

Find the local function around line 281:

```tsx
  function formatScore(agent: LeaderboardAgent): string {
    const score = agent.score_state_mu ?? agent.quality_score ?? null;
    return score !== null ? score.toFixed(1) : "—";
  }
```

Remove the local function entirely; replace all `formatScore(agent)` call sites with `formatScore(agent.score_state_mu)` (imported from `@/lib/score`).

Use `rg "formatScore\(" web/src/app/leaderboard/_content.tsx` to find the call sites and update each.

- [ ] **Step 4: Add live subscription with re-sort**

Find the agents state and after its `useState` declaration, insert:

```tsx
  const applyScoreRefresh = useCallback((ev: { agent_id: string; score_state_mu: number | null; score_state_sigma: number | null; last_evaluated_at: string | null }) => {
    setAgents((prev) => {
      const next = prev.map((a) =>
        a.id === ev.agent_id
          ? {
              ...a,
              score_state_mu: ev.score_state_mu,
              score_state_sigma: ev.score_state_sigma,
              last_evaluated_at: ev.last_evaluated_at,
            }
          : a,
      );
      // Re-sort: score_state_mu DESC NULLS LAST, matches server ORDER BY
      next.sort((a, b) => {
        const va = a.score_state_mu;
        const vb = b.score_state_mu;
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      });
      return next;
    });
  }, []);
  useAgentScoreRefresh(applyScoreRefresh);
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd web && bunx tsc --noEmit 2>&1 | grep -v "^\.next/"`
Run: `cd web && bun run lint`
Expected: 0 errors each.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/leaderboard/_content.tsx
git commit -m "feat(leaderboard): live HEAR score updates + re-sort + unified copy (#167)"
```

---

## Task 9: Wire Dashboard

**Files:**
- Modify: `web/src/app/dashboard/_content.tsx`

- [ ] **Step 1: Add imports**

```ts
import { formatScore } from "@/lib/score";
import { useAgentScoreRefresh } from "@/hooks/useAgentScoreRefresh";
import { useCallback } from "react";
```

- [ ] **Step 2: Remove `reputation_score?` from `AgentData` type**

Find the type around line 47. Remove the `reputation_score?: number;` field and its transitional comment.

- [ ] **Step 3: Unify score display sites**

Find the two `"—"` fallbacks (around lines 585 and 638). Each site currently looks like:

```tsx
{agent.score_state_mu != null ? agent.score_state_mu.toFixed(1) : "—"}
```

Replace both with:

```tsx
{formatScore(agent.score_state_mu)}
```

- [ ] **Step 4: Add live subscription**

After the agents state declaration:

```tsx
  const applyScoreRefresh = useCallback((ev: { agent_id: string; score_state_mu: number | null; score_state_sigma: number | null; last_evaluated_at: string | null }) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.id === ev.agent_id
          ? {
              ...a,
              score_state_mu: ev.score_state_mu,
              score_state_sigma: ev.score_state_sigma,
              last_evaluated_at: ev.last_evaluated_at,
            }
          : a,
      ),
    );
  }, []);
  useAgentScoreRefresh(applyScoreRefresh);
```

Note: the dashboard data is per-builder; if `setAgents` is not the state setter (e.g. the list lives inside a nested `data` object), patch inside that structure. Check the file; if the state is `const [data, setData] = useState<DashboardData | null>(null);`, the patch is:

```tsx
  const applyScoreRefresh = useCallback((ev: { agent_id: string; score_state_mu: number | null; score_state_sigma: number | null; last_evaluated_at: string | null }) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.id === ev.agent_id
            ? {
                ...a,
                score_state_mu: ev.score_state_mu,
                score_state_sigma: ev.score_state_sigma,
                last_evaluated_at: ev.last_evaluated_at,
              }
            : a,
        ),
      };
    });
  }, []);
  useAgentScoreRefresh(applyScoreRefresh);
```

Pick the variant that matches the actual state shape after reading the file.

- [ ] **Step 5: Typecheck + lint**

Run: `cd web && bunx tsc --noEmit 2>&1 | grep -v "^\.next/"`
Run: `cd web && bun run lint`
Expected: 0 errors each.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/dashboard/_content.tsx
git commit -m "feat(dashboard): live HEAR score updates + unified copy (#167)"
```

---

## Task 10: Wire AgentProfile composite card

**Files:**
- Modify: `web/src/components/AgentProfile.tsx`

- [ ] **Step 1: Add imports**

```ts
import { useAgentScoreRefresh } from "@/hooks/useAgentScoreRefresh";
```

(`useCallback` is already imported in this file.)

- [ ] **Step 2: Add live subscription scoped to the displayed agent**

Find where the `quality` / `agent` state lives. After that state's declaration:

```tsx
  const applyScoreRefresh = useCallback((ev: { agent_id: string; score_state_mu: number | null; score_state_sigma: number | null; last_evaluated_at: string | null }) => {
    // Only patch if the event is for the profile we are currently viewing.
    if (!agent || ev.agent_id !== agent.id) return;
    // Patch the QualityData.composite (used by the big score card).
    setQuality((prev) =>
      prev
        ? {
            ...prev,
            composite: ev.score_state_mu,
            score_state_mu: ev.score_state_mu,
            score_state_sigma: ev.score_state_sigma,
            last_evaluated_at: ev.last_evaluated_at,
          }
        : prev,
    );
  }, [agent]);
  useAgentScoreRefresh(applyScoreRefresh);
```

(If the state setter is named differently, e.g. `setQualityData`, match the actual name in the file.)

- [ ] **Step 3: Make `reputation_score` optional on the `Agent` type**

Find the `Agent` type around line 30. Change:

```ts
  reputation_score: number;
```

To:

```ts
  // Transitional — removed in #168. Not read by the UI.
  reputation_score?: number;
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd web && bunx tsc --noEmit 2>&1 | grep -v "^\.next/"`
Run: `cd web && bun run lint`
Expected: 0 errors each.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AgentProfile.tsx
git commit -m "feat(profile): live composite refresh from agent_score_refreshed (#167)"
```

---

## Task 11: Verify no stale refs + final grep

**Files:**
- None (verification only).

- [ ] **Step 1: Zero `quality_score` references in web read path**

Run: `rg "quality_score" web/src/`
Expected: empty output. If any remain (comments, unrelated fields), inspect each and either remove or keep if legitimately needed by non-score code.

- [ ] **Step 2: Zero `reputation_score` reads in web (types-only allowed)**

Run: `rg "reputation_score" web/src/`
Expected: at most type-declaration mentions marked `// Transitional — removed in #168.` and optional fields. Zero actual reads like `.reputation_score` used to display a score.

Inspect each remaining match:

```bash
rg -n "\.reputation_score" web/src/
```

This should return zero lines. If it returns anything, remove that read site.

- [ ] **Step 3: Zero `"—"` fallbacks in HEAR surfaces**

Run:
```bash
rg '"—"' web/src/components/HomePage.tsx web/src/app/leaderboard/_content.tsx web/src/app/dashboard/_content.tsx web/src/components/AgentProfile.tsx
```

Expected: empty output.

---

## Task 12: Manual QA + push to main + close (a+b) on #167

**Files:**
- None (verification + ship).

- [ ] **Step 1: Run dev server + open four tabs**

```bash
cd web && bun run dev
```

Open: `http://localhost:3000/`, `http://localhost:3000/leaderboard`, a builder dashboard, an agent profile page. Confirm each tab's score renders correctly (a non-null score shows as `X.X`, a null score shows as "Not evaluated yet").

- [ ] **Step 2: Trigger a peer eval in local or staging**

From another terminal or via the agents in staging:
- Let an agent produce an artifact that triggers a peer eval, OR
- Manually POST to `/api/internal/quality/notify` with the internal token and a fake evaluation payload (for local testing).

Watch all four tabs: the targeted agent's score must update within 2 seconds, no reload.

- [ ] **Step 3: Verify `rg` proof**

Run and paste into commit message:
```bash
rg -n "\.reputation_score|\.quality_score" web/src/
```
Expected: 0 match count.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

- [ ] **Step 5: Wait for Vercel + Railway deploy (~90s), verify prod**

Open prod home + profile + leaderboard + dashboard. Verify scores render with the new copy ("Not evaluated yet" for null). If any score-displaying agent receives a peer eval during the observation window, verify live update.

- [ ] **Step 6: Document split on #167, close the (a+b) portion**

```bash
gh issue comment 167 --body "Parts (a) read-path unification and (b) live WS updates shipped in $(git rev-parse --short HEAD). Part (c) — 30-day timeline chart on AgentProfile — is explicitly deferred and will be filed as a separate issue when we pick it up."
```

Then close with:

```bash
gh issue close 167 -c "Shipped (a)+(b) in $(git rev-parse --short HEAD). Timeline chart (c) deferred."
```

- [ ] **Step 7: Update memory**

```bash
# Not a shell command — do this via the assistant's memory write path:
# - Remove any stale "next up" memory
# - Optionally add a short project memory noting agent_score_refreshed event exists
```
