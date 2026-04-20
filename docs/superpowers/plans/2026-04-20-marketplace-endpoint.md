# Marketplace Endpoint (#194) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `GET /api/agents/marketplace` — a single endpoint that supports search (`q`), filters (role, min_score, llm_provider, min_history_days, status), four sort modes, and offset/limit pagination for the marketplace frontend.

**Architecture:** Pure handler function `handleMarketplace(req, pool)` matching the `register.ts` pattern (exported, no shared state, mocked pool for tests). Route registered in `server/src/index.ts`. All queries parameterized (`$1..$N`). Relies on indexes already shipped in migration 028 (`idx_agents_score_state_mu`, `idx_agents_effective_joined_at`, GIN on `displayed_specializations`, `idx_agents_llm_provider`).

**Tech Stack:** Bun + TypeScript strict, `pg` Pool, `bun:test` with `mock()` for Pool — zero new deps.

---

## Spec Alignment (decisions)

| Issue requirement | Decision |
|---|---|
| `llm_model_label` in response | Column does NOT exist. Return `null` (forward-compat placeholder). Documented in PR body. |
| 60s Redis/LRU cache | OUT OF SCOPE. Fleet size is tiny; endpoint is already fast on indexed columns. Filed as follow-up. |
| `#193` (indexes PR) | Still OPEN. This handler uses the existing indexes from migration 028 which cover all sort/filter paths. Query plan safe. |
| `q` match: name, builder display_name, specializations, role | Implemented via `ILIKE` on name/display_name/role + array containment on specializations. |
| Return shape | `{ agents: [...], total: N, has_more: bool }`. |
| Empty results | Return `200` with `agents: []`, never `404`. |
| `status` default | Exclude `retired` by default (same as leaderboard). |

## File Structure

| File | Responsibility |
|---|---|
| `server/src/handlers/marketplace.ts` | Pure handler: parse query, build SQL, shape response. NEW. |
| `server/src/handlers/marketplace.test.ts` | Unit tests with mocked `pg.Pool`. NEW. |
| `server/src/index.ts` | Register route at line ~83 area (after other `/api/agents/*` routes). MODIFY. |
| `CLAUDE.md` | Add endpoint to REST table. MODIFY. |

---

## Task 1: Handler skeleton + empty-query behavior

**Files:**
- Create: `server/src/handlers/marketplace.ts`
- Test: `server/src/handlers/marketplace.test.ts`

- [ ] **Step 1: Write the failing test for empty query**

```typescript
// server/src/handlers/marketplace.test.ts
import { describe, it, expect, mock } from "bun:test";
import { handleMarketplace } from "./marketplace";

function makePool(rows: unknown[] = [], total = 0) {
  return {
    query: mock(async (sql: string, _params: unknown[]) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ total }] };
      return { rows };
    }),
  };
}

describe("handleMarketplace", () => {
  it("returns empty agents array when no results (not 404)", async () => {
    const pool = makePool([], 0);
    const req = new Request("http://localhost/api/agents/marketplace");
    const res = await handleMarketplace(req, pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.has_more).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — they must fail (ModuleNotFound)**

```bash
cd server && bun test src/handlers/marketplace.test.ts
```
Expected: FAIL with "Cannot find module './marketplace'"

- [ ] **Step 3: Create minimal handler**

```typescript
// server/src/handlers/marketplace.ts
import type { Pool } from "pg";
import { json } from "../http/response";

export async function handleMarketplace(_req: Request, _pool: Pool): Promise<Response> {
  return json({ agents: [], total: 0, has_more: false });
}
```

- [ ] **Step 4: Run tests — green**

Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/marketplace.ts server/src/handlers/marketplace.test.ts
git commit -m "feat(marketplace): handler skeleton returns empty list"
```

---

## Task 2: Pagination (limit + offset)

**Files:**
- Modify: `server/src/handlers/marketplace.ts`
- Modify: `server/src/handlers/marketplace.test.ts`

- [ ] **Step 1: Add failing tests for limit/offset/has_more**

```typescript
it("applies limit=24 default, clamps to 100 max", async () => {
  const pool = makePool([], 0);
  const req = new Request("http://localhost/api/agents/marketplace?limit=500");
  await handleMarketplace(req, pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[1]).toContain(100); // clamped
});

it("computes has_more when total > offset + returned", async () => {
  const pool = makePool(Array(24).fill({ id: "x", name: "n", role: "developer" }), 100);
  const req = new Request("http://localhost/api/agents/marketplace?limit=24&offset=0");
  const res = await handleMarketplace(req, pool as any);
  const body = await res.json();
  expect(body.total).toBe(100);
  expect(body.has_more).toBe(true);
});

it("has_more=false on last page", async () => {
  const pool = makePool(Array(4).fill({ id: "x", name: "n", role: "developer" }), 100);
  const req = new Request("http://localhost/api/agents/marketplace?limit=24&offset=96");
  const res = await handleMarketplace(req, pool as any);
  const body = await res.json();
  expect(body.has_more).toBe(false);
});
```

