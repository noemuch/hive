import type { Pool } from "pg";
import { json } from "../http/response";
import { LruCache } from "../cache/lru";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

// Aggregator for the /agent/:id page. One HTTP roundtrip returns agent
// identity + declared loadout + HEAR stats + axes breakdown + 30-day score
// evolution + preview of recent artifacts + top peer-eval citations. Spec:
// issue #186 (marketplace evolution § 4.1 + § 7).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// V1: 7 axes (matches HEAR_AXES in server/src/index.ts). persona_coherence
// deferred to V2 (longitudinal grading required).
const HEAR_AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;
// Composite timeline only emits a day when this many axes have data, so
// early sparse coverage doesn't produce noisy jagged lines. Mirrors
// MIN_AXES_FOR_COMPOSITE in /api/agents/:id/quality/timeline.
const MIN_AXES_FOR_COMPOSITE = 5;

const PROFILE_CACHE_MAX = 500;
const PROFILE_CACHE_TTL_MS = 5 * 60_000;
const SCORE_EVOLUTION_DAYS = 30;
const RECENT_ARTIFACTS_LIMIT = 5;
const MAX_CITATIONS = 5;
const MAX_QUOTES_PER_EVAL = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const profileCache = new LruCache<unknown>({
  max: PROFILE_CACHE_MAX,
  ttlMs: PROFILE_CACHE_TTL_MS,
});

export function clearAgentProfileCache(): void {
  profileCache.clear();
}

type AgentRow = {
  id: string;
  name: string;
  role: string;
  personality_brief: string | null;
  avatar_seed: string;
  llm_provider: string | null;
  llm_model_label: string | null;
  displayed_skills: unknown;
  displayed_tools: unknown;
  displayed_specializations: string[] | null;
  displayed_languages: string[] | null;
  displayed_memory_type: string;
  is_artifact_content_public: boolean;
  score_state_mu: string | number | null;
  score_state_sigma: string | number | null;
  last_evaluated_at: string | null;
  status: string;
  created_at: string;
  backdated_joined_at: string | null;
  company_id: string | null;
  company_name: string | null;
  builder_id: string | null;
  builder_name: string | null;
  builder_socials: unknown;
};

type BuilderSocials = {
  github?: string;
  twitter?: string;
  linkedin?: string;
  website?: string;
};

function pickSocials(raw: unknown): BuilderSocials | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: BuilderSocials = {};
  for (const key of ["github", "twitter", "linkedin", "website"] as const) {
    const v = src[key];
    if (typeof v === "string" && v.length > 0) out[key] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
}

type AxisRow = {
  axis: string;
  score_state_mu: string | number | null;
  score_state_sigma: string | number | null;
};

type EvolutionRow = {
  date: string | Date;
  mu: number | string | null;
  sigma: number | string | null;
};

type PortfolioRow = {
  artifact_count: number | string | null;
  peer_evals_received: number | string | null;
  cohort_total: number | string | null;
  cohort_ahead: number | string | null;
};

type ArtifactRow = {
  id: string;
  type: string;
  title: string;
  created_at: string;
  score: number | string | null;
};

type CitationRow = {
  evidence_quotes: unknown;
  evaluator_name: string;
  evaluator_role: string;
  confidence: number | string | null;
};

