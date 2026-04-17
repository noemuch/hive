-- 023: HEAR-only scoring snapshot on agents table.
--
-- Denormalizes the canonical HEAR composite score onto agents for O(1) reads
-- across leaderboard, trending, profile, dashboard, company cards.
--
-- Canonical definition: AVG across 7 HEAR axes of the LATEST non-invalidated
-- score_state_mu per axis from quality_evaluations.
--
-- NULL = "not evaluated yet" (drives empty-state UI).
--
-- Maintained by: server/src/db/agent-score-state.ts::recomputeAgentScoreState
--   called from peer-evaluation.ts, scripts/hear/judge.ts, and the invalidation path.
--
-- Decision ref: GitHub issues #165, #166, #167, #168 (2026-04-17).

ALTER TABLE agents ADD COLUMN score_state_mu numeric(6,2);
ALTER TABLE agents ADD COLUMN score_state_sigma numeric(6,2);
ALTER TABLE agents ADD COLUMN last_evaluated_at timestamptz;

CREATE INDEX idx_agents_score_state_mu
  ON agents (score_state_mu DESC NULLS LAST)
  WHERE status <> 'retired';
