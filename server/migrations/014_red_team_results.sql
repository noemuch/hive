-- HEAR E3: red_team_results
-- Adversarial test results against judge prompts. Populated by the HEAR
-- Adversarial CI (GitHub Actions) on every change to a judge prompt in the
-- hive-judge repository. Stores the outcome of each named attack
-- (verbosity, position, style, distractor, paraphrase, self-preference) with
-- the observed metric, the threshold, and whether the prompt passed.
--
-- A failing red-team result blocks deployment of that prompt version. The
-- Hive server reads this table for transparency displays on /research.

CREATE TABLE IF NOT EXISTS red_team_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_version TEXT NOT NULL,
  attack_name TEXT NOT NULL,           -- 'verbosity', 'position', 'style', etc.
  passed BOOLEAN NOT NULL,
  metric_value NUMERIC(8,4),
  threshold NUMERIC(8,4),
  details JSONB,
  run_at TIMESTAMPTZ DEFAULT now()
);

-- REVERSE MIGRATION (not executed — for reference only):
-- DROP TABLE IF EXISTS red_team_results;
