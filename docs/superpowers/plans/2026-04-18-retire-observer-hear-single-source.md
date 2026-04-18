# Retire Observer — HEAR Single Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully decommission the legacy Observer subsystem so `agents.score_state_mu` (HEAR) is the only score mechanism in the product — no `reputation_score` column, no `reputation_history` table, no `observer.ts`, no `reputation_updated` WS event, no `reputation_*` references anywhere in the codebase or docs.

**Architecture:** Two sequential pushes to main. **Push 1** removes every *read* of the legacy fields across the server API and the frontend, but keeps the Observer crons running (still harmlessly writing to a live column). **Push 2** deletes Observer code, drops the `ReputationUpdatedEvent` protocol type, and runs a migration that drops the column + table. Splitting the work this way eliminates the race condition where an old server process could query a dropped column during Railway's rolling deploy.

**Tech Stack:** Bun + pg / Next.js 16 + React 19 / PostgreSQL / GitHub CLI.

---

## File Structure

### Push 1 (code cleanup, no DB change)

| File | Action |
|---|---|
| `server/src/index.ts` | Remove all `reputation_score` selects + JSON payload fields. Replace `ORDER BY ... reputation_score DESC` tie-breakers with `ORDER BY ... created_at ASC`. Remove `reputation_history` queries and `reputation_axes` / `reputation_history_30d` from `/api/agents/:id`. |
| `web/src/components/AgentProfile.tsx` | Drop `reputation_score?`, `reputation_axes`, `reputation_history_30d` from `AgentDetail` type. Delete `Sparkline` sub-component. Delete `<Sparkline>` render site + surrounding container. Delete `weekDelta` computation + its render. Drop `import { type ReputationAxes }`. |
| `web/src/components/SpiderChart.tsx` | **Delete** (dead code: type-only import, never instantiated). |
| `web/src/components/CompanyCard.tsx` | Drop `avg_reputation: number` from `Company` type. |

### Push 2 (kill Observer + DB drop)

| File | Action |
|---|---|
| `server/src/index.ts` | Drop `import { runObserver, runDailyRollup }`. Drop the two cron blocks (hourly observer + daily rollup). |
| `server/src/engine/observer.ts` | **Delete** entirely. |
| `server/src/protocol/types.ts` | Remove `ReputationUpdatedEvent` type + its entry in the `ServerEvent` union. |
| `server/migrations/026_drop_reputation.sql` | Create: drop `reputation_history` table + `agents.reputation_score` column. |
| `CLAUDE.md` | Remove Observer mention from "What Exists". Remove `reputation_score` from `agents` table description. Trim Key Rule #11. |
| `docs/PRODUCT.md` | Remove Observer narrative. |

---

# PHASE 1 — Push 1 (code cleanup, no DB change)

## Task 1: Server — remove `reputation_score` from all SELECTs and JSON responses

**Files:**
- Modify: `server/src/index.ts` — 9 line-level edits across `/api/companies`, `/api/builders/me`, `/api/leaderboard` (both dimensions)

- [ ] **Step 1: `/api/companies` — drop `avg_reputation`**

Open `server/src/index.ts`. Find line ~196:

```ts
           COALESCE(ROUND(AVG(a.reputation_score)), 0)::int as avg_reputation,
           ROUND(AVG(a.score_state_mu)::numeric, 2) as avg_score_state_mu,
```

Remove the `avg_reputation` line (keep the `avg_score_state_mu` line). Also remove the corresponding field from the JSON response in this handler (search for `avg_reputation:` inside the same `/api/companies` handler block and delete the key).

- [ ] **Step 2: `/api/companies` top_agents subquery — fix tie-breaker (line ~212)**

```ts
               ORDER BY a2.score_state_mu DESC NULLS LAST, a2.reputation_score DESC
```

Replace with:

```ts
               ORDER BY a2.score_state_mu DESC NULLS LAST, a2.created_at ASC
```

- [ ] **Step 3: `/api/builders/me` — drop `reputation_score` (lines ~378, ~404)**

Find the SELECT that includes `a.reputation_score,` (line ~378) and remove that column. Then find the object being returned to build the agent row (line ~404) with `reputation_score: Number(a.reputation_score),` and remove that key.

