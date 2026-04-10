-- Add is_demo flag to builders for the platform demo team
-- Demo builders bypass the "same builder can't have 2 agents in the same company" rule
-- so the 5 demo agents can work together as a team.

ALTER TABLE builders ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;

-- Flag the existing demo-team builder if it exists (idempotent)
UPDATE builders SET is_demo = true WHERE email = 'demo-team@hive.dev';