async function loadProfile(agentId: string, pool: Pool): Promise<Response> {
  // 1. Agent identity + declarative metadata + canonical HEAR snapshot.
  //    `llm_model_label` may not yet be a column in all environments — if
  //    the SELECT omits it, the field resolves to null downstream.
  const { rows: agentRows } = await pool.query<AgentRow>(
    `SELECT a.id, a.name, a.role, a.personality_brief, a.avatar_seed,
            a.llm_provider, NULL::text AS llm_model_label,
            a.displayed_skills, a.displayed_tools,
            a.displayed_specializations, a.displayed_languages,
            a.displayed_memory_type, a.is_artifact_content_public,
            a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
            a.status, a.created_at, a.backdated_joined_at,
            c.id AS company_id, c.name AS company_name,
            b.id AS builder_id, b.display_name AS builder_name,
            b.socials AS builder_socials
     FROM agents a
     LEFT JOIN companies c ON a.company_id = c.id
     LEFT JOIN builders  b ON a.builder_id  = b.id
     WHERE a.id = $1`,
    [agentId]
  );

  if (agentRows.length === 0 || agentRows[0].status === "retired") {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }
  const agent = agentRows[0];
  const scoreMu = agent.score_state_mu === null ? null : Number(agent.score_state_mu);
  const scoreSigma = agent.score_state_sigma === null ? null : Number(agent.score_state_sigma);

  // 2. Latest non-invalidated per-axis score_state_mu.
  const { rows: axisRows } = await pool.query<AxisRow>(
    `SELECT DISTINCT ON (axis) axis, score_state_mu, score_state_sigma
     FROM quality_evaluations
     WHERE agent_id = $1 AND invalidated_at IS NULL AND score_state_mu IS NOT NULL
     ORDER BY axis, computed_at DESC`,
    [agentId]
  );
  const axes_breakdown = axisRows
    .filter((r) => r.score_state_mu !== null)
    .map((r) => ({
      axis: r.axis,
      mu: Number(r.score_state_mu),
      sigma: r.score_state_sigma === null ? null : Number(r.score_state_sigma),
    }));
  const top_axis = axes_breakdown.length === 0
    ? null
    : axes_breakdown.reduce((best, cur) => (cur.mu > best.mu ? cur : best));

  // 3. Score evolution — last 30 days composite, only days with enough coverage.
  const { rows: evoRows } = await pool.query<EvolutionRow>(
    `SELECT date, mu, sigma FROM (
       SELECT DATE(computed_at)             AS date,
              AVG(score_state_mu)::float    AS mu,
              AVG(score_state_sigma)::float AS sigma,
              COUNT(DISTINCT axis)::int     AS distinct_axes
       FROM quality_evaluations
       WHERE agent_id = $1
         AND axis = ANY($2)
         AND computed_at > now() - ($3 || ' days')::interval
         AND invalidated_at IS NULL
         AND score_state_mu IS NOT NULL
       GROUP BY DATE(computed_at)
     ) sub
     WHERE distinct_axes >= $4
     ORDER BY date`,
    [agentId, HEAR_AXES, SCORE_EVOLUTION_DAYS, MIN_AXES_FOR_COMPOSITE]
  );
  const score_evolution = evoRows.map((r) => ({
    date: typeof r.date === "string" ? r.date : (r.date as Date).toISOString().slice(0, 10),
    mu: r.mu === null ? null : Number(r.mu),
    sigma: r.sigma === null ? null : Number(r.sigma),
  }));

  // 4. Portfolio counters (from pre-aggregated MV) + role-cohort rank.
  //    Cohort rank is against agents sharing the same role; tie-break not
  //    needed for the display "#N in cohort" chip (a tie just collapses to
  //    the same displayed rank for all tied agents).
  const { rows: portfolioRows } = await pool.query<PortfolioRow>(
    `SELECT
       (SELECT artifact_count      FROM agent_portfolio_v WHERE agent_id = $1) AS artifact_count,
       (SELECT peer_evals_received FROM agent_portfolio_v WHERE agent_id = $1) AS peer_evals_received,
       (SELECT COUNT(*)::int FROM agents
          WHERE role = $2
            AND status != 'retired'
            AND score_state_mu IS NOT NULL) AS cohort_total,
       (SELECT COUNT(*)::int FROM agents
          WHERE role = $2
            AND status != 'retired'
            AND score_state_mu IS NOT NULL
            AND score_state_mu > $3::numeric) AS cohort_ahead`,
    [agentId, agent.role, scoreMu]
  );
  const portfolio = portfolioRows[0] ?? {
    artifact_count: 0, peer_evals_received: 0, cohort_total: 0, cohort_ahead: 0,
  };
  const cohortTotal = Number(portfolio.cohort_total ?? 0);
  const cohortAhead = Number(portfolio.cohort_ahead ?? 0);
  const cohort_rank = scoreMu === null || cohortTotal === 0
    ? null
    : { rank: cohortAhead + 1, total: cohortTotal, role_label: agent.role };

  // 5. Recent artifacts preview (titles + avg judge score, no content).
  const { rows: artifactRows } = await pool.query<ArtifactRow>(
    `SELECT ar.id, ar.type, ar.title, ar.created_at,
            (SELECT AVG(qe.score_state_mu)::float
               FROM quality_evaluations qe
               WHERE qe.artifact_id = ar.id
                 AND qe.invalidated_at IS NULL
                 AND qe.score_state_mu IS NOT NULL) AS score
     FROM artifacts ar
     WHERE ar.author_id = $1
     ORDER BY ar.created_at DESC
     LIMIT $2`,
    [agentId, RECENT_ARTIFACTS_LIMIT]
  );
  const recent_artifacts_preview = artifactRows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    score: r.score === null ? null : Number(r.score),
    created_at: r.created_at,
  }));

  // 6. Citations — flatten up to 3 quotes per eval, newest first, cap at 5.
  const { rows: citationRows } = await pool.query<CitationRow>(
    `SELECT pe.confidence, pe.evidence_quotes,
            ev.name AS evaluator_name, ev.role AS evaluator_role
     FROM peer_evaluations pe
     JOIN artifacts art ON art.id = pe.artifact_id AND art.author_id = $1
     JOIN agents    ev  ON ev.id  = pe.evaluator_agent_id
     WHERE pe.status = 'completed'
       AND jsonb_array_length(pe.evidence_quotes) > 0
     ORDER BY pe.completed_at DESC NULLS LAST
     LIMIT $2`,
    [agentId, MAX_CITATIONS]
  );
  const citations: Array<{ quote: string; evaluator_name: string; evaluator_role: string; score: number }> = [];
  for (const row of citationRows) {
    if (citations.length >= MAX_CITATIONS) break;
    const quotes: unknown = row.evidence_quotes;
    if (!Array.isArray(quotes)) continue;
    const score = row.confidence === null ? 0 : Number(row.confidence);
    for (const q of quotes.slice(0, MAX_QUOTES_PER_EVAL)) {
      if (citations.length >= MAX_CITATIONS) break;
      if (typeof q !== "string" || q.length === 0) continue;
      citations.push({
        quote: q,
        evaluator_name: row.evaluator_name,
        evaluator_role: row.evaluator_role,
        score,
      });
    }
  }

  const joinedAt = agent.backdated_joined_at ?? agent.created_at;
  const daysActive = Math.max(
    0,
    Math.floor((Date.now() - new Date(joinedAt).getTime()) / MS_PER_DAY)
  );

  return json({
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      brief: agent.personality_brief,
      company: agent.company_id ? { id: agent.company_id, name: agent.company_name } : null,
      builder: agent.builder_id
        ? {
            id: agent.builder_id,
            display_name: agent.builder_name,
            socials: pickSocials(agent.builder_socials),
          }
        : null,
      llm_provider: agent.llm_provider ?? null,
      llm_model_label: agent.llm_model_label ?? null,
      avatar_seed: agent.avatar_seed,
      joined_at: joinedAt,
      displayed_skills: agent.displayed_skills ?? [],
      displayed_tools: agent.displayed_tools ?? [],
      displayed_specializations: agent.displayed_specializations ?? [],
      displayed_languages: agent.displayed_languages ?? [],
      displayed_memory_type: agent.displayed_memory_type,
    },
    stats: {
      score_state_mu: scoreMu,
      score_state_sigma: scoreSigma,
      last_evaluated_at: agent.last_evaluated_at,
      cohort_rank,
      artifact_count: Number(portfolio.artifact_count ?? 0),
      peer_evals_received: Number(portfolio.peer_evals_received ?? 0),
      days_active: daysActive,
      top_axis: top_axis ? { name: top_axis.axis, score: top_axis.mu } : null,
    },
    axes_breakdown,
    score_evolution,
    recent_artifacts_preview,
    citations,
    is_artifact_content_public: agent.is_artifact_content_public,
  });
}

export async function handleAgentProfile(agentId: string, pool: Pool): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  // Cache the resolved JSON body, not the Response — Response is single-use.
  const body = await profileCache.wrap(agentId, async () => {
    const res = await loadProfile(agentId, pool);
    return { status: res.status, body: await res.json() };
  }) as { status: number; body: unknown };

  return json(body.body, body.status);
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/profile",
    handler: logAndWrap(
      (ctx) => handleAgentProfile(ctx.params.id, ctx.pool),
      "profile",
    ),
  },
];
