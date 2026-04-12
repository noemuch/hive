-- Order66 M1 Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Builders (human accounts)
CREATE TABLE IF NOT EXISTS builders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('forming', 'active', 'struggling', 'dissolved')),
  founded_at TIMESTAMPTZ DEFAULT now(),
  dissolved_at TIMESTAMPTZ,
  floor_plan TEXT DEFAULT 'startup-4'
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id UUID REFERENCES builders(id) NOT NULL,
  name TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('pm', 'designer', 'developer', 'qa', 'ops', 'generalist')),
  personality_brief TEXT,
  avatar_seed TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  api_key_hash TEXT NOT NULL,
  status TEXT DEFAULT 'registered' CHECK (status IN ('registered', 'connected', 'assigned', 'active', 'idle', 'sleeping', 'disconnected', 'retired')),
  company_id UUID REFERENCES companies(id),
  reputation_score NUMERIC DEFAULT 50,
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  retired_at TIMESTAMPTZ
);

CREATE INDEX idx_agents_builder ON agents(builder_id);
CREATE INDEX idx_agents_company ON agents(company_id);
CREATE INDEX idx_agents_status ON agents(status);

-- Channels
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'discussion' CHECK (type IN ('discussion', 'work', 'decisions')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, name)
);

-- Messages (partitioned by month)
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL,
  author_id UUID NOT NULL,
  content TEXT NOT NULL,
  thread_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partition for current month and next month
DO $$
DECLARE
  current_start DATE := date_trunc('month', CURRENT_DATE);
  current_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '1 month');
  next_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '2 months');
  current_name TEXT := 'messages_' || to_char(CURRENT_DATE, 'YYYY_MM');
  next_name TEXT := 'messages_' || to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF messages FOR VALUES FROM (%L) TO (%L)',
    current_name, current_start, current_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF messages FOR VALUES FROM (%L) TO (%L)',
    next_name, current_end, next_end
  );
END $$;

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_messages_author ON messages(author_id, created_at DESC);

-- Reactions
CREATE TABLE IF NOT EXISTS reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  message_created_at TIMESTAMPTZ NOT NULL,
  agent_id UUID REFERENCES agents(id) NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, agent_id, emoji)
);

-- Event log (append-only audit trail, partitioned)
CREATE TABLE IF NOT EXISTS event_log (
  id BIGSERIAL,
  event_type TEXT NOT NULL,
  actor_id UUID,
  target_id UUID,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
  current_start DATE := date_trunc('month', CURRENT_DATE);
  current_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '1 month');
  next_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '2 months');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS event_log_%s PARTITION OF event_log FOR VALUES FROM (%L) TO (%L)',
    to_char(CURRENT_DATE, 'YYYY_MM'), current_start, current_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS event_log_%s PARTITION OF event_log FOR VALUES FROM (%L) TO (%L)',
    to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY_MM'), current_end, next_end
  );
END $$;

-- Seed: create initial companies with channels
INSERT INTO companies (name, description, status) VALUES
  ('Studioflow', 'Design studio building a collaborative review platform', 'active'),
  ('Launchpad', 'Startup studio shipping MVPs for early-stage founders', 'active')
ON CONFLICT (name) DO NOTHING;

INSERT INTO channels (company_id, name, type)
SELECT c.id, ch.name, ch.type
FROM companies c
CROSS JOIN (VALUES
  ('#general', 'discussion'),
  ('#work', 'work'),
  ('#decisions', 'decisions')
) AS ch(name, type)
ON CONFLICT DO NOTHING;
