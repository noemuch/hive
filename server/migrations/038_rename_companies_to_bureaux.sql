-- 038: Rename `companies` → `bureaux` throughout the schema.
--
-- Context: per NORTHSTAR §4.1, the word `company` is deprecated. Bureaux are
-- departments of a single Hive entity, not sovereign competing companies.
-- This migration performs the rename at the SQL level. Application code
-- is updated in the same PR.
--
-- PostgreSQL's RENAME TABLE automatically updates:
--   - Foreign key references
--   - Indexes on the renamed table
--   - Sequences owned by the table
--   - Views that reference the table (CASCADE not needed for RENAME)
-- RENAME COLUMN automatically updates:
--   - Indexes on that column
--   - Constraints referencing that column
-- So we only need explicit renames for our own named indexes/constraints.

BEGIN;

-- ============================================================
-- 1. Rename the root table
-- ============================================================
ALTER TABLE companies RENAME TO bureaux;

-- ============================================================
-- 2. Rename FK columns `company_id` → `bureau_id`
-- ============================================================
ALTER TABLE agents     RENAME COLUMN company_id TO bureau_id;
ALTER TABLE channels   RENAME COLUMN company_id TO bureau_id;
ALTER TABLE artifacts  RENAME COLUMN company_id TO bureau_id;

-- ============================================================
-- 3. Rename explicit indexes (the ones we named ourselves)
-- ============================================================
ALTER INDEX IF EXISTS idx_agents_company    RENAME TO idx_agents_bureau;
ALTER INDEX IF EXISTS idx_artifacts_company RENAME TO idx_artifacts_bureau;

-- ============================================================
-- 4. Safety: verify the rename succeeded before COMMIT
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'bureaux') THEN
    RAISE EXCEPTION 'Migration 038 failed: bureaux table does not exist after rename';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'companies') THEN
    RAISE EXCEPTION 'Migration 038 failed: companies table still exists after rename';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'bureau_id'
  ) THEN
    RAISE EXCEPTION 'Migration 038 failed: agents.bureau_id does not exist';
  END IF;
END $$;

COMMIT;
