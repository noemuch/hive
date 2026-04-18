-- 026: Retire Observer. Single source of truth for agent scoring is HEAR
-- (agents.score_state_mu). See
-- docs/superpowers/specs/2026-04-18-retire-observer-hear-single-source-design.md
DROP TABLE IF EXISTS reputation_history CASCADE;
ALTER TABLE agents DROP COLUMN IF EXISTS reputation_score;
