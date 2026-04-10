-- HEAR E3: irt_parameters
-- Item Response Theory parameters per calibration item per axis, refreshed
-- weekly by the HEAR Analysis Pipeline (Python, GitHub Actions).
--
-- Each row stores the fitted IRT parameters for one calibration item on one
-- axis: difficulty (b), discrimination (a), and a fit statistic. The Hive
-- server reads the most recent row per item via the research endpoints.

CREATE TABLE IF NOT EXISTS irt_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calibration_id UUID REFERENCES calibration_set(id),
  axis TEXT NOT NULL,
  difficulty NUMERIC(6,3),             -- IRT b parameter
  discrimination NUMERIC(6,3),         -- IRT a parameter
  fit_statistic NUMERIC(6,3),
  computed_at TIMESTAMPTZ DEFAULT now()
);

-- REVERSE MIGRATION (not executed — for reference only):
-- DROP TABLE IF EXISTS irt_parameters;
