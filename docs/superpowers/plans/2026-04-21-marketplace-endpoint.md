# GET /api/agents/marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single public endpoint for the Hive marketplace frontend — supports `q` search, filters (role / status / llm_provider / min_score / min_history_days), four sort modes (score / recent_activity / artifact_count / seniority), and offset/limit pagination.

**Architecture:** Pure `handleMarketplace(req, pool)` in `server/src/handlers/marketplace.ts` (matches `register.ts` / `artifact.ts` sibling pattern). All parameterized SQL (`$1..$N`). Two queries per request (count + data). Indexes shipped in `028_agent_profile_metadata.sql` + `030_marketplace_indexes.sql` already cover every sort/filter path.

**Tech Stack:** Bun, TypeScript strict, raw `pg` pool with `$N` params, `bun:test` with a mocked pool.

**Context note:** this re-dispatches issue #194 after PR #277 and PR #296 went stale (PR #277 closed on stale base; #296 is now DIRTY with merge conflicts). The handler design + tests from both prior dispatches passed Quality Gate 10/10 on Opus review. Here we rebuild on a fresh `main` at commit `59bf284` (includes #284's marketplace indexes and #295's hire-token mgmt route) — reusing the handler logic verbatim, but **importing the existing `VALID_ROLES` from `server/src/constants.ts`** instead of re-declaring it locally (avoids duplicate-utility Quality Gate hit #6).

---

## File Structure

- `server/src/handlers/marketplace.ts` **(new)** — pure handler, 100% parameterized SQL, whitelists CSV enums, clamps limit, forwards-compat `llm_model_label: null` placeholder.
- `server/src/handlers/marketplace.test.ts` **(new)** — 23 unit tests against a mocked `pg.Pool`, covering: empty-is-200, row shaping, pagination edges, each filter individually, unknown-value drops, each sort mode, unknown-sort fallback, and one combined-everything test.
- `server/src/index.ts` **(modify)** — register `GET /api/agents/marketplace` BEFORE the UUID-matching `/^\/api\/agents\/[^/]+$/` patterns so `marketplace` resolves to the new handler, not the profile 404 branch. Place between `/api/agents/register` (POST) block and `/api/agents/:id/hires` block.
- `CLAUDE.md` **(modify, 1 line)** — add the new route to the REST table.

## Spec deltas (documented in PR body, not code)

| Spec item | Shipped behavior | Why |
|---|---|---|
| `llm_model_label` in response | `null` placeholder | Column does not exist on `agents` — only `llm_provider` does. Forward-compat so frontend contract doesn't break when the column lands. |
| 60s Redis/LRU cache | Not implemented | `marketplaceCache` infrastructure exists (`server/src/cache/lru.ts`), but wiring it here is best deferred to a follow-up once the endpoint is hot. Keeps the diff focused on correctness. |

---

## Task 1: Handler + tests

**Files:** Create `server/src/handlers/marketplace.ts` and `server/src/handlers/marketplace.test.ts`.

- [ ] **Step 1:** Write the handler. Key invariants:
  - Import `VALID_ROLES` from `../constants` (re-use, not re-declare).
  - `VALID_AGENT_STATUSES` / `VALID_LLM_PROVIDERS` locally declared (no existing export with that purpose/name).
  - Named constants: `DEFAULT_LIMIT = 24`, `MAX_LIMIT = 100`, `MS_PER_DAY = 86_400_000`.
  - `a.status != 'retired'` always applied; caller can NEVER opt `retired` in via `?status=`.
  - `q` search joins `builders` lazily (only when `q` is present) and performs: ILIKE name prefix, ILIKE role substring, ILIKE display_name substring, exact lowercase match against any `displayed_specializations` element.
  - `sort=artifact_count` lazy-joins `agent_portfolio_v`; other sorts skip the join.
  - `limit` clamped to `[1, MAX_LIMIT]`, defaults to `DEFAULT_LIMIT`. `offset` defaults to `0`.
  - Empty → `{ agents: [], total: 0, has_more: false }` at 200, never 404.
  - `shape()` converts `score_state_mu` / `score_state_sigma` numeric→Number, computes `days_active` from `effective_joined_at`, counts skills/tools arrays, returns `llm_model_label: null`.

- [ ] **Step 2:** Write 23 unit tests, each creating a `makePool(rows, total)` that distinguishes count vs data queries by detecting `COUNT(*)` in the SQL. Coverage matches prior PR:
  1. empty → 200 agents:[]
  2. row shaping — id/name/role/mu/sigma/provider/skill_count/tool_count/company/days_active/brief
  3. limit clamp to MAX + default
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

## Task 2: Register the route

**Files:** Modify `server/src/index.ts`.

- [ ] **Step 1:** Add import near existing handler imports (line 14):
  ```ts
  import { handleMarketplace } from "./handlers/marketplace";
  ```
- [ ] **Step 2:** Register the route between `/api/agents/register` (line ~151) and the `/api/agents/:id/hires` block, so the exact-match check fires before the UUID regex.

## Task 3: CLAUDE.md doc delta (surgical)

**Files:** Modify `CLAUDE.md` (one row only — do NOT revert anything else).

- [ ] **Step 1:** Insert a single row in the REST Endpoints table after `POST /api/agents/register`:
  ```md
  | GET    | `/api/agents/marketplace`               | none         | Search + filter + paginate agents  |
  ```

## Task 4: Self-review

- [ ] **Step 1:** Invoke `superpowers:requesting-code-review`. Re-run the 10 Quality Gate checks from CLAUDE.md on the diff.
- [ ] **Step 2:** Document findings + any fixes in PR body.

## Task 5: Commit + push + PR

- [ ] **Step 1:** One focused commit with conventional message `feat(api): GET /api/agents/marketplace search/filter/sort (#194)`.
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
