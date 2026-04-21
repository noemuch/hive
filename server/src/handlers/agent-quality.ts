import type { Pool } from "pg";
import { json } from "../http/response";
import { HEAR_AXES, MIN_AXES_FOR_COMPOSITE } from "./hear-axes";
import type { Route } from "../router/route-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleAgentQuality(agentId: string, pool: Pool): Promise<Response> {
  if (!UUID_RE.test(agentId)) return json({ error: "agent not found" }, 404);
  try {
    const { rows: snapshotRows } = await pool.query<{
      score_state_mu: string | null;
      score_state_sigma: string | null;
      last_evaluated_at: string | null;
    }>(
      `SELECT score_state_mu, score_state_sigma, last_evaluated_at
       FROM agents WHERE id = $1`,
      [agentId],
    );
    if (snapshotRows.length === 0) return json({ error: "agent not found" }, 404);
    const snap = snapshotRows[0];

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (axis) axis, score, score_state_mu, score_state_sigma, computed_at
       FROM quality_evaluations
       WHERE agent_id = $1 AND invalidated_at IS NULL
       ORDER BY axis, computed_at DESC`,
      [agentId],
    );
    const axes: Record<string, { score: number; sigma: number | null; last_updated: string } | null> = {};
    for (const a of HEAR_AXES) axes[a] = null;
    let gradedAxes = 0;
    for (const row of rows) {
      if (!HEAR_AXES.includes(row.axis)) continue;
      axes[row.axis] = {
        score: row.score_state_mu === null ? Number(row.score) : Number(row.score_state_mu),
        sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
        last_updated: row.computed_at,
      };
      gradedAxes += 1;
    }

    const composite = snap.score_state_mu === null ? null : Number(snap.score_state_mu);
    return json({
      axes,
      composite,
      score_state_mu: composite,
      score_state_sigma: snap.score_state_sigma === null ? null : Number(snap.score_state_sigma),
      last_evaluated_at: snap.last_evaluated_at,
      graded_axes: gradedAxes,
    });
  } catch (err) {
    console.error("[hear] /api/agents/:id/quality error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export async function handleAgentQualityExplanations(
  agentId: string,
  url: URL,
  pool: Pool,
): Promise<Response> {
  if (!UUID_RE.test(agentId)) return json({ error: "agent not found" }, 404);
  const axisParam = url.searchParams.get("axis");
  if (axisParam && !HEAR_AXES.includes(axisParam as typeof HEAR_AXES[number])) {
    return json({ error: "invalid axis" }, 400);
  }
  const rawLimit = parseInt(url.searchParams.get("limit") || "10", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 10 : rawLimit, 1), 50);
  try {
    const params: unknown[] = [agentId];
    let where = `agent_id = $1 AND invalidated_at IS NULL`;
    if (axisParam) {
      params.push(axisParam);
      where += ` AND axis = $2`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT axis, score, reasoning, evidence_quotes, computed_at
       FROM quality_evaluations
       WHERE ${where}
       ORDER BY computed_at DESC
       LIMIT $${params.length}`,
      params,
    );
    const explanations = rows.map((r) => ({
      axis: r.axis,
      score: Number(r.score),
      reasoning: r.reasoning,
      evidence_quotes: r.evidence_quotes,
      computed_at: r.computed_at,
    }));
    return json({ explanations });
  } catch (err) {
    console.error("[hear] /api/agents/:id/quality/explanations error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export async function handleAgentQualityTimeline(
  agentId: string,
  url: URL,
  pool: Pool,
): Promise<Response> {
  if (!UUID_RE.test(agentId)) return json({ error: "agent not found" }, 404);
  const axisParam = url.searchParams.get("axis");
  if (axisParam && !HEAR_AXES.includes(axisParam as typeof HEAR_AXES[number])) {
    return json({ error: "invalid axis" }, 400);
  }
  const rawDays = parseInt(url.searchParams.get("days") || "30", 10);
  const days = Math.min(Math.max(isNaN(rawDays) ? 30 : rawDays, 1), 90);
  try {
    let rows;
    if (axisParam) {
      const result = await pool.query(
        `SELECT DATE(computed_at) as date,
                AVG(score_state_mu)::float as score,
                AVG(score_state_sigma)::float as sigma
         FROM quality_evaluations
         WHERE agent_id = $1 AND axis = $2
           AND computed_at > now() - ($3 || ' days')::interval
           AND invalidated_at IS NULL
           AND score_state_mu IS NOT NULL
         GROUP BY DATE(computed_at)
         ORDER BY date`,
        [agentId, axisParam, days],
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT date, score, sigma FROM (
           SELECT DATE(computed_at) as date,
                  AVG(score_state_mu)::float as score,
                  AVG(score_state_sigma)::float as sigma,
                  COUNT(DISTINCT axis)::int as distinct_axes
           FROM quality_evaluations
           WHERE agent_id = $1
             AND computed_at > now() - ($2 || ' days')::interval
             AND axis = ANY($3)
             AND invalidated_at IS NULL
             AND score_state_mu IS NOT NULL
           GROUP BY DATE(computed_at)
         ) sub
         WHERE distinct_axes >= $4
         ORDER BY date`,
        [agentId, days, HEAR_AXES, MIN_AXES_FOR_COMPOSITE],
      );
      rows = result.rows;
    }
    const timeline = rows.map((r) => ({
      date: r.date,
      score: r.score === null ? null : Number(r.score),
      sigma: r.sigma === null ? null : Number(r.sigma),
    }));
    return json({ timeline });
  } catch (err) {
    console.error("[hear] /api/agents/:id/quality/timeline error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/quality",
    handler: (ctx) => handleAgentQuality(ctx.params.id, ctx.pool),
  },
  {
    method: "GET",
    path: "/api/agents/:id/quality/explanations",
    handler: (ctx) => handleAgentQualityExplanations(ctx.params.id, ctx.url, ctx.pool),
  },
  {
    method: "GET",
    path: "/api/agents/:id/quality/timeline",
    handler: (ctx) => handleAgentQualityTimeline(ctx.params.id, ctx.url, ctx.pool),
  },
];
