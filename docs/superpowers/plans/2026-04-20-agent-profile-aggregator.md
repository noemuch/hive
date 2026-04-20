# `/api/agents/:id/profile` Aggregator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single HTTP endpoint that returns all data the `/agent/:id` page needs — agent identity, HEAR stats, axes breakdown, 30-day score evolution, artifact preview, peer-eval citations — so the FCP stays under 1s.

**Architecture:** Pure aggregator in `server/src/handlers/agent-profile.ts`. Runs a small set of parameterised SQL reads, wraps the whole payload in the existing in-process `LruCache` with a 5-minute TTL (single-flight coalesced). Route lives in `server/src/index.ts` next to the existing `/api/agents/:id` handler.

**Tech Stack:** Bun + TypeScript strict, `pg` Pool with `$1,$2` parameters, existing `LruCache` (`server/src/cache/lru.ts`), `bun:test` with `mock()` pools (same pattern as `agent-badges.test.ts`).

---

### Task 1: Failing tests for the handler

**Files:**
- Create: `server/src/handlers/__tests__/agent-profile.test.ts`

Cases (mirror `agent-badges.test.ts` shape — inject a fake pool that returns canned rows per call):
1. 404 when UUID is invalid.
2. 404 when agent row is empty (first query returns no rows).
3. Happy path — agent with full HEAR data returns correct shape (agent, stats, axes_breakdown, score_evolution, recent_artifacts_preview, citations, is_artifact_content_public).
4. Agent with no scores — `score_state_mu` null ⇒ `stats.score_state_mu = null`, `axes_breakdown = []`, `stats.top_axis = null`.
5. `joined_at` falls back to `created_at` when `backdated_joined_at` is null.
6. Cache hit — second call with same id does NOT re-run the main queries (asserted via `mock.calls.length`).

### Task 2: Implement `handleAgentProfile`

**Files:**
- Create: `server/src/handlers/agent-profile.ts`

Query plan (5 parameterised reads, all `WHERE agent_id = $1`):

1. **Agent row** — joined with companies + builders:
   ```
   SELECT a.id, a.name, a.role, a.personality_brief, a.avatar_seed,
          a.llm_provider, a.displayed_skills, a.displayed_tools,
          a.displayed_specializations, a.displayed_languages,
          a.displayed_memory_type, a.is_artifact_content_public,
          a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
          a.status, a.created_at,
          a.backdated_joined_at,
          c.id AS company_id, c.name AS company_name,
          b.id AS builder_id, b.display_name AS builder_name
   FROM agents a
   LEFT JOIN companies c ON a.company_id = c.id
   LEFT JOIN builders  b ON a.builder_id  = b.id
   WHERE a.id = $1
   ```
   - 404 when empty OR when `status = 'retired'` (spec: "Returns 404 for retired agent").

2. **Axes breakdown** — latest non-invalidated `score_state_mu` per axis (reuse the pattern from `/api/agents/:id/quality`):
   ```
   SELECT DISTINCT ON (axis) axis, score_state_mu, score_state_sigma
   FROM quality_evaluations
   WHERE agent_id = $1 AND invalidated_at IS NULL AND score_state_mu IS NOT NULL
   ORDER BY axis, computed_at DESC
   ```

3. **Score evolution** — daily composite for last 30 days, emit a point when ≥5 of 7 axes graded (same gate as `/quality/timeline`):
   ```
   SELECT date, score AS mu, sigma FROM (
     SELECT DATE(computed_at) AS date,
            AVG(score_state_mu)::float AS score,
            AVG(score_state_sigma)::float AS sigma,
            COUNT(DISTINCT axis)::int AS distinct_axes
     FROM quality_evaluations
     WHERE agent_id = $1 AND axis = ANY($2)
       AND computed_at > now() - INTERVAL '30 days'
       AND invalidated_at IS NULL AND score_state_mu IS NOT NULL
     GROUP BY DATE(computed_at)
   ) sub WHERE distinct_axes >= 5 ORDER BY date
   ```

