-- 030: Marketplace performance indexes.
--
-- Parent epic: #180 (Hive marketplace Phase 2)
-- Issue: #193
-- Spec: docs/superpowers/specs/2026-04-19-hive-marketplace-design.md § 4.1
--
-- The /api/agents/marketplace endpoint filters and sorts a potentially
-- large (1000+) agent population by combinations of role, score_state_mu,
-- llm_provider, status, and join history. Without proper composite
-- indexes these searches scan the whole agents table and blow the p95
-- budget (200ms) once the population grows past a few hundred rows.
--
-- All 3 indexes are partial on status <> 'retired' (matches existing
-- index idx_agents_score_state_mu from migration 023 and the 16 server
-- queries that already filter retired agents out) and use
-- CREATE INDEX IF NOT EXISTS for idempotency.
--
-- Note on history sort: the spec also proposes agents_history_idx on
-- COALESCE(backdated_joined_at, created_at). This is already covered by
-- idx_agents_effective_joined_at from migration 028 (same expression,
-- DESC sort — a btree can be scanned either direction, so no second
-- index needed).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Primary marketplace filter: role + score
-- ───────────────────────────────────────────────────────────────────────────
-- Serves queries of the form:
--   SELECT ... FROM agents
--   WHERE status <> 'retired' AND role = $1
--   ORDER BY score_state_mu DESC NULLS LAST
--   LIMIT 24;
-- The partial WHERE lets PostgreSQL skip retired rows entirely; the
-- composite column order puts role first because equality filters must
-- precede range/sort columns in a btree for the planner to use both.
CREATE INDEX IF NOT EXISTS idx_agents_marketplace
  ON agents (role, score_state_mu DESC NULLS LAST)
  WHERE status <> 'retired';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. LLM-provider-scoped leaderboard
-- ───────────────────────────────────────────────────────────────────────────
-- Serves queries of the form:
--   SELECT ... FROM agents
--   WHERE status <> 'retired' AND llm_provider = $1
--   ORDER BY score_state_mu DESC NULLS LAST
--   LIMIT 24;
-- Supersedes the single-column idx_agents_llm_provider (migration 027)
-- for sorted queries. The older index stays for pure filter use-cases
-- (e.g. "how many Mistral agents?"). Partial predicate also excludes
-- llm_provider IS NULL rows — agents registered before migration 027.
CREATE INDEX IF NOT EXISTS idx_agents_llm_provider_score
  ON agents (llm_provider, score_state_mu DESC NULLS LAST)
  WHERE status <> 'retired' AND llm_provider IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Builder dashboard / profile: builder + status
-- ───────────────────────────────────────────────────────────────────────────
-- Serves queries of the form:
--   SELECT ... FROM agents WHERE builder_id = $1 AND status != 'retired';
--   SELECT COUNT(*) FROM agents WHERE builder_id = $1 AND status != 'retired';
-- Appears 4+ times in server/src/index.ts (dashboard, quota check, profile).
-- The base idx_agents_builder (migration 001) is single-column so every
-- matching row has to be re-checked against status; composite is strictly
-- better for this access pattern.
CREATE INDEX IF NOT EXISTS idx_agents_builder_status
  ON agents (builder_id, status);

-- ───────────────────────────────────────────────────────────────────────────
-- Comments for discoverability
-- ───────────────────────────────────────────────────────────────────────────
COMMENT ON INDEX idx_agents_marketplace IS
  'Marketplace filter+sort: role equality + score_state_mu DESC, partial on non-retired. Issue #193.';
COMMENT ON INDEX idx_agents_llm_provider_score IS
  'Marketplace filter+sort: llm_provider equality + score_state_mu DESC, partial on non-retired + non-null provider. Issue #193.';
COMMENT ON INDEX idx_agents_builder_status IS
  'Builder dashboard composite: builder_id + status. Issue #193.';
