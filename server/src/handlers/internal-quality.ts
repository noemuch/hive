import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { json } from "../http/response";
import {
  recomputeAgentScoreState,
  recomputeAgentScoreStateForArtifacts,
  type AgentScoreSnapshot,
} from "../db/agent-score-state";
import { maybeRefreshTemporalStats } from "../db/temporal-refresh";
import { router } from "../router/index";
import { HEAR_AXES } from "./hear-axes";
import type { Route } from "../router/route-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALIDATION_REASON_MAX = 500;

function authorizeInternal(req: Request): Response | null {
  const expected = process.env.HIVE_INTERNAL_TOKEN;
  if (!expected) {
    console.error("[hear] HIVE_INTERNAL_TOKEN not configured");
    return json({ error: "internal_not_configured" }, 500);
  }
  const provided = req.headers.get("X-Hive-Internal-Token");
  if (!provided) return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  }
  return null;
}

/**
 * Quality-notify: the judge service has already written to the DB; this
 * endpoint only broadcasts WS events and refreshes the per-agent snapshot
 * so spectators see updated composites without a refetch.
 */
export async function handleInternalQualityNotify(req: Request, pool: Pool): Promise<Response> {
  const authErr = authorizeInternal(req);
  if (authErr) return authErr;
  const body = (await req.json().catch(() => null)) as {
    batch_id?: string;
    evaluations?: Array<{
      agent_id?: string;
      axis?: string;
      new_score?: number;
      sigma?: number;
      delta?: number;
    }>;
  } | null;
  if (!body?.batch_id || !Array.isArray(body.evaluations)) {
    return json({ error: "batch_id and evaluations[] required" }, 400);
  }
  try {
    let broadcast = 0;
    for (const ev of body.evaluations) {
      if (!ev.agent_id || !UUID_RE.test(ev.agent_id)) continue;
      if (!ev.axis || !HEAR_AXES.includes(ev.axis as typeof HEAR_AXES[number])) continue;
      const { rows } = await pool.query(
        `SELECT company_id FROM agents WHERE id = $1`,
        [ev.agent_id],
      );
      const companyId = rows[0]?.company_id;
      if (!companyId) continue;
      router.broadcast(companyId, {
        type: "quality_updated",
        agent_id: ev.agent_id,
        axis: ev.axis,
        new_score: Number(ev.new_score ?? 0),
        sigma: Number(ev.sigma ?? 0),
        delta: Number(ev.delta ?? 0),
      });
      broadcast += 1;
    }

    const uniqueAgentIds = Array.from(
      new Set(
        body.evaluations
          .map((ev) => ev.agent_id)
          .filter((id): id is string => !!id && UUID_RE.test(id)),
      ),
    );
    for (const agentId of uniqueAgentIds) {
      const snapshot = await recomputeAgentScoreState(agentId);
      if (!snapshot) continue;
      router.broadcast(snapshot.company_id, {
        type: "agent_score_refreshed",
        agent_id: snapshot.agent_id,
        company_id: snapshot.company_id,
        score_state_mu: snapshot.score_state_mu,
        score_state_sigma: snapshot.score_state_sigma,
        last_evaluated_at: snapshot.last_evaluated_at,
      });
    }

    // Best-effort temporal MV refresh (debounced to once per hour).
    // Failure is swallowed inside the helper so a notify batch never
    // fails just because the long-tail view is unavailable.
    await maybeRefreshTemporalStats(pool);

    return json({ ok: true, batch_id: body.batch_id, broadcast });
  } catch (err) {
    console.error("[hear] /api/internal/quality/notify error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export async function handleInternalQualityInvalidateBatch(
  req: Request,
  pool: Pool,
): Promise<Response> {
  const authErr = authorizeInternal(req);
  if (authErr) return authErr;
  const body = (await req.json().catch(() => null)) as {
    batch_id?: string;
    reason?: string;
  } | null;
  if (!body?.batch_id || !UUID_RE.test(body.batch_id)) {
    return json({ error: "batch_id (UUID) required" }, 400);
  }
  if (!body.reason || body.reason.trim().length === 0) {
    return json({ error: "reason required" }, 400);
  }
  if (body.reason.trim().length > INVALIDATION_REASON_MAX) {
    return json({ error: "reason must be 500 characters or fewer" }, 400);
  }
  const reason = body.reason.trim();
  const batchId = body.batch_id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rowCount: runsInvalidated } = await client.query(
      `UPDATE judge_runs
       SET invalidated_at = now(), invalidation_reason = $1
       WHERE batch_id = $2 AND invalidated_at IS NULL`,
      [reason, batchId],
    );
    const { rows: invalidatedRows } = await client.query<{ artifact_id: string }>(
      `SELECT DISTINCT artifact_id FROM judge_runs
       WHERE batch_id = $1 AND artifact_id IS NOT NULL`,
      [batchId],
    );
    const artifactIds = invalidatedRows.map((r) => r.artifact_id);

    let evalsInvalidated = 0;
    let rescoredSnapshots: AgentScoreSnapshot[] = [];
    if (artifactIds.length > 0) {
      const { rowCount } = await client.query(
        `UPDATE quality_evaluations
         SET invalidated_at = now(), invalidation_reason = $1
         WHERE artifact_id = ANY($2) AND invalidated_at IS NULL`,
        [reason, artifactIds],
      );
      evalsInvalidated = rowCount ?? 0;

      rescoredSnapshots = await recomputeAgentScoreStateForArtifacts(artifactIds, client);
    }
    const agentsRescored = rescoredSnapshots.length;

    await client.query("COMMIT");

    for (const snapshot of rescoredSnapshots) {
      router.broadcast(snapshot.company_id, {
        type: "agent_score_refreshed",
        agent_id: snapshot.agent_id,
        company_id: snapshot.company_id,
        score_state_mu: snapshot.score_state_mu,
        score_state_sigma: snapshot.score_state_sigma,
        last_evaluated_at: snapshot.last_evaluated_at,
      });
    }

    console.log(
      `[hear] invalidated batch ${batchId}: ${runsInvalidated} runs, ${evalsInvalidated} evals, ${agentsRescored} agents rescored — ${reason}`,
    );
    return json({
      ok: true,
      runs_invalidated: runsInvalidated ?? 0,
      evaluations_invalidated: evalsInvalidated,
      agents_rescored: agentsRescored,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[hear] /api/internal/quality/invalidate-batch error:", err);
    return json({ error: "internal_error" }, 500);
  } finally {
    client.release();
  }
}

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/internal/quality/notify",
    handler: (ctx) => handleInternalQualityNotify(ctx.req, ctx.pool),
  },
  {
    method: "POST",
    path: "/api/internal/quality/invalidate-batch",
    handler: (ctx) => handleInternalQualityInvalidateBatch(ctx.req, ctx.pool),
  },
];
