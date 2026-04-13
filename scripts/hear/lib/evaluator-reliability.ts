/**
 * Computes and updates evaluator reliability by comparing peer eval scores
 * to judge scores for the same artifact.
 *
 * Called by judge.ts after evaluating an artifact that also has completed
 * peer evaluations. The judge is the source of truth.
 */

import { getPool } from "./db";
import { AXES } from "./rubric";

const RELIABILITY_DECAY = 0.8;
const AGREEMENT_THRESHOLD = 1.5; // mean absolute diff ≤ 1.5 = reliable

type PeerEvalRow = {
  evaluator_agent_id: string;
  scores: Record<string, number | null> | string;
  current_reliability: string;
};

/**
 * Compare judge scores to peer eval scores for the given artifact.
 * Update eval_reliability on each evaluator agent.
 */
export async function updateEvaluatorReliability(
  artifactId: string,
  judgeScores: Record<string, number | null>,
): Promise<void> {
  const pool = getPool();

  // Fetch completed peer evaluations for this artifact + current reliability
  const { rows } = await pool.query<PeerEvalRow>(
    `SELECT pe.evaluator_agent_id, pe.scores, a.eval_reliability AS current_reliability
     FROM peer_evaluations pe
     JOIN agents a ON a.id = pe.evaluator_agent_id
     WHERE pe.artifact_id = $1 AND pe.status = 'completed'`,
    [artifactId],
  );

  if (rows.length === 0) return;

  for (const row of rows) {
    const peerScores: Record<string, number | null> =
      typeof row.scores === "string" ? JSON.parse(row.scores) : row.scores;

    // Compute mean absolute difference across matching axes
    let totalDiff = 0;
    let count = 0;

    for (const axis of AXES) {
      const judgeScore = judgeScores[axis];
      const peerScore = peerScores[axis];
      if (judgeScore !== null && judgeScore !== undefined &&
          peerScore !== null && peerScore !== undefined) {
        totalDiff += Math.abs(judgeScore - peerScore);
        count++;
      }
    }

    if (count === 0) continue;

    const meanAbsDiff = totalDiff / count;
    const signal = meanAbsDiff <= AGREEMENT_THRESHOLD ? 1.0 : 0.0;

    // Running average: new = old * 0.8 + signal * 0.2
    const oldReliability = Number(row.current_reliability);
    const newReliability = oldReliability * RELIABILITY_DECAY + signal * (1 - RELIABILITY_DECAY);

    await pool.query(
      `UPDATE agents SET eval_reliability = $1 WHERE id = $2`,
      [Math.round(newReliability * 100) / 100, row.evaluator_agent_id],
    );

    console.log(
      `  [reliability] ${row.evaluator_agent_id}: meanΔ=${meanAbsDiff.toFixed(2)} → ` +
      `signal=${signal} → reliability ${oldReliability.toFixed(2)} → ${newReliability.toFixed(2)}`,
    );
  }
}
