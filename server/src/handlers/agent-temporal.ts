import type { Pool } from "pg";
import { json } from "../http/response";
import { LruCache } from "../cache/lru";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

// GET /api/agents/:id/temporal
//
// Returns the row of agent_temporal_stats (materialized view from migration
// 042) enriched with the agent's current score_state_mu for UI convenience.
// Spec: issue #236 (A14 — Temporal Credibility Dashboard).
//
// Shape:
//   {
//     agent_id: string,
//     first_score_at: string | null,
//     days_active: number,
//     days_since_first_score: number | null,
//     mu_evolution: Array<{ month: "YYYY-MM", mu, sigma, n_evals }>,
//     stability_score: number | null,
//     stability_sample_days: number,
//     consistency_badge: string | null,
//     current_mu: number | null,
//     current_sigma: number | null,
//   }
//
// Falls back to a zero/null-filled row if the MV doesn't yet have a record
// for the agent — the agent is real (we validate) but hasn't been scored.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEMPORAL_CACHE_MAX = 500;
const TEMPORAL_CACHE_TTL_MS = 5 * 60_000;

const temporalCache = new LruCache<unknown>({
  max: TEMPORAL_CACHE_MAX,
  ttlMs: TEMPORAL_CACHE_TTL_MS,
});

export function clearAgentTemporalCache(): void {
  temporalCache.clear();
}

type TemporalRow = {
  agent_id: string;
  first_score_at: Date | string | null;
  days_active: number | string | null;
  days_since_first_score: number | string | null;
  mu_evolution: unknown;
  stability_score: number | string | null;
  stability_sample_days: number | string | null;
  consistency_badge: string | null;
  current_mu: number | string | null;
  current_sigma: number | string | null;
  agent_exists: boolean | null;
};

type EvolutionPoint = {
  month: string;
  mu: number;
  sigma: number | null;
  n_evals: number;
};

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function coerceInt(v: unknown): number {
  const n = coerceNumber(v);
  return n === null ? 0 : Math.trunc(n);
}

function coerceEvolution(raw: unknown): EvolutionPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: EvolutionPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const month = typeof rec.month === "string" ? rec.month : null;
    const mu = coerceNumber(rec.mu);
    if (!month || mu === null) continue;
    out.push({
      month,
      mu,
      sigma: coerceNumber(rec.sigma),
      n_evals: coerceInt(rec.n_evals),
    });
  }
  return out;
}

function toIsoDate(v: Date | string | null): string | null {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

async function loadTemporal(agentId: string, pool: Pool): Promise<Response> {
  // Single left-join query: `agents` drives existence, the MV carries the
  // aggregates. A missing MV row (`agent_temporal_stats` hasn't been
  // refreshed since the agent registered) still produces a valid response
  // with zero/null fields, just like an agent that never got a score.
  const { rows } = await pool.query<TemporalRow>(
    `SELECT
        a.id                                     AS agent_id,
        a.first_score_at,
        a.score_state_mu                         AS current_mu,
        a.score_state_sigma                      AS current_sigma,
        t.days_active,
        t.days_since_first_score,
        t.mu_evolution,
        t.stability_score,
        t.stability_sample_days,
        t.consistency_badge,
        TRUE                                     AS agent_exists
     FROM agents a
     LEFT JOIN agent_temporal_stats t ON t.agent_id = a.id
     WHERE a.id = $1
       AND a.status <> 'retired'`,
    [agentId],
  );

  if (rows.length === 0) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const r = rows[0];

  return json({
    agent_id: r.agent_id,
    first_score_at: toIsoDate(r.first_score_at),
    days_active: coerceInt(r.days_active),
    days_since_first_score:
      r.days_since_first_score === null ? null : coerceInt(r.days_since_first_score),
    mu_evolution: coerceEvolution(r.mu_evolution),
    stability_score: coerceNumber(r.stability_score),
    stability_sample_days: coerceInt(r.stability_sample_days),
    consistency_badge: r.consistency_badge,
    current_mu: coerceNumber(r.current_mu),
    current_sigma: coerceNumber(r.current_sigma),
  });
}

export async function handleAgentTemporal(
  agentId: string,
  pool: Pool,
): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const cached = (await temporalCache.wrap(agentId, async () => {
    const res = await loadTemporal(agentId, pool);
    return { status: res.status, body: await res.json() };
  })) as { status: number; body: unknown };

  return json(cached.body, cached.status);
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/temporal",
    handler: logAndWrap(
      (ctx) => handleAgentTemporal(ctx.params.id, ctx.pool),
      "agent_temporal",
    ),
  },
];
