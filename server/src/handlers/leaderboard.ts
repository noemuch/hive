import type { Pool } from "pg";
import { json } from "../http/response";
import { marketplaceCache, cacheKeyFromUrl } from "../cache/lru";
import { VALID_ROLES } from "../constants";
import { HEAR_AXES, MIN_AXES_FOR_COMPOSITE } from "./hear-axes";
import type { Route } from "../router/route-types";

const TTL_LEADERBOARD_PERF_MS = 30_000;
const TTL_LEADERBOARD_QUALITY_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Performance leaderboard (canonical HEAR composite ranking).
 * Returns an empty agents array for an invalid company_id filter rather than 400,
 * so UIs that pass a stale id degrade gracefully.
 */
export async function handleLeaderboardPerformance(
  url: URL,
  pool: Pool,
): Promise<Response> {
  const companyFilter = url.searchParams.get("company_id");
  if (companyFilter && !UUID_RE.test(companyFilter)) return json({ agents: [] });

  const data = await marketplaceCache.wrap(cacheKeyFromUrl(url), async () => {
    const whereClause = companyFilter
      ? `WHERE a.status != 'retired' AND a.company_id = $1`
      : `WHERE a.status != 'retired'`;
    const params = companyFilter ? [companyFilter] : [];

    // LEFT JOIN `agent_inherited_mu` (migration 038, #241 A13) so forked
    // agents rank by their decaying effective μ. Non-forked agents get
    // NULL from the view and fall back to own score_state_mu.
    const { rows } = await pool.query(
      `SELECT
         a.id, a.name, a.role, a.avatar_seed,
         a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
         a.llm_provider,
         aim.effective_mu,
         c.id as company_id, c.name as company_name
       FROM agents a
       LEFT JOIN companies c ON a.company_id = c.id
       LEFT JOIN agent_inherited_mu aim ON aim.agent_id = a.id
       ${whereClause}
       ORDER BY COALESCE(aim.effective_mu, a.score_state_mu) DESC NULLS LAST, a.created_at ASC
       LIMIT 50`,
      params,
    );

    const agentIds = rows.map((r) => r.id);
    const trendMap = new Map<string, number>();
    if (agentIds.length > 0) {
      const { rows: trends } = await pool.query(
        `WITH latest_old_per_axis AS (
           SELECT DISTINCT ON (agent_id, axis)
             agent_id, axis, score_state_mu
           FROM quality_evaluations
           WHERE agent_id = ANY($1)
             AND computed_at < now() - INTERVAL '24 hours'
             AND invalidated_at IS NULL
             AND score_state_mu IS NOT NULL
           ORDER BY agent_id, axis, computed_at DESC
         )
         SELECT agent_id, AVG(score_state_mu)::float as old_score
         FROM latest_old_per_axis
         GROUP BY agent_id`,
        [agentIds],
      );
      for (const t of trends) trendMap.set(t.agent_id, t.old_score);
    }

    const statsMap = new Map<
      string,
      { messages_today: number; artifacts_count: number; reactions_received: number }
    >();
    if (agentIds.length > 0) {
      const { rows: stats } = await pool.query(
        `SELECT
           a.id as agent_id,
           COALESCE(msg.cnt, 0)::int as messages_today,
           COALESCE(art.cnt, 0)::int as artifacts_count,
           COALESCE(rx.cnt, 0)::int as reactions_received
         FROM unnest($1::uuid[]) AS a(id)
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int as cnt FROM messages
           WHERE author_id = a.id AND created_at > now() - INTERVAL '24 hours'
         ) msg ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int as cnt FROM artifacts WHERE author_id = a.id
         ) art ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int as cnt FROM reactions r
           JOIN messages m ON r.message_id = m.id AND r.message_created_at = m.created_at
           WHERE m.author_id = a.id
         ) rx ON true`,
        [agentIds],
      );
      for (const s of stats) {
        statsMap.set(s.agent_id, {
          messages_today: s.messages_today,
          artifacts_count: s.artifacts_count,
          reactions_received: s.reactions_received,
        });
      }
    }

    const agents = rows.map((row, i) => {
      const currentScore = row.score_state_mu === null ? null : Number(row.score_state_mu);
      const effectiveMu = row.effective_mu === null || row.effective_mu === undefined
        ? null
        : Number(row.effective_mu);
      const oldScore = trendMap.get(row.id) ?? null;
      let trend: "up" | "down" | "stable" = "stable";
      if (currentScore !== null && oldScore !== null) {
        const diff = currentScore - oldScore;
        trend = diff >= 0.3 ? "up" : diff <= -0.3 ? "down" : "stable";
      }
      const activity =
        statsMap.get(row.id) ?? { messages_today: 0, artifacts_count: 0, reactions_received: 0 };
      return {
        rank: i + 1,
        id: row.id,
        name: row.name,
        role: row.role,
        avatar_seed: row.avatar_seed,
        company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
        score_state_mu: currentScore,
        effective_mu: effectiveMu,
        score_state_sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
        last_evaluated_at: row.last_evaluated_at,
        llm_provider: row.llm_provider ?? null,
        trend,
        messages_today: activity.messages_today,
        artifacts_count: activity.artifacts_count,
        reactions_received: activity.reactions_received,
      };
    });

    return { agents };
  }, TTL_LEADERBOARD_PERF_MS);
  return json(data);
}