- [ ] **Step 2: Run tests — they must fail**

- [ ] **Step 3: Implement pagination + base query**

Replace handler with:

```typescript
import type { Pool } from "pg";
import { json } from "../http/response";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

function clampLimit(raw: string | null): number {
  const n = raw ? Math.floor(Number(raw)) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function clampOffset(raw: string | null): number {
  const n = raw ? Math.floor(Number(raw)) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function handleMarketplace(req: Request, pool: Pool): Promise<Response> {
  const url = new URL(req.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const where = `WHERE a.status != 'retired'`;
  const params: unknown[] = [];

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int as total FROM agents a ${where}`,
    params
  );
  const total = countRows[0]?.total ?? 0;

  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.role, a.avatar_seed,
            a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
            a.llm_provider, a.personality_brief AS brief,
            a.displayed_skills, a.displayed_tools,
            COALESCE(a.backdated_joined_at, a.created_at) AS effective_joined_at,
            c.id AS company_id, c.name AS company_name
     FROM agents a
     LEFT JOIN companies c ON a.company_id = c.id
     ${where}
     ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const agents = rows.map(shape);
  return json({ agents, total, has_more: offset + agents.length < total });
}

function shape(r: any) {
  const mu = r.score_state_mu === null ? null : Number(r.score_state_mu);
  const sigma = r.score_state_sigma === null ? null : Number(r.score_state_sigma);
  const skills = Array.isArray(r.displayed_skills) ? r.displayed_skills : [];
  const tools = Array.isArray(r.displayed_tools) ? r.displayed_tools : [];
  const daysActive = r.effective_joined_at
    ? Math.floor((Date.now() - new Date(r.effective_joined_at).getTime()) / 86_400_000)
    : 0;
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    avatar_seed: r.avatar_seed,
    score_state_mu: mu,
    score_state_sigma: sigma,
    last_evaluated_at: r.last_evaluated_at,
    llm_provider: r.llm_provider ?? null,
    llm_model_label: null,
    displayed_skills_count: skills.length,
    displayed_tools_count: tools.length,
    company: r.company_id ? { id: r.company_id, name: r.company_name } : null,
    days_active: daysActive,
    brief: r.brief ?? null,
  };
}
```

- [ ] **Step 4: Run tests — green**

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/marketplace.ts server/src/handlers/marketplace.test.ts
git commit -m "feat(marketplace): pagination + base query"
```

---

## Task 3: Filters (role, min_score, llm_provider, min_history_days, status)

**Files:**
- Modify: `server/src/handlers/marketplace.ts`
- Modify: `server/src/handlers/marketplace.test.ts`

- [ ] **Step 1: Add failing tests — one per filter**

```typescript
it("role filter: ?role=developer,designer → WHERE role = ANY", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?role=developer,designer"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/role = ANY/);
  expect(call?.[1]).toContainEqual(["developer", "designer"]);
});

it("min_score filter passes numeric threshold", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?min_score=7.5"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/score_state_mu >= \$/);
  expect(call?.[1]).toContain(7.5);
});

it("llm_provider filter: ?llm_provider=mistral,anthropic", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?llm_provider=mistral,anthropic"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/llm_provider = ANY/);
});

it("min_history_days filter: ?min_history_days=30", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?min_history_days=30"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/effective_joined_at|COALESCE.*<=/);
});

it("status filter: ?status=active,idle", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?status=active,idle"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/status = ANY/);
});

it("ignores unknown role values silently", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?role=hacker,developer"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[1]).toContainEqual(["developer"]);
});
```

- [ ] **Step 2: Run tests — they must fail**

- [ ] **Step 3: Implement `buildFilters` helper**

Add above `handleMarketplace`:

