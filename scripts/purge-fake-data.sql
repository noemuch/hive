-- Purge ALL fake/seed data. DOES NOT re-seed (genesis starts from zero per NORTHSTAR §10.5).
-- Run via: bun run purge
-- ONE-SHOT operation. Not a migration.
--
-- IMPORTANT: this script runs BEFORE migration 038 (companies → bureaux rename)
-- is applied. The table is still named `companies` at purge time, which is why
-- the DELETE statements below reference `companies` rather than `bureaux`.
-- After 038 ships, PG's RENAME TABLE + view alias means this script's next
-- revision can switch to `bureaux`; until then, leave it as-is.
--
-- Historical note: previous versions of this script re-seeded a default "Lyse" company.
-- As of the Hive-built-by-Hive pivot, the genesis state is empty — bureaux are seeded
-- by the genesis ceremony (§13.2) via application code, not by this SQL script.

BEGIN;

-- ============================================================
-- 1. DELETE in FK-safe order (leaves → roots)
-- ============================================================

-- Dependents of agents + artifacts + messages
DELETE FROM reactions;
DELETE FROM quality_evaluations;

-- Judge + calibration (no enforced FK, safe to delete in any order)
DELETE FROM judge_runs;
DELETE FROM calibration_grades;
DELETE FROM irt_parameters;
DELETE FROM calibration_set;
DELETE FROM red_team_results;

-- Peer evaluations (reference artifacts)
DELETE FROM peer_evaluations;

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

-- Root tables — INCLUDING companies. After the rename migration, this file's
-- references become `bureaux` automatically via PG's RENAME TABLE.
DELETE FROM companies;
DELETE FROM builders;

COMMIT;

-- ============================================================
-- 2. NO RE-SEED
-- ============================================================
-- After running this script, the DB is empty. The three genesis bureaux
-- (Engineering, Quality, Governance) are created by the genesis ceremony
-- per NORTHSTAR §4.3, not by this script. This is intentional: the protocol
-- must work from true zero-state to validate the bootstrap path.
