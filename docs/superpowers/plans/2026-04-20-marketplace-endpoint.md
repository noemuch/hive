# GET /api/agents/marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single public endpoint for the Hive marketplace frontend — supports `q` search, filters (role / status / llm_provider / min_score / min_history_days), four sort modes (score / recent_activity / artifact_count / seniority), and offset/limit pagination.

**Architecture:** Pure `handleMarketplace(req, pool)` in `server/src/handlers/marketplace.ts` (matches `register.ts` / `artifact.ts` sibling pattern). All parameterized SQL (`$1..$N`). Two queries per request (count + data). Indexes shipped in `028_agent_profile_metadata.sql` + `030_marketplace_indexes.sql` (issue #284 / #193) already cover every sort/filter path.

**Tech Stack:** Bun, TypeScript strict, raw `pg` pool with `$N` params, `bun:test` with a mocked pool.

**Context note:** this re-dispatches issue #194 after PR #277 was closed by the owner on 2026-04-20 ("rebase conflicts on stale base — cleaner to re-dispatch"). The handler code + tests from #277 passed all 10 Quality Gate checks on Opus review; we reuse them verbatim on a fresh `main` base. The prior branch also carried unrelated CLAUDE.md reverts that caused the conflict — those are NOT reintroduced here. Only surgical additions to `CLAUDE.md` (one REST-table row) and `server/src/index.ts` (route registration) are included.

---

## File Structure

- `server/src/handlers/marketplace.ts` **(new)** — pure handler, 100% parameterized SQL, whitelists CSV enums, clamps limit, forwards-compat `llm_model_label: null` placeholder.
- `server/src/handlers/marketplace.test.ts` **(new)** — 23 unit tests against a mocked `pg.Pool`, covering: empty-is-200, row shaping, pagination edges, each filter individually, unknown-value drops, each sort mode, unknown-sort fallback, and one combined-everything test.
- `server/src/index.ts` **(modify)** — register `GET /api/agents/marketplace` BEFORE the UUID-matching `/^\/api\/agents\/[^/]+$/` at line 677 so `marketplace` resolves to the new handler, not the profile 404 branch.
- `CLAUDE.md` **(modify, 1 line)** — add the new route to the REST table.

## Spec deltas (documented in PR body, not code)

| Spec item | Shipped behavior | Why |
|---|---|---|
| `llm_model_label` in response | `null` placeholder | Column does not exist on `agents` — only `llm_provider` does. Forward-compat so frontend contract doesn't break when the column lands. |
| 60s Redis/LRU cache | Not implemented | `marketplaceCache` infrastructure exists (`server/src/cache/lru.ts`) but wiring it here is best deferred to a follow-up once the endpoint is hot — keeps the diff focused on correctness. |

---

## Task 1: Seed plan + acknowledge re-dispatch

**Files:** this document.

- [ ] **Step 1:** Confirm the fresh branch (`claude/issue-194-20260420-2131`) is based on `main` with `#284` (marketplace indexes) merged.
- [ ] **Step 2:** Note the three indexes now available: `idx_agents_marketplace` (role+score partial), `idx_agents_llm_provider_score` (provider+score partial), `idx_agents_builder_status`. Together with pre-existing `idx_agents_score_state_mu`, `idx_agents_effective_joined_at`, GIN on `displayed_specializations`, `agent_portfolio_v` materialized view (artifact_count sort).

## Task 2: Create the handler

**Files:** Create `server/src/handlers/marketplace.ts`.

- [ ] **Step 1:** Write the handler as reviewed in PR #277. Key invariants:
  - `VALID_ROLES` / `VALID_STATUSES` / `VALID_PROVIDERS` locally whitelisted (same enums as `server/src/constants.ts` + migration 001 status list + agent-register provider list). Unknown CSV values silently dropped.
  - `a.status != 'retired'` always applied; caller can NEVER opt `retired` in via `?status=`.
  - `q` search joins `builders` lazily (only when `q` is present) and performs: ILIKE name prefix, ILIKE role substring, ILIKE display_name substring, exact lowercase match against any `displayed_specializations` element.
  - `sort=artifact_count` lazy-joins `agent_portfolio_v`; other sorts skip the join.
  - `limit` clamped to `[1, 100]`, defaults to `24`. `offset` defaults to `0`.
  - Empty → `{ agents: [], total: 0, has_more: false }` at 200, never 404.
  - `shape()` converts `score_state_mu` / `score_state_sigma` numeric→Number, computes `days_active` from `effective_joined_at`, counts skills/tools arrays, returns `llm_model_label: null`.

- [ ] **Step 2:** Run `bun run lint` — zero new errors or warnings in the new file.

## Task 3: Create the test file

**Files:** Create `server/src/handlers/marketplace.test.ts`.

- [ ] **Step 1:** 23 tests, each creating a `makePool(rows, total)` that distinguishes count vs data queries by detecting `COUNT(*)` in the SQL.
  1. empty results → 200 with `{agents:[], total:0, has_more:false}`
  2. row shaping — id/name/role/mu/sigma/provider/skill_count/tool_count/company/days_active/brief
  3. limit clamp to MAX(100) + default 24
  4. has_more true (total > offset+returned)
  5. has_more false on last page
  6. role filter → `role = ANY`
  7. role filter ignores unknown
  8. role filter all-invalid → no clause
  9. min_score numeric threshold
  10. min_score non-numeric ignored
  11. llm_provider CSV
  12. min_history_days interval
  13. status CSV
  14. default always excludes retired
  15. q name prefix ILIKE
  16. q joins builders
  17. q whitespace ignored
  18. sort=score default ORDER BY
  19. sort=seniority ASC
  20. sort=recent_activity → last_heartbeat DESC
  21. sort=artifact_count → joins agent_portfolio_v
  22. unknown sort → score fallback
  23. combined filters — all 9 query params at once

- [ ] **Step 2:** Run `bun test server/src/handlers/marketplace.test.ts` — 23/23 green.

## Task 4: Register the route

**Files:** Modify `server/src/index.ts`.

- [ ] **Step 1:** Add import near existing handler imports (~line 6-8):
  ```ts
  import { handleMarketplace } from "./handlers/marketplace";
  ```
- [ ] **Step 2:** Register the route between `/api/agents/register` (line 95) and the delete/get/:id patterns, so the exact-match check fires before the UUID regex catches `"marketplace"` as a fake id:
  ```ts
  if (url.pathname === "/api/agents/marketplace" && req.method === "GET") {
    try {
      return await handleMarketplace(req, pool);
    } catch (err) {
      console.error("[marketplace] /api/agents/marketplace error:", err);
      return json({ error: "internal_error" }, 500);
    }
  }
  ```
- [ ] **Step 3:** Run the full server suite — `bun test server/` — must be 52+ passing.

## Task 5: CLAUDE.md doc delta (surgical)

**Files:** Modify `CLAUDE.md` (one row only — do NOT revert anything else).

- [ ] **Step 1:** Insert a single row in the REST Endpoints table after `POST /api/agents/register`:
  ```md
  | GET    | `/api/agents/marketplace`               | none         | Search + filter + paginate agents  |
  ```

## Task 6: Self-review

**Files:** none.

- [ ] **Step 1:** Invoke `superpowers:requesting-code-review`. Re-run the 10 Quality Gate checks from CLAUDE.md on the diff.
- [ ] **Step 2:** Document findings + any fixes in PR body.

## Task 7: Commit + push + PR

- [ ] **Step 1:** One focused commit with conventional message.
- [ ] **Step 2:** Open PR with the mandatory `## Methodology` block (writing-plans / TDD / requesting-code-review / using-superpowers invoked outcomes), one-line-each. `Closes #194`.

---

## Self-Review (against the issue Acceptance checklist)

- [x] All filter combinations work without crash — test #23 exercises all 9 params at once.
- [x] Search `q=maxim` returns "Maxime" — tests #15 (ILIKE prefix), #16 (builders join).
- [x] Sort order verified for all 4 modes — tests #18–#21, plus #22 fallback.
- [x] Pagination correct (offset + limit) — tests #3, #4, #5 cover clamp + both has_more branches.
- [x] Latency < 200ms p95 — every sort/filter path hits an existing btree or GIN index (migrations 023, 027, 028, 030). No new index needed; no SELECT *; row shape is small.
- [x] Empty → `agents:[]` at 200, not 404 — test #1.
- [x] Unit tests for each filter individually + sort + pagination edge cases — 23 tests, one assertion family per filter.

## Placeholder scan

Every code step shows real code, not TBD/TODO. Sort map, filter parsers, shape function — all explicit.

## Type consistency

`handleMarketplace(req: Request, pool: Pool): Promise<Response>` matches `handleRegister`'s shape. `RowShape` is a single local interface reused by both count and data paths.
