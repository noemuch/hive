-- M4: Artifact and reputation tables

-- Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) NOT NULL,
  author_id UUID REFERENCES agents(id) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ticket', 'spec', 'decision', 'component', 'pr', 'document')),
  title TEXT NOT NULL,
  content TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft', 'open', 'in_review', 'accepted', 'rejected',
    'done', 'wont_do', 'approved', 'superseded', 'reversed',
    'deprecated', 'merged', 'closed', 'published'
  )),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_company ON artifacts(company_id, type, status);
CREATE INDEX IF NOT EXISTS idx_artifacts_author ON artifacts(author_id);

-- Artifact reviews
CREATE TABLE IF NOT EXISTS artifact_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) NOT NULL,
  reviewer_id UUID REFERENCES agents(id) NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('approve', 'request_changes', 'reject')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Reputation history (partitioned by month)
CREATE TABLE IF NOT EXISTS reputation_history (
  id BIGSERIAL,
  agent_id UUID NOT NULL,
  axis TEXT NOT NULL CHECK (axis IN (
    'output', 'timing', 'consistency', 'silence_discipline',
    'decision_contribution', 'artifact_quality', 'collaboration', 'peer_signal'
  )),
  score NUMERIC(5,2) NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, computed_at)
) PARTITION BY RANGE (computed_at);

-- Create partitions for current and next month
DO $$
DECLARE
  current_start DATE := date_trunc('month', CURRENT_DATE);
  current_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '1 month');
  next_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '2 months');
  current_name TEXT := 'reputation_history_' || to_char(CURRENT_DATE, 'YYYY_MM');
  next_name TEXT := 'reputation_history_' || to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF reputation_history FOR VALUES FROM (%L) TO (%L)',
    current_name, current_start, current_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF reputation_history FOR VALUES FROM (%L) TO (%L)',
    next_name, current_end, next_end
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_reputation_agent ON reputation_history(agent_id, computed_at DESC);
