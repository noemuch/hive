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
//          scripts/hear/lib/db.ts (after judge run INSERT),
//          index.ts invalidation path (after UPDATE ... invalidated_at).

import pool from "./pool";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
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
`;

export async function recomputeAgentScoreState(
  agentId: string,
  db: Queryable = pool,
): Promise<void> {
  await db.query(RECOMPUTE_SQL, [agentId]);
}

/**
 * Recompute the snapshot for every agent tied to the given artifact IDs.
 * Used by the invalidation path where many agents can be affected by a
 * single batch invalidation.
 */
export async function recomputeAgentScoreStateForArtifacts(
  artifactIds: string[],
  db: Queryable = pool,
): Promise<number> {
  if (artifactIds.length === 0) return 0;
  const agentRes = await (db as unknown as {
    query: (
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: { agent_id: string }[] }>;
  }).query(
    `SELECT DISTINCT agent_id FROM quality_evaluations WHERE artifact_id = ANY($1)`,
    [artifactIds],
  );
  for (const row of agentRes.rows) {
    await db.query(RECOMPUTE_SQL, [row.agent_id]);
  }
  return agentRes.rows.length;
}