- [ ] **Step 4: `/api/leaderboard` (performance + composite) — drop `reputation_score` + fix tie-breaker (lines ~434, ~440, ~527)**

Find line ~434:

```ts
           a.reputation_score,
```

Remove it. Find line ~440:

```ts
         ORDER BY a.score_state_mu DESC NULLS LAST, a.reputation_score DESC
```

Replace with:

```ts
         ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at ASC
```

Find line ~527:

```ts
          reputation_score: Number(row.reputation_score),
```

Remove it.

- [ ] **Step 5: `/api/leaderboard?dimension=quality` — drop `reputation_score` (lines ~941, ~960)**

Find line ~941:

```ts
             a.id, a.name, a.role, a.avatar_seed, a.reputation_score,
```

Change to:

```ts
             a.id, a.name, a.role, a.avatar_seed,
```

Find line ~960:

```ts
          reputation_score: Number(row.reputation_score ?? 0),
```

Remove it.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/noechague/Documents/finary/order66/server && bunx tsc --noEmit 2>&1 | grep -v "\.test\.ts"
```

Expected: empty output.

- [ ] **Step 7: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add server/src/index.ts
git commit -m "chore(hear): drop reputation_score from server API responses + ORDER BY (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Server — remove `reputation_history` queries from `/api/agents/:id`

**Files:**
- Modify: `server/src/index.ts` lines ~545-621

- [ ] **Step 1: Remove `a.reputation_score` from the agent SELECT (line ~547)**

Find the SELECT that starts with `SELECT a.id, a.name, a.role, a.personality_brief, ...` (around line 545). Remove the line:

```ts
                a.reputation_score,
```

- [ ] **Step 2: Remove the 2 SELECTs on `reputation_history` (lines ~562-584)**

Find and delete the entire block:

```ts
      // Reputation axes: latest score per axis (bounded to 90 days for partition pruning)
      const { rows: axes } = await pool.query(
        `SELECT DISTINCT ON (axis) axis, ROUND(score)::int as score
         FROM reputation_history
         WHERE agent_id = $1 AND computed_at > now() - INTERVAL '90 days'
         ORDER BY axis, computed_at DESC`,
        [agentId]
      );
      const reputationAxes: Record<string, number> = {};
      for (const row of axes) {
        reputationAxes[row.axis] = row.score;
      }

      // Reputation history 30 days: daily composite score
      const { rows: history30d } = await pool.query(
        `SELECT DATE(computed_at) as date,
                ROUND(AVG(score))::int as score
         FROM reputation_history
         WHERE agent_id = $1 AND computed_at > now() - INTERVAL '30 days'
         GROUP BY DATE(computed_at)
         ORDER BY date`,
        [agentId]
      );
```

- [ ] **Step 3: Remove `reputation_score`, `reputation_axes`, `reputation_history_30d` from the response object**

In the same handler, find the `return json({ agent: { ... } })` block (around lines 605-630). Remove these 3 fields:

```ts
        // Transitional alias for frontend compat — removed in #168.
        reputation_score: Number(agent.reputation_score),
```

and

```ts
        reputation_axes: reputationAxes,
        reputation_history_30d: history30d,
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/noechague/Documents/finary/order66/server && bunx tsc --noEmit 2>&1 | grep -v "\.test\.ts"
```

Expected: empty output.

- [ ] **Step 5: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add server/src/index.ts
git commit -m "chore(hear): remove reputation_history reads from /api/agents/:id (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — drop Sparkline + weekDelta + `reputation_*` fields from `AgentProfile.tsx`

**Files:**
- Modify: `web/src/components/AgentProfile.tsx`

- [ ] **Step 1: Drop the SpiderChart type import (line ~15)**

Find:

```ts
import { type ReputationAxes } from "@/components/SpiderChart";
```

Delete the line.

- [ ] **Step 2: Drop `reputation_score?`, `reputation_axes`, `reputation_history_30d` from `AgentDetail` (lines ~36, ~39, ~40)**

Find the `AgentDetail` type. Remove these three lines:

```ts
  // Transitional — removed in #168. Not read by the UI.
  reputation_score?: number;
```

and

```ts
  reputation_axes: ReputationAxes;
  reputation_history_30d: { date: string; score: number }[];
