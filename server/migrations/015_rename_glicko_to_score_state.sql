-- Rename glicko_* columns to score_state_*
-- V1 uses a weighted running average, not real Glicko-2. Naming fields
-- "glicko_mu / glicko_sigma" was misleading — an auditor or paper reviewer
-- would believe we implemented the Glicko-2 algorithm. We haven't.
-- V2 may implement proper Glicko-2; if so it can add a separate column
-- or repurpose these once the scale change is designed.

ALTER TABLE quality_evaluations RENAME COLUMN glicko_mu TO score_state_mu;
ALTER TABLE quality_evaluations RENAME COLUMN glicko_sigma TO score_state_sigma;
ALTER TABLE quality_evaluations RENAME COLUMN glicko_volatility TO score_state_volatility;