```typescript
const VALID_ROLES = ["pm", "designer", "developer", "qa", "ops", "generalist"];
const VALID_STATUSES = ["registered", "connected", "assigned", "active", "idle", "sleeping", "disconnected"];
const VALID_PROVIDERS = ["anthropic", "mistral", "deepseek", "openai", "gemini", "groq", "cerebras", "openrouter", "self-hosted", "other"];

function parseCsv(raw: string | null, allowed: readonly string[]): string[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map(s => s.trim().toLowerCase()).filter(s => allowed.includes(s));
  return parts.length ? parts : null;
}

function parseNonNegNum(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

interface Filters {
  roles: string[] | null;
  statuses: string[] | null;
  providers: string[] | null;
  minScore: number | null;
  minHistoryDays: number | null;
}

function parseFilters(url: URL): Filters {
  return {
    roles: parseCsv(url.searchParams.get("role"), VALID_ROLES),
    statuses: parseCsv(url.searchParams.get("status"), VALID_STATUSES),
    providers: parseCsv(url.searchParams.get("llm_provider"), VALID_PROVIDERS),
    minScore: parseNonNegNum(url.searchParams.get("min_score")),
    minHistoryDays: parseNonNegNum(url.searchParams.get("min_history_days")),
  };
}

function buildWhere(f: Filters): { sql: string; params: unknown[] } {
  const clauses: string[] = [`a.status != 'retired'`];
  const params: unknown[] = [];
  if (f.roles) { params.push(f.roles); clauses.push(`a.role = ANY($${params.length})`); }
  if (f.statuses) { params.push(f.statuses); clauses.push(`a.status = ANY($${params.length})`); }
  if (f.providers) { params.push(f.providers); clauses.push(`a.llm_provider = ANY($${params.length})`); }
  if (f.minScore !== null) { params.push(f.minScore); clauses.push(`a.score_state_mu >= $${params.length}`); }
  if (f.minHistoryDays !== null) {
    params.push(f.minHistoryDays);
    clauses.push(`COALESCE(a.backdated_joined_at, a.created_at) <= now() - ($${params.length} || ' days')::interval`);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}
```

Then in `handleMarketplace`, replace the hard-coded `where`/`params` with `buildWhere(parseFilters(url))`.

- [ ] **Step 4: Run tests — green**

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/marketplace.ts server/src/handlers/marketplace.test.ts
git commit -m "feat(marketplace): role/status/provider/score/history filters"
```

---

## Task 4: Search query `q` (ILIKE across name, role, builder display_name, specializations)

**Files:**
- Modify: `server/src/handlers/marketplace.ts`
- Modify: `server/src/handlers/marketplace.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
it("q matches agent name case-insensitive prefix", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?q=maxim"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/ILIKE/);
  expect(call?.[1]).toContain("maxim%");
});

it("q joins builders table to match display_name", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?q=noe"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/JOIN builders/i);
});

it("q empty string is ignored (no ILIKE)", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?q="), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).not.toMatch(/ILIKE/);
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `q` search**

In `parseFilters`, add:
```typescript
interface Filters {
  // ...existing...
  q: string | null;
}
// inside parseFilters return:
q: (url.searchParams.get("q") || "").trim() || null,
```

In `buildWhere`, handle `f.q`:
```typescript
if (f.q) {
  params.push(`${f.q}%`);           // prefix match on name
  params.push(`%${f.q}%`);          // substring match on role/display_name
  params.push(f.q.toLowerCase());    // exact-lower match on a specialization
  const pPrefix = params.length - 2;
  const pSubstr = params.length - 1;
  const pExact  = params.length;
  clauses.push(
    `(a.name ILIKE $${pPrefix} OR a.role ILIKE $${pSubstr} OR b.display_name ILIKE $${pSubstr} OR $${pExact} = ANY(lower(a.displayed_specializations::text)::text[]))`
  );
}
```

Simpler: since `displayed_specializations` is `text[]`, use `ARRAY[lower($N)]::text[] && ARRAY(SELECT lower(unnest(a.displayed_specializations)))`. To keep it straightforward and index-friendly, use `EXISTS (SELECT 1 FROM unnest(a.displayed_specializations) s WHERE lower(s) = $N)`.

Final clause:
```typescript
clauses.push(
  `(a.name ILIKE $${pPrefix}
    OR a.role ILIKE $${pSubstr}
    OR b.display_name ILIKE $${pSubstr}
    OR EXISTS (SELECT 1 FROM unnest(a.displayed_specializations) s WHERE lower(s) = $${pExact}))`
);
```

Add `LEFT JOIN builders b ON a.builder_id = b.id` to BOTH the count and data queries.

- [ ] **Step 4: Run — green**

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/marketplace.ts server/src/handlers/marketplace.test.ts
git commit -m "feat(marketplace): q search across name/role/builder/specializations"
```

---

## Task 5: Sort modes (score | recent_activity | artifact_count | seniority)

**Files:**
- Modify: `server/src/handlers/marketplace.ts`
- Modify: `server/src/handlers/marketplace.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
it("sort=score → ORDER BY score_state_mu DESC", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?sort=score"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/ORDER BY a\.score_state_mu DESC/);
});

it("sort=seniority → ORDER BY effective_joined_at ASC (oldest first)", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?sort=seniority"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/COALESCE\(a\.backdated_joined_at, a\.created_at\) ASC/);
});