```

- [ ] **Step 3: Delete the `Sparkline` sub-component (lines ~243-283)**

Find the function declaration:

```ts
function Sparkline({ history }: { history: { date: string; score: number }[] }) {
```

Delete the entire function body (ends at the closing `}` of the component, approximately 40 lines including the SVG return).

- [ ] **Step 4: Delete `weekDelta` computation + `history` variable (lines ~300-307)**

Inside `Altitude1`, remove:

```ts
  // Compute week delta from last 7 days of reputation_history_30d
  const history = agent.reputation_history_30d;
  const weekDelta = (() => {
    if (history.length < 2) return null;
    const recent = history.slice(-7);
    if (recent.length < 2) return null;
    return recent[recent.length - 1].score - recent[0].score;
  })();
```

- [ ] **Step 5: Delete the weekDelta render + Sparkline render (lines ~353-364)**

Inside the `Score` card JSX, remove:

```tsx
                {weekDelta != null && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {weekDelta >= 0 ? "\u2191" : "\u2193"} {weekDelta >= 0 ? "+" : ""}{weekDelta.toFixed(1)}/wk
                  </span>
                )}
```

and:

```tsx
              {/* Sparkline full-width */}
              {history.length > 1 && (
                <div className="overflow-hidden rounded-md bg-muted/30 px-1 py-1.5">
                  <Sparkline history={history.slice(-10)} />
                </div>
              )}
```

- [ ] **Step 6: Typecheck + lint**

```bash
cd /Users/noechague/Documents/finary/order66/web
bunx tsc --noEmit 2>&1 | grep -v "^\.next/"
bun run lint 2>&1 | tail -3
```

Expected: 0 errors on both. (Warnings about unused eslint-disable are acceptable — they are intentional for CI.)

- [ ] **Step 7: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add web/src/components/AgentProfile.tsx
git commit -m "chore(profile): drop Sparkline + reputation_* fields (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — drop `avg_reputation` from `Company` type

**Files:**
- Modify: `web/src/components/CompanyCard.tsx`

- [ ] **Step 1: Remove the field (line ~16)**

Find:

```ts
  avg_reputation: number;
```

Delete the line.

- [ ] **Step 2: Verify no consumer (read-only grep)**

```bash
cd /Users/noechague/Documents/finary/order66
grep -rn "\.avg_reputation" web/src/ || true
```

Expected: empty. (No `.avg_reputation` access anywhere.)

- [ ] **Step 3: Typecheck + lint**

```bash
cd web && bunx tsc --noEmit 2>&1 | grep -v "^\.next/"
bun run lint 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add web/src/components/CompanyCard.tsx
git commit -m "chore(card): drop avg_reputation (never rendered) (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — delete `SpiderChart.tsx`

**Files:**
- Delete: `web/src/components/SpiderChart.tsx`

- [ ] **Step 1: Verify no remaining import**

```bash
cd /Users/noechague/Documents/finary/order66
grep -rn "SpiderChart" web/src/ || true
```

Expected: empty (the last import was dropped in Task 3 Step 1).

- [ ] **Step 2: Delete the file**

```bash
rm web/src/components/SpiderChart.tsx
```

- [ ] **Step 3: Typecheck + lint**

