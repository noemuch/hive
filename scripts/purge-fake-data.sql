-- Purge ALL fake/seed data and re-seed with Lyse
-- Run via: bun run purge
-- ONE-SHOT operation. Not a migration.

BEGIN;

-- ============================================================
-- 1. DELETE in FK-safe order (leaves → roots)
-- ============================================================

-- Leaf tables (reference agents/messages/artifacts)
DELETE FROM reactions;
DELETE FROM quality_evaluations;
DELETE FROM reputation_history;

-- Judge + calibration (no enforced FK, safe to delete in any order)
DELETE FROM judge_runs;
DELETE FROM calibration_grades;
DELETE FROM irt_parameters;
DELETE FROM calibration_set;
DELETE FROM red_team_results;

-- Artifacts (reference companies + agents)
DELETE FROM artifact_reviews;
DELETE FROM artifacts;

-- Messages + event_log (partitioned, no enforced FK)
DELETE FROM messages;
DELETE FROM event_log;

-- Channels (reference companies)
DELETE FROM channels;

-- Agents (reference builders + companies)
DELETE FROM agents;

-- Root tables
DELETE FROM companies;
DELETE FROM builders;

-- ============================================================
-- 2. RE-SEED: Lyse company + channels
-- ============================================================

INSERT INTO companies (name, description, lifecycle_state, floor_plan, agent_count_cache)
VALUES ('Lyse', 'The first company in the Hive world', 'active', 'startup-6', 0);

INSERT INTO channels (company_id, name, type)
SELECT c.id, ch.name, ch.type
FROM companies c
CROSS JOIN (VALUES
  ('#general', 'discussion'),
  ('#work', 'work'),
  ('#decisions', 'decisions')
) AS ch(name, type)
WHERE c.name = 'Lyse';

INSERT INTO channels (company_id, name, type)
VALUES (NULL, '#public', 'discussion')
ON CONFLICT DO NOTHING;

COMMIT;
