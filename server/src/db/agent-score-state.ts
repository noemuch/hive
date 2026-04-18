// server/src/db/agent-score-state.ts
//
// Single source of truth for the agents.score_state_mu snapshot.
//
// Canonical formula:
//   agents.score_state_mu = AVG across axes of the LATEST non-invalidated
//     score_state_mu per axis from quality_evaluations, for this agent.
//
// NULL when no non-invalidated peer-eval / judge rows exist for the agent.
//
// Callers: peer-evaluation.ts (after per-axis INSERTs),
//          scripts/hear/lib/db.ts (after judge run INSERT, via HTTP notify),
//          index.ts invalidation path (after UPDATE ... invalidated_at).

import pool from "./pool";

type Queryable = {
  query: <R = unknown>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: R[] }>;
};

export type AgentScoreSnapshot = {
  agent_id: string;
  company_id: string;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
};

const RECOMPUTE_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (axis)
      axis, score_state_mu, score_state_sigma, computed_at
    FROM quality_evaluations
    WHERE agent_id = $1
      AND invalidated_at IS NULL
      AND score_state_mu IS NOT NULL
    ORDER BY axis, computed_at DESC
  ),
  agg AS (
    SELECT
      AVG(score_state_mu)::numeric(6,2)   AS mu,
      AVG(score_state_sigma)::numeric(6,2) AS sigma,
      MAX(computed_at)                     AS last_evaluated_at
    FROM latest
  )
  UPDATE agents
  SET
    score_state_mu    = agg.mu,
    score_state_sigma = agg.sigma,
    last_evaluated_at = agg.last_evaluated_at
  FROM agg
  WHERE id = $1
  RETURNING
    id               AS agent_id,
    company_id,
    score_state_mu,
    score_state_sigma,
    last_evaluated_at
`;

type RecomputeRow = {
  agent_id: string;
  company_id: string;
  score_state_mu: string | null;
  score_state_sigma: string | null;
  last_evaluated_at: Date | null;
};

function toSnapshot(row: RecomputeRow): AgentScoreSnapshot {
  return {
    agent_id: row.agent_id,
    company_id: row.company_id,
    score_state_mu: row.score_state_mu === null ? null : Number(row.score_state_mu),
    score_state_sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
    last_evaluated_at: row.last_evaluated_at === null ? null : row.last_evaluated_at.toISOString(),
  };
}

export async function recomputeAgentScoreState(
  agentId: string,
  db: Queryable = pool,
): Promise<AgentScoreSnapshot | null> {
  const { rows } = await db.query<RecomputeRow>(RECOMPUTE_SQL, [agentId]);
  return rows[0] ? toSnapshot(rows[0]) : null;
}

/**
 * Recompute the snapshot for every agent tied to the given artifact IDs.
 * Returns the fresh snapshot for each affected agent so callers can
 * broadcast composite-refresh events without an extra SELECT.
 */
export async function recomputeAgentScoreStateForArtifacts(
  artifactIds: string[],
  db: Queryable = pool,
): Promise<AgentScoreSnapshot[]> {
  if (artifactIds.length === 0) return [];
  const agentRes = await db.query<{ agent_id: string }>(
    `SELECT DISTINCT agent_id FROM quality_evaluations WHERE artifact_id = ANY($1)`,
    [artifactIds],
  );
  const snapshots: AgentScoreSnapshot[] = [];
  for (const row of agentRes.rows) {
    const { rows } = await db.query<RecomputeRow>(RECOMPUTE_SQL, [row.agent_id]);
    if (rows[0]) snapshots.push(toSnapshot(rows[0]));
  }
  return snapshots;
}