```bash
cd web && bunx tsc --noEmit 2>&1 | grep -v "^\.next/"
bun run lint 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add web/src/components/SpiderChart.tsx
git commit -m "chore(web): delete SpiderChart.tsx (dead code) (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Push 1 — verify end-to-end + ship

**Files:**
- None (verification + push).

- [ ] **Step 1: Proof greps**

```bash
cd /Users/noechague/Documents/finary/order66
echo "--- frontend ---"
grep -rn "\.reputation_score\|reputation_history_30d\|reputation_axes\|\.avg_reputation" web/src/ || true
echo "--- server (reads only — observer.ts will be deleted in Push 2) ---"
grep -rn "\.reputation_score\|reputation_history" server/src/ | grep -v "observer.ts" || true
```

Expected: both greps empty (observer.ts still contains references, but those are internal to a file that only Observer's own code uses; it's scoped for Push 2).

- [ ] **Step 2: Dev server smoke**

```bash
cd web && bun run dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/leaderboard
kill %1
```

Expected: both `200`.

- [ ] **Step 3: Push to main**

```bash
cd /Users/noechague/Documents/finary/order66
git push origin main
```

- [ ] **Step 4: Verify Railway + Vercel deploy (~90s)**

Open prod home + leaderboard + dashboard + one agent profile in the browser. Verify:
- Pages load.
- Composite scores still display (either as a number or "Not evaluated yet").
- No sparkline visible on agent profile (by design — was already invisible).
- No `reputation_score` or `avg_reputation` fields in `curl $PROD/api/agents/<id>` response (spot check).

Wait for full observation (~2-3 min) before starting Push 2. Any 500 error → revert before proceeding.

---

# PHASE 2 — Push 2 (kill Observer + DB drop)

## Task 7: Server — delete Observer (crons + imports + observer.ts + protocol type)

**Files:**
- Modify: `server/src/index.ts` (remove import + 2 cron blocks)
- Modify: `server/src/protocol/types.ts` (remove event type)
- Delete: `server/src/engine/observer.ts`

- [ ] **Step 1: Remove the observer import (line ~13)**

In `server/src/index.ts`, find:

```ts
import { runObserver, runDailyRollup } from "./engine/observer";
```

Delete the line.

- [ ] **Step 2: Remove the hourly observer cron (lines ~1547-1550)**

Find and delete the block:

```ts
// Observer: hourly reputation scoring
setInterval(() => {
  runObserver().catch(err => console.error("[observer] hourly scoring error:", err));
}, 60 * 60 * 1000);
```

(The exact surrounding comment may vary; use grep to locate `runObserver`.)

- [ ] **Step 3: Remove the daily rollup scheduling (lines ~1556-1565)**

Find and delete the block that schedules `runDailyRollup` (first via `setTimeout` at midnight, then via `setInterval`). Grep for `runDailyRollup` to locate.

- [ ] **Step 4: Remove `ReputationUpdatedEvent` from `server/src/protocol/types.ts`**

Open the file. Delete:

```ts
export type ReputationUpdatedEvent = {
  type: "reputation_updated";
  agent_id: string;
  new_score: number;
};
```

And remove `| ReputationUpdatedEvent` from the `ServerEvent` union (around line 265).

- [ ] **Step 5: Delete `server/src/engine/observer.ts`**

```bash
rm server/src/engine/observer.ts
```

- [ ] **Step 6: Typecheck**

```bash
cd server && bunx tsc --noEmit 2>&1 | grep -v "\.test\.ts"
```

Expected: empty output. If the test files reference `ReputationUpdatedEvent` or observer, fix them (but the audit found no test references; the pre-existing `register.test.ts` errors are unrelated).

- [ ] **Step 7: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add server/src/index.ts server/src/protocol/types.ts server/src/engine/observer.ts
git commit -m "chore(hear): delete Observer cron + observer.ts + ReputationUpdatedEvent (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: DB migration — drop `reputation_history` + `reputation_score`

**Files:**
- Create: `server/migrations/026_drop_reputation.sql`

- [ ] **Step 1: Create the migration file**

```bash
cat > /Users/noechague/Documents/finary/order66/server/migrations/026_drop_reputation.sql <<'SQL'
-- 026: Retire Observer. Single source of truth for agent scoring is HEAR
-- (agents.score_state_mu). See
-- docs/superpowers/specs/2026-04-18-retire-observer-hear-single-source-design.md
DROP TABLE IF EXISTS reputation_history CASCADE;
ALTER TABLE agents DROP COLUMN IF EXISTS reputation_score;
SQL
```

- [ ] **Step 2: Sanity-check the file**

```bash
cat server/migrations/026_drop_reputation.sql
```

Expected output: the 4 lines above.

- [ ] **Step 3: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add server/migrations/026_drop_reputation.sql
git commit -m "chore(db): migration 026 drop reputation_score + reputation_history (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Docs cleanup — CLAUDE.md + PRODUCT.md

**Files:**
- Modify: `/Users/noechague/Documents/finary/order66/CLAUDE.md`
- Modify: `/Users/noechague/Documents/finary/order66/docs/PRODUCT.md`

- [ ] **Step 1: Trim CLAUDE.md**

Open `CLAUDE.md`. Three edits:

(a) In the "What Exists" bullet list, remove the parenthetical `(code exists, not running on real data)` mention of `observer` — actually remove any `observer` entry entirely since it no longer exists.

(b) In the `agents` table row of the "Database Tables" section, find the line that lists `reputation_score, reputation_history [deprecated, removed in #168]` and remove that substring. The final line should read approximately:

```
- **agents** -- AI agents (builder_id, name, role, api_key_hash, company_id, status, avatar_seed, score_state_mu, score_state_sigma, last_evaluated_at)
```

(c) In Key Rule #11 (HEAR-only scoring), remove the tail clause about `reputation_score` being transitional — the sentence should end after `"Not evaluated yet"`. The following sentence currently reads:

```
`reputation_score` (activity-based, Observer-computed) is transitional and retired in #168.
```

Delete that entire sentence.

- [ ] **Step 2: Trim `docs/PRODUCT.md` (if Observer narrative exists)**

```bash
grep -n "Observer\|reputation_score" docs/PRODUCT.md || true
```

For each hit, read surrounding context and remove the paragraph or line that describes Observer as a live system. If the file doesn't mention Observer, skip this step.

- [ ] **Step 3: Commit**

```bash
cd /Users/noechague/Documents/finary/order66
git add CLAUDE.md docs/PRODUCT.md
git commit -m "docs: remove Observer / reputation_score mentions (#168)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Push 2 — verify + ship + close issues + update memory

**Files:**
- None (verification + ship).

- [ ] **Step 1: Final proof greps**

```bash
cd /Users/noechague/Documents/finary/order66
echo "--- all code ---"
grep -rn "reputation_score\|reputation_history\|runObserver\|runDailyRollup\|ReputationUpdatedEvent\|reputation_updated" server/src/ web/src/ scripts/ 2>/dev/null | grep -v "node_modules" || true
echo "--- migrations (expected: only 026_drop_reputation.sql references them in DROP statements) ---"
grep -rn "reputation_score\|reputation_history" server/migrations/ | grep -v "^server/migrations/026" | grep -v "^server/migrations/001" | grep -v "^server/migrations/005" || true
```

Expected:
- First grep: empty.
- Second grep: empty (the existing migrations 001 and 005 that created the artifacts are allowed to retain their historical DDL — only new code must be clean).

- [ ] **Step 2: Dev server smoke**

```bash
cd web && bun run dev &
WEB_PID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill $WEB_PID
```

Expected: `200`.

- [ ] **Step 3: Push to main**

```bash
cd /Users/noechague/Documents/finary/order66
git push origin main
```

- [ ] **Step 4: Verify prod (~90s)**

Railway logs should show migration 026 ran successfully (`DROP TABLE reputation_history; ALTER TABLE agents DROP COLUMN reputation_score;`). Vercel frontend should render home + leaderboard + profile without errors.

Spot check with `psql $DATABASE_URL -c "\\d agents"` — the `reputation_score` column must be absent. `psql $DATABASE_URL -c "\\dt reputation_history"` must return "Did not find any relation".

- [ ] **Step 5: Close #168 on GitHub**

```bash
gh issue close 168 -c "Retired Observer in two pushes:
- Push 1: removed all reputation_* reads across server + frontend ($(git log --pretty=%H --grep "#168" | tail -6 | head -1 | cut -c1-7)..$(git log --pretty=%H --grep "#168" | tail -2 | head -1 | cut -c1-7))
- Push 2: deleted observer.ts + protocol type + migration 026 (this push)

Single source of truth for agent scores is now \`agents.score_state_mu\` (HEAR) exclusively. Grep proofs in PR body.

Closed follow-up: #147 (leaderboard dimension toggle — dead feature, retired with Observer)."
```

- [ ] **Step 6: Close #147 (Leaderboard V2 dimension toggle)**

```bash
gh issue close 147 -c "Dimension toggle retired with Observer in #168. HEAR is the single score; no toggle needed."
```

- [ ] **Step 7: Update memory**

Add (or update) the HEAR-scoring memory to reflect that Observer is retired. Open `/Users/noechague/.claude/projects/-Users-noechague-Documents-finary-order66/memory/project_hear_scoring.md`, change any sentence mentioning `reputation_score` or Observer to past tense ("was retired in #168").

The `MEMORY.md` index doesn't need changes.
