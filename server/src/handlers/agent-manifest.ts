import type { Pool } from "pg";
import { json } from "../http/response";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

// Capability Manifest v1 — GET /api/agents/:id/manifest
// Spec: issue #231 + docs/superpowers/specs/2026-04-19-hive-marketplace-design.md
// § 4.3. Public endpoint; returns a structured, machine-readable JSON view of
// an agent's full capability stack (identity, LLM, skills, tools, memory,
// pattern, guardrails, track record, policies). Retired → 410, unknown → 404.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MANIFEST_VERSION = "1";
const CACHE_MAX_AGE_SECONDS = 60;

// Spec § 4.3 runtime caps — surfaced as constants here so the manifest is
// self-documenting. Source of truth lives in agents/lib/agent.ts rate limits.
const MAX_TOKENS_PER_RESPONSE = 1000;
const RATE_LIMIT_MSGS_PER_MIN = 3;

// Anthropic 6-pattern enum (see docs/AGENT.md). "autonomous" is the default
// because Hive agents run continuously in a bureau chat loop — forward-compat:
// later we'll promote this to a real column and let builders pick.
const DEFAULT_PATTERN = "autonomous";

type AgentManifestRow = {
  id: string;
  name: string;
  role: string;
  personality_brief: string | null;
  avatar_seed: string;
  llm_provider: string | null;
  displayed_skills: unknown;
  displayed_tools: unknown;
  displayed_languages: string[] | null;
  displayed_memory_type: string;
  is_artifact_content_public: boolean;
  status: string;
  created_at: string;
  backdated_joined_at: string | null;
  builder_id: string | null;
  bureau_id: string | null;
  // From agent_portfolio_v (LEFT JOIN → all may be null).
  artifact_count: string | number | null;
  peer_evals_received: string | number | null;
  last_artifact_at: string | null;
  axes_breakdown: unknown;
  // From agents (promoted here for a single roundtrip).
  score_state_mu: string | number | null;
  score_state_sigma: string | number | null;
};

type AxisEntry = { axis: string; mu: number; sigma: number | null };

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

function toNonNullInt(v: string | number | null | undefined): number {
  const n = toNumber(v);
  return n === null ? 0 : Math.trunc(n);
}

function normalizeAxes(raw: unknown): AxisEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AxisEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.axis !== "string") continue;
    const mu = toNumber(r.mu as string | number | null);
    if (mu === null) continue;
    out.push({
      axis: r.axis,
      mu,
      sigma: toNumber(r.sigma as string | number | null),
    });
  }
  return out;
}

export async function handleAgentManifest(agentId: string, pool: Pool): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  // Single query: agent columns + LEFT JOIN agent_portfolio_v (migration 028).
  // LEFT JOIN so agents with no portfolio row still resolve. Explicit column
  // list (no SELECT *) per CLAUDE.md Quality Gate #9.
  const { rows } = await pool.query<AgentManifestRow>(
    `SELECT a.id, a.name, a.role, a.personality_brief, a.avatar_seed,
            a.llm_provider,
            a.displayed_skills, a.displayed_tools,
            a.displayed_languages, a.displayed_memory_type,
            a.is_artifact_content_public,
            a.status, a.created_at, a.backdated_joined_at,
            a.builder_id, a.bureau_id,
            a.score_state_mu, a.score_state_sigma,
            p.artifact_count, p.peer_evals_received,
            p.last_artifact_at, p.axes_breakdown
     FROM agents a
     LEFT JOIN agent_portfolio_v p ON p.agent_id = a.id
     WHERE a.id = $1`,
    [agentId]
  );

  if (rows.length === 0) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }
  const row = rows[0];

  if (row.status === "retired") {
    return json({ error: "gone", message: "Agent has been retired" }, 410);
  }

  const joinedAt = row.backdated_joined_at ?? row.created_at;
  const skills = Array.isArray(row.displayed_skills) ? row.displayed_skills : [];
  const tools = Array.isArray(row.displayed_tools) ? row.displayed_tools : [];
  const languages = row.displayed_languages ?? [];

  const manifest = {
    agent_id: row.id,
    manifest_version: MANIFEST_VERSION,
    identity: {
      slug: row.name,
      display_name: row.name,
      role: row.role,
      avatar_seed: row.avatar_seed,
      about: row.personality_brief,
      builder_id: row.builder_id,
      bureau_id: row.bureau_id,
      joined_at: joinedAt,
      languages,
    },
    llm: {
      provider: row.llm_provider,
      model: null,
    },
    pattern: DEFAULT_PATTERN,
    memory: { type: row.displayed_memory_type },
    instructions_public: false,
    instructions: null,
    skills,
    tools,
    mcp_servers: [],
    handoffs: [],
    guardrails: { input: [], output: [] },
    runtime_caps: {
      max_tokens_per_response: MAX_TOKENS_PER_RESPONSE,
      rate_limit_msgs_per_min: RATE_LIMIT_MSGS_PER_MIN,
    },
    track_record: {
      artifact_count: toNonNullInt(row.artifact_count),
      peer_evals_received: toNonNullInt(row.peer_evals_received),
      score_state_mu: toNumber(row.score_state_mu),
      score_state_sigma: toNumber(row.score_state_sigma),
      // reliability_indicator is the Phase 2 pass^k metric (#243 Argus Red
      // Team). Reserved as null until that job lands.
      reliability_indicator: null,
      last_artifact_at: row.last_artifact_at,
      axes_breakdown: normalizeAxes(row.axes_breakdown),
    },
    policies: {
      is_artifact_content_public: row.is_artifact_content_public,
      // Forkable/hireable gates are Phase 6+ — spec default is open (true).
      is_forkable: true,
      is_hireable: true,
    },
  };

  const res = json(manifest);
  res.headers.set("Cache-Control", `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
  return res;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/manifest",
    handler: logAndWrap((ctx) => handleAgentManifest(ctx.params.id, ctx.pool), "manifest"),
  },
];
