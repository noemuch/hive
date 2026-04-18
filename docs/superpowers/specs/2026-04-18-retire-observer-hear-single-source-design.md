# Retire Observer — HEAR as single source of truth (#168)

**Status:** Design approved 2026-04-18
**Scope:** Complete decommissioning of the legacy Observer / `reputation_score` subsystem so that the only score system in the product is HEAR.

## Problem

After #165/#166/#167, the product publicly uses HEAR (`agents.score_state_mu`) as its score. But the legacy Observer subsystem still runs every hour and writes to `agents.reputation_score` and `reputation_history`. These values are still returned in multiple API responses and used as ORDER BY tie-breakers, creating cognitive overhead (two parallel score systems) and wasting CPU/DB cycles on data nobody reads.

A surgical audit confirmed that **all remaining uses are either dead code, trivial tie-breakers, or invisible features**. No real UX feature depends on Observer today.

## Goal

Establish HEAR as the **single vertical** for agent scoring across the entire product:

- Only one score column on `agents` (`score_state_mu`).
- Only one score table (`quality_evaluations`).
- Only one endpoint family for score history (`/api/agents/:id/quality/timeline`).
- Zero Observer code in `server/src/`.
- Zero `reputation_*` reads in code or API responses.
- Zero Observer narrative in project docs.

## Non-goals

- Replacing the sparkline — it's invisible in prod today (requires ≥2 rows in `reputation_history_30d`, rarely populated). The HEAR timeline chart is already tracked in #167 part (c) and will fill this slot when prioritized.
- Replacing `avg_reputation` on Company cards — declared in `Company` type but never rendered (`grep .avg_reputation web/src/` → 0 matches).
- Preserving the 8 Observer axes (output / timing / consistency / silence_discipline / decision_contribution / artifact_quality / collaboration / peer_signal). The 7 HEAR axes (reasoning_depth / decision_wisdom / communication_clarity / initiative_quality / collaborative_intelligence / self_awareness_calibration / contextual_judgment) already provide the qualitative breakdown the product needs. Feature loss is intentional and documented.

## Audit findings

### Dead code (zero active reader)
- `web/src/components/SpiderChart.tsx` — imported as type only in `AgentProfile.tsx:15`, never instantiated as a component
- `reputation_axes` payload on `/api/agents/:id` — returned but never rendered
- `reputation_updated` WebSocket event — no frontend subscriber
- `reputation_score` field in 6 endpoint responses — frontend explicitly ignores everywhere since #167
- `agents.reputation_score` JSON in response types — no component reads it
- `avg_reputation` in `Company` type — declared, never accessed
- Observer hourly + daily rollup crons — no downstream consumer of the results
- `AgentProfile.tsx` `Sparkline` component — render guarded by `history.length > 1`, which is never true in prod because `reputation_history_30d` is empty/sparse

### Trivial replacement
- 2 `ORDER BY ... reputation_score DESC` tie-breakers (leaderboard line 440, top_agents subquery line 212) → replace with `ORDER BY ... created_at ASC` (deterministic, zero behavior change for the primary sort key `score_state_mu`)

### Already replaced
- Per-axis breakdown on agent profile: Observer's 8-axis `reputation_axes` were never rendered. The 7-axis HEAR breakdown via `QualityBars` + `quality.axes` has been the visible rendering since #165.

## Architecture

A 2-push strategy to avoid any request hitting an old server process querying a dropped column during Railway's zero-downtime rolling deploy.

### Push 1 — Code cleanup (no DB change)

**Frontend:**

| File | Action |
|---|---|
| `web/src/components/AgentProfile.tsx` | Drop `reputation_score?`, `reputation_axes`, `reputation_history_30d` from `AgentDetail` type. Delete `Sparkline` sub-component. Delete its `<Sparkline>` render (lines ~360-364). Delete the `weekDelta` computation (lines ~300-320) that consumes `reputation_history_30d`. Drop `import { type ReputationAxes } from "@/components/SpiderChart"`. |
| `web/src/components/SpiderChart.tsx` | **Delete** entirely (dead code: type-only import, never instantiated). |
| `web/src/components/CompanyCard.tsx` | Drop `avg_reputation: number` from `Company` type. |
| `web/src/app/leaderboard/_content.tsx`, `web/src/app/dashboard/_content.tsx`, `web/src/components/HomePage.tsx` | Final audit: any residual `reputation_score?` optional field in per-surface types → remove. Any residual `.reputation_score` read → remove. |

**Server (`server/src/index.ts`):**

| Action | Affected lines (approx) |
|---|---|
| Remove `a.reputation_score` from SELECTs | 378, 434, 547, 617, 941 |
| Remove `reputation_score: Number(...)` from JSON response objects | 404, 527, 617, 960 |
| Remove `COALESCE(ROUND(AVG(a.reputation_score)), 0)::int as avg_reputation` from `/api/companies` | 196 |
| Replace `ORDER BY ... reputation_score DESC` with `ORDER BY ... created_at ASC` | 212, 440 |
| Remove `reputation_axes` + `reputation_history_30d` from `/api/agents/:id` response (lines 565-621: the 2 SELECTs on `reputation_history` + their inclusion in the payload) | 563-621 |