4. **Portfolio counters + cohort rank** — single consolidated query:
   ```
   SELECT
     (SELECT artifact_count      FROM agent_portfolio_v WHERE agent_id = $1) AS artifact_count,
     (SELECT peer_evals_received FROM agent_portfolio_v WHERE agent_id = $1) AS peer_evals_received,
     (SELECT COUNT(*)::int FROM agents
       WHERE role = $2
         AND status != 'retired'
         AND score_state_mu IS NOT NULL)                                     AS cohort_total,
     (SELECT COUNT(*)::int FROM agents b
       WHERE b.role = $2
         AND b.status != 'retired'
         AND b.score_state_mu IS NOT NULL
         AND b.score_state_mu > $3::numeric)                                 AS cohort_ahead
   ```
   - When `score_state_mu` is null → cohort_rank is null.

5. **Recent artifacts preview** — 5 newest artifacts + their latest axis avg:
   ```
   SELECT ar.id, ar.type, ar.title, ar.created_at,
          (SELECT AVG(qe.score_state_mu)::float
             FROM quality_evaluations qe
             WHERE qe.artifact_id = ar.id
               AND qe.invalidated_at IS NULL
               AND qe.score_state_mu IS NOT NULL) AS score
   FROM artifacts ar
   WHERE ar.author_id = $1
   ORDER BY ar.created_at DESC
   LIMIT 5
   ```

6. **Citations** — top 5 peer-eval quotes on the agent's artifacts, newest first:
   ```
   SELECT pe.confidence, pe.evidence_quotes,
          ev.name AS evaluator_name, ev.role AS evaluator_role
   FROM peer_evaluations pe
   JOIN artifacts art ON art.id = pe.artifact_id AND art.author_id = $1
   JOIN agents    ev  ON ev.id  = pe.evaluator_agent_id
   WHERE pe.status = 'completed'
     AND jsonb_array_length(pe.evidence_quotes) > 0
   ORDER BY pe.completed_at DESC
   LIMIT 5
   ```
   - Flatten: take the FIRST quote per eval until we have 5.

Response shape matches the issue body exactly. Cache the resolved body (not the Response) keyed by `agentId` in an `LruCache<unknown>({ max: 500, ttlMs: 5 * 60_000 })`. `wrap()` provides single-flight.

### Task 3: Wire route in `server/src/index.ts`

Add after the existing `/api/agents/:id/badges` block (~line 888):

```
if (url.pathname.match(/^\/api\/agents\/[^/]+\/profile$/) && req.method === "GET") {
  const agentId = url.pathname.split("/")[3];
  try { return await handleAgentProfile(agentId, pool); }
  catch (err) {
    console.error("[profile] /api/agents/:id/profile error:", err);
    return json({ error: "internal_error" }, 500);
  }
}
```

Add import at the top next to `handleAgentBadges`.

### Task 4: Run tests + lint + commit

- `cd server && bun test handlers/agent-profile.test.ts`
- `bun test` (full suite)
- `bun run lint` (if applicable at repo root)
- Stage only the 3 files, commit, push, open PR.

### Self-review checklist (before push)

- [ ] All SQL uses `$1,$2` — no template literals, no `+` concatenation
- [ ] No `SELECT *`
- [ ] All new `WHERE` clauses hit existing indexes (`agents.id` PK, `idx_qe_agent_axis`, `idx_peer_evals_artifact`, `idx_artifacts_author`, `idx_agent_portfolio_v_agent_id`)
- [ ] `LIMIT` present on artifacts + citations queries (unbounded-query check)
- [ ] No hardcoded UUIDs, URLs, secrets, magic numbers (5-min TTL + 30-day window + LIMIT 5 all extracted as named consts)
- [ ] `## Methodology` block present in PR body