// Accepted rubric variants for ?rubric_variant= filter. Mirrors the seed set
// in server/migrations/039_hear_family.sql. Kept in sync with the table via
// tests — not loaded at runtime (a single Postgres round-trip would replace
// this constant but add latency to every /api/leaderboard hit).
const VALID_RUBRIC_VARIANTS = [
  "chat-collab",
  "code",
  "research",
  "creative",
  "rag",
  "computer-use",
] as const;

export async function handleLeaderboardQuality(url: URL, pool: Pool): Promise<Response> {
  const axisParam = url.searchParams.get("axis");
  const roleParam = url.searchParams.get("role");
  const variantParam = url.searchParams.get("rubric_variant");
  if (axisParam && !HEAR_AXES.includes(axisParam as typeof HEAR_AXES[number])) {
    return json({ error: "invalid axis" }, 400);
  }
  if (roleParam && !VALID_ROLES.includes(roleParam as typeof VALID_ROLES[number])) {
    return json({ error: "invalid role" }, 400);
  }
  if (variantParam && !VALID_RUBRIC_VARIANTS.includes(variantParam as typeof VALID_RUBRIC_VARIANTS[number])) {
    return json({ error: "invalid rubric_variant" }, 400);
  }
  try {
    const data = await marketplaceCache.wrap(cacheKeyFromUrl(url), async () => {
      const params: unknown[] = [];
      const whereParts = [`a.status != 'retired'`];
      if (roleParam) {
        params.push(roleParam);
        whereParts.push(`a.role = $${params.length}`);
      }
      let axisClause = "";
      if (axisParam) {
        params.push(axisParam);
        axisClause = `AND qe.axis = $${params.length}`;
      }
      let variantClause = "";
      if (variantParam) {
        params.push(variantParam);
        variantClause = `AND qe.rubric_variant = $${params.length}`;
        whereParts.push(`a.rubric_variant = $${params.length}`);
      }
      const minAxes = axisParam ? 1 : MIN_AXES_FOR_COMPOSITE;
      const { rows } = await pool.query(
        `WITH latest AS (
           SELECT DISTINCT ON (qe.agent_id, qe.axis)
             qe.agent_id, qe.axis, qe.score, qe.score_state_sigma
           FROM quality_evaluations qe
           WHERE qe.invalidated_at IS NULL ${axisClause} ${variantClause}
           ORDER BY qe.agent_id, qe.axis, qe.computed_at DESC
         ),
         composite AS (
           SELECT agent_id,
                  AVG(score)::float as score,
                  AVG(score_state_sigma)::float as sigma,
                  COUNT(*)::int as graded_axes
           FROM latest
           GROUP BY agent_id
           HAVING COUNT(*) >= ${minAxes}
         )
         SELECT
           a.id, a.name, a.role, a.avatar_seed,
           c.id as company_id, c.name as company_name,
           comp.score, comp.sigma
         FROM agents a
         LEFT JOIN companies c ON a.company_id = c.id
         JOIN composite comp ON comp.agent_id = a.id
         WHERE ${whereParts.join(" AND ")}
         ORDER BY comp.score DESC NULLS LAST
         LIMIT 50`,
        params,
      );
      const agents = rows.map((row, i) => ({
        rank: i + 1,
        id: row.id,
        name: row.name,
        role: row.role,
        avatar_seed: row.avatar_seed,
        company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
        score_state_mu: row.score === null ? null : Number(row.score),
        sigma: row.sigma === null ? null : Number(row.sigma),
        trend: "stable" as const,
      }));
      return { agents, dimension: "quality" as const };
    }, TTL_LEADERBOARD_QUALITY_MS);
    return json(data);
  } catch (err) {
    console.error("[hear] /api/leaderboard?dimension=quality error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/leaderboard",
    handler: (ctx) => handleLeaderboardQuality(ctx.url, ctx.pool),
    predicate: (ctx) => ctx.url.searchParams.get("dimension") === "quality",
  },
  {
    method: "GET",
    path: "/api/leaderboard",
    handler: (ctx) => handleLeaderboardPerformance(ctx.url, ctx.pool),
  },
];
