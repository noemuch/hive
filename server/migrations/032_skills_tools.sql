-- 032: skills + agent_skills + tools + agent_tools — multi-archetype v3 schema.
--
-- Spec: issue #214 (parent epic #183, § 4.1 Phase 5). v3 extends the original
-- schema with coherence requirements surfaced after #243 (Argus Red Team) and
-- #213 (SKILL.md adoption) were scoped:
--
--   • skills.category / tools.category — Argus filters on
--     category='adversarial_skill' to scope red-team skill loadouts.
--   • skills.version — SKILL.md / AAIF spec carries a semver-like version
--     that #216 (SKILL.md loader) reads to decide cache invalidation.
--   • tools.protocol CHECK — tight enum matching #217 MCP client's
--     dispatch table (unknown protocol = startup failure, not runtime).
--
-- Fully additive + idempotent. Safe on prod, safe to re-run.
--
-- Unblocks: #215 (registry endpoints), #216 (SKILL.md loader), #217 (MCP
-- client), #243 (Argus Red Team).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. skills — declarative SKILL.md-backed capability registry
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skills (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        NOT NULL UNIQUE,
  title               text        NOT NULL,
  description         text,
  category            text,
  version             text,
  source_url          text,
  content_md          text,
  added_by_builder_id uuid        REFERENCES builders(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- "list all adversarial_skill entries" (#243 Argus) / "filter marketplace by
-- category" (#215). Partial-index not needed — category cardinality is low
-- (<20) and every row is queried.
CREATE INDEX IF NOT EXISTS idx_skills_category
  ON skills (category);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. agent_skills — many-to-many join (which skills each agent has loaded)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id    uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id    uuid        NOT NULL REFERENCES skills(id),
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, skill_id)
);

-- Reverse lookup: "which agents have loaded skill X" (#215 marketplace).
-- The composite PK covers (agent_id, skill_id) lookups but NOT skill_id-only.
CREATE INDEX IF NOT EXISTS idx_agent_skills_skill_id
  ON agent_skills (skill_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. tools — external tool registry (MCP servers, HTTP APIs, etc.)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tools (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text        NOT NULL UNIQUE,
  title          text        NOT NULL,
  description    text,
  category       text,
  protocol       text        NOT NULL CHECK (protocol IN ('mcp', 'http', 'websocket', 'native')),
  config_schema  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tools_category
  ON tools (category);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. agent_tools — many-to-many join (which tools each agent can use)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_tools (
  agent_id    uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id     uuid        NOT NULL REFERENCES tools(id),
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_tools_tool_id
  ON agent_tools (tool_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Comments for discoverability
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE skills IS
  'Declarative SKILL.md-backed capability registry. category filters Argus red-team loadouts (#243); version drives SKILL.md loader cache invalidation (#216). Spec: issue #214.';

COMMENT ON TABLE tools IS
  'External tool registry. protocol CHECK matches #217 MCP client dispatch table — unknown protocol = startup failure. Spec: issue #214.';

COMMENT ON COLUMN skills.category IS
  'Taxonomy slug (''adversarial_skill'', ''dev'', ''design'', ''research'', ''creative'', ''ops'', …). Used by #243 Argus Red Team and #215 marketplace filters.';

COMMENT ON COLUMN skills.version IS
  'SKILL.md / AAIF spec version (semver-like). Read by #216 loader to decide cache invalidation.';

COMMENT ON COLUMN tools.protocol IS
  'Tight enum: mcp | http | websocket | native. Tight CHECK surfaces unknown protocols at startup instead of runtime (#217 MCP client).';
