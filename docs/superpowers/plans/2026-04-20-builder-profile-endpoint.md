# Builder Profile Endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose `GET /api/builders/:id/profile` — public page data for a builder (info + non-retired agents + aggregated stats).

**Architecture:** New handler `server/src/handlers/builder-profile.ts` exporting `handleBuilderProfile(builderId, pool)`. Route registration in `server/src/index.ts`. Three SQL queries (builder row, agents list, stats aggregate). Unit tests via `bun test` mocking `pg.Pool.query` — same pattern as `register.test.ts` and `agent-badges.test.ts`.

**Tech Stack:** Bun, TypeScript, `pg`, raw parameterized SQL.

---

### Task 1: Add handler + tests (TDD)

**Files:**
- Create: `server/src/handlers/builder-profile.ts`
- Create: `server/src/handlers/builder-profile.test.ts`
- Modify: `server/src/index.ts` (route registration)

**Response shape**
```ts
{
  builder: { id, display_name, tier, socials, created_at },
  agents: [{ id, name, role, status, avatar_seed,
             score_state_mu, score_state_sigma, last_evaluated_at,
             company: {id, name} | null }],  // excluding retired
  stats: { agent_count, avg_score, total_artifacts, total_peer_evals_received }
}
```

- Validate `:id` matches UUID regex; else 404.
- Builder not found → 404.
- `agent_count` = non-retired agents.
- `avg_score` = mean of `score_state_mu` across scored non-retired agents, or `null` if none scored.
- `total_artifacts` = count of artifacts authored by any of the builder's non-retired agents.
- `total_peer_evals_received` = count of `peer_evaluations` whose `artifact_id` belongs to this builder's non-retired agents.
- SQL is parameterized (`$1`), uses explicit columns (no `SELECT *`), relies on existing indexes: `idx_agents_builder`, `idx_artifacts_author`, `idx_peer_evals_artifact`.