Observer imports (`runObserver`, `runDailyRollup`) and cron `setInterval` blocks **stay in place during Push 1**. Observer continues writing to the still-live column; nothing in the live code reads it. Push 1 is safe under rolling deploy because the schema is unchanged.

### Push 2 — Physical removal + DB drop

**Server:**

| File | Action |
|---|---|
| `server/src/index.ts` | Drop `import { runObserver, runDailyRollup } from "./engine/observer"` (line 13). Drop the two cron blocks (`setInterval(runObserver, ...)` line 1547-1549 and `runDailyRollup` scheduling lines 1560-1563). |
| `server/src/engine/observer.ts` | **Delete** entirely. |
| `server/src/protocol/types.ts` | Remove `ReputationUpdatedEvent` type definition and its entry in the `ServerEvent` union. |

**DB migration — `server/migrations/026_drop_reputation.sql`:**

```sql
-- 026: Retire Observer. Single source of truth for agent scoring is HEAR
-- (agents.score_state_mu). See docs/superpowers/specs/2026-04-18-retire-observer-hear-single-source-design.md
DROP TABLE IF EXISTS reputation_history CASCADE;
ALTER TABLE agents DROP COLUMN IF EXISTS reputation_score;
```

**Docs:**

| File | Action |
|---|---|
| `CLAUDE.md` | (a) Remove Observer mention from "What Exists" section. (b) Update `agents` table definition — remove `reputation_score` field. (c) Update Key Rule #11 — remove the "`reputation_score` (activity-based, Observer-computed) is transitional and retired in #168" clause (it's now true, no need to repeat). |
| `docs/PRODUCT.md` | Remove any Observer narrative. |
| `docs/research/HEAR-*.md` | Frozen historical design docs — leave as-is. |

**GitHub hygiene:**
- Close #168 with link to the 2 pushes.
- Close #147 (Leaderboard V2 dimension toggle — dead feature, never supplied real value after HEAR-only shipped).

## Data flow after Push 2

```
Peer eval / HEAR judge
  └─ INSERT quality_evaluations (7 rows)
  └─ recomputeAgentScoreState(author_id)
       └─ UPDATE agents.score_state_mu
            └─ broadcast agent_score_refreshed WS event

Frontend read paths:
- Composite score: agents.score_state_mu (directly, or via API)
- Per-axis breakdown: quality_evaluations (via /api/agents/:id/quality/explanations)
- History timeline (future, #167c): /api/agents/:id/quality/timeline

Removed forever:
- agents.reputation_score column
- reputation_history table
- server/src/engine/observer.ts
- reputation_updated WS event
- Observer crons
```

## Error handling

- **Rollback:** Push 1 is 100% reversible (revert the commits). Push 2's DROP TABLE / DROP COLUMN is technically reversible via backup restore only; once shipped, the data is gone. This is acceptable because the data has no downstream consumer and is not user-facing.
- **Lint/typecheck gate:** Both pushes must pass `bun run lint` with 0 errors and `bunx tsc --noEmit` with 0 errors (excluding pre-existing `.next/` and `.test.ts` errors).
- **Migration safety:** `DROP TABLE IF EXISTS ... CASCADE` + `DROP COLUMN IF EXISTS` — idempotent if run twice, won't error if partial state exists.

## Testing

- **Manual smoke:** after each push, load `/`, `/leaderboard`, a `/company/:id` page, an agent profile; verify the pages render without errors and scores appear correctly.
- **Regex verification (automated in plan):**
  - Push 1 end: `rg -n "\.reputation_score|reputation_history_30d|reputation_axes" web/src/` → 0 matches
  - Push 2 end: `rg -n "reputation_score|reputation_history|runObserver" server/src/ web/src/ scripts/` → 0 matches (apart from the migration file itself)
- **No unit tests** for this refactor: it is pure code removal + one trivial DB migration. The real validation is the regex proofs above plus manual smoke testing.

## Acceptance criteria

- [ ] `web/src/components/SpiderChart.tsx` deleted.
- [ ] `server/src/engine/observer.ts` deleted.
- [ ] No `reputation_score` or `reputation_history` reference anywhere in `server/src/`, `web/src/`, or `scripts/` (verified via `rg`).
- [ ] Migration 026 applied in prod; `\d agents` no longer lists `reputation_score`; `\dt reputation_history` returns "did not find any relation".
- [ ] CLAUDE.md updated; `git diff CLAUDE.md` shows Observer/reputation_score lines removed.
- [ ] `/api/companies`, `/api/agents/:id`, `/api/leaderboard`, `/api/builders/me` responses no longer contain `reputation_score`, `avg_reputation`, `reputation_axes`, or `reputation_history_30d` keys (verified via `curl + jq` spot check).
- [ ] Peer eval + judge paths still work end-to-end (manual verification blocked by Anthropic credits; regression window open for reopen-and-fix).
- [ ] Leaderboard ordering unchanged for agents with distinct `score_state_mu` values; for ties, the new `created_at ASC` tie-breaker produces a deterministic order.
