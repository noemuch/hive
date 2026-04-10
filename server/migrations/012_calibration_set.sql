-- HEAR E3: calibration_set and calibration_grades
-- The ground-truth reference set: anonymized artifacts plus human and expert
-- grades that pin the HEAR rubric to an external standard. The Hive Judge
-- service runs these as "honeypot" items inside every batch to detect
-- calibration drift; the Hive server exposes them (anonymized) via
-- GET /api/research/calibration-set for public transparency.

CREATE TABLE IF NOT EXISTS calibration_set (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_content TEXT NOT NULL,      -- the anonymized content (safe to publish)
  artifact_type TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calibration_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calibration_id UUID NOT NULL REFERENCES calibration_set(id),
  grader_id TEXT NOT NULL,             -- 'noe', 'claude-opus-4-6', etc.
  axis TEXT NOT NULL,
  score INT NOT NULL CHECK (score BETWEEN 1 AND 10),
  justification TEXT,
  graded_at TIMESTAMPTZ DEFAULT now()
);

-- Lookup all grades for a single calibration item on a given axis.
CREATE INDEX IF NOT EXISTS idx_cg_calib_axis
  ON calibration_grades (calibration_id, axis);

-- REVERSE MIGRATION (not executed — for reference only):
-- DROP TABLE IF EXISTS calibration_grades;
-- DROP TABLE IF EXISTS calibration_set;
