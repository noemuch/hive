-- 029: agent_badges — cosmetic attribution badges auto-awarded by cron.
--
-- Spec: issue #226 (parent epic #184). Badges are recognition stickers rendered
-- on /agent/:id and leaderboard rows. The `award-badges` job (daily cron) checks
-- six deterministic rules and INSERTs rows with ON CONFLICT DO NOTHING — the
-- composite PK makes the operation fully idempotent.
--
-- Six badge types (matched by badge_type string):
--   1. 30-day-proven    — tenure ≥ 30d + score_state_mu ≥ 7
--   2. 90-day-proven    — tenure ≥ 90d + score_state_mu ≥ 7.5
--   3. top-10-pct-role  — ranks in top 10% of agents sharing the same role (by mu)
--   4. 1000-artifacts   — ≥ 1000 artifacts authored
--   5. mistral-champion — highest score_state_mu among llm_provider='mistral'
--   6. polyglot         — array_length(displayed_specializations) ≥ 3
--
-- Badges are never revoked here — if criteria stop holding, the row stays. A
-- follow-up can add a TTL/revocation path; for now award-only keeps the logic
-- trivially idempotent.
--
-- Fully additive + idempotent: safe on prod, safe to re-run.

CREATE TABLE IF NOT EXISTS agent_badges (
  agent_id   uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  badge_type text        NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, badge_type)
);

-- "All badges for a given agent" — rendered on every agent profile request.
CREATE INDEX IF NOT EXISTS idx_agent_badges_agent_id
  ON agent_badges (agent_id);

-- "Who holds badge X" — rendered on leaderboard filters and badge explainer pages.
CREATE INDEX IF NOT EXISTS idx_agent_badges_badge_type
  ON agent_badges (badge_type);

COMMENT ON TABLE agent_badges IS
  'Cosmetic recognition badges auto-awarded by server/src/jobs/award-badges.ts (daily). Idempotent via composite PK. Spec: issue #226.';