it("sort=recent_activity → ORDER BY last_heartbeat DESC NULLS LAST", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?sort=recent_activity"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/last_heartbeat DESC NULLS LAST/);
});

it("sort=artifact_count → joins agent_portfolio_v and orders by artifact_count DESC", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?sort=artifact_count"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/agent_portfolio_v/);
  expect(call?.[0]).toMatch(/artifact_count DESC/);
});

it("unknown sort falls back to score", async () => {
  const pool = makePool();
  await handleMarketplace(new Request("http://localhost/api/agents/marketplace?sort=nonsense"), pool as any);
  const call = pool.query.mock.calls.find(c => !c[0].includes("COUNT"));
  expect(call?.[0]).toMatch(/ORDER BY a\.score_state_mu DESC/);
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implement**

```typescript
const SORT_MAP: Record<string, { orderBy: string; joinPortfolio: boolean }> = {
  score:            { orderBy: "a.score_state_mu DESC NULLS LAST, a.created_at ASC",        joinPortfolio: false },
  recent_activity:  { orderBy: "a.last_heartbeat DESC NULLS LAST",                          joinPortfolio: false },
  artifact_count:   { orderBy: "portfolio.artifact_count DESC NULLS LAST, a.created_at ASC", joinPortfolio: true  },
  seniority:        { orderBy: "COALESCE(a.backdated_joined_at, a.created_at) ASC",         joinPortfolio: false },
};

function parseSort(raw: string | null) {
  return SORT_MAP[raw ?? ""] ?? SORT_MAP.score;
}
```

In `handleMarketplace`, add `const sort = parseSort(url.searchParams.get("sort"));`, conditionally include `LEFT JOIN agent_portfolio_v portfolio ON portfolio.agent_id = a.id` when `sort.joinPortfolio`, add `portfolio.artifact_count` to the SELECT list, and use `ORDER BY ${sort.orderBy}` instead of the hardcoded one.

- [ ] **Step 4: Run — green**

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/marketplace.ts server/src/handlers/marketplace.test.ts
git commit -m "feat(marketplace): four sort modes (score/recent/artifact/seniority)"
```

---

## Task 6: Route registration + CLAUDE.md

**Files:**
- Modify: `server/src/index.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Register route**

Add import near line 6:
```typescript
import { handleMarketplace } from "./handlers/marketplace";
```

Add route block after the `/api/agents/register` block (around line 128, before the DELETE block). Placement matters — more-specific path must go before `match(/^\/api\/agents\/[^/]+$/)`:

```typescript
if (url.pathname === "/api/agents/marketplace" && req.method === "GET") {
  return handleMarketplace(req, pool);
}
```

- [ ] **Step 2: Update REST table in `CLAUDE.md`**

Add row after `/api/agents/register`:
```
| GET    | `/api/agents/marketplace`               | none         | Search + filter + paginate agents  |
```

- [ ] **Step 3: Smoke test (server must still compile)**

```bash
cd server && bun test
```
Expected: all tests pass including marketplace.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts CLAUDE.md
git commit -m "feat(marketplace): register route + document endpoint"
```

---

## Task 7: Quality Gate + push

- [ ] **Step 1: Run the 10 blocking checks**

See CLAUDE.md § "Quality Gate — 10 Blocking Checks". In particular:
- No hardcoded URLs (handler uses only relative/env paths ✓)
- No hardcoded UUIDs (none)
- No magic numbers except default 24 and max 100 (named constants ✓)
- All SQL parameterized (`$1..$N` ✓)
- No `SELECT *` (explicit columns ✓)
- All queries have `LIMIT` or indexed `WHERE` (count query is filtered; data query has `LIMIT` ✓)

- [ ] **Step 2: `bun test` + `bun run lint`**

```bash
cd server && bun test
cd ../web && bun run lint
```

- [ ] **Step 3: Push**

```bash
/home/runner/work/_actions/anthropics/claude-code-action/v1/scripts/git-push.sh origin claude/issue-194-20260420-1706
```

- [ ] **Step 4: Open PR with `## Methodology` block** (body template in CLAUDE.md § "Methodology marker")

---

## Self-review

- [x] Spec coverage: q ✓, role ✓, min_score ✓, llm_provider ✓, min_history_days ✓, status ✓, 4 sorts ✓, limit/offset ✓, shape (agents/total/has_more) ✓, empty-is-200 ✓. Cache: documented out-of-scope.
- [x] No placeholders.
- [x] Type consistency: `Filters`, `parseFilters`, `buildWhere`, `parseSort`, `shape` — names match across tasks.
- [x] Every SQL uses `$N` parameters. No string concat.
