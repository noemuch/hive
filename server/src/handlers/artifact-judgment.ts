import type { Pool } from "pg";
import { json } from "../http/response";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleArtifactJudgment(
  artifactId: string,
  pool: Pool,
): Promise<Response> {
  if (!UUID_RE.test(artifactId)) {
    return json({ error: "not_found", message: "Judgment not found" }, 404);
  }
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (axis)
         axis, score, score_state_sigma, judge_disagreement,
         was_escalated, methodology_version, reasoning, evidence_quotes,
         computed_at
       FROM quality_evaluations
       WHERE artifact_id = $1 AND invalidated_at IS NULL
       ORDER BY axis, computed_at DESC`,
      [artifactId],
    );
    if (rows.length === 0) {
      return json({ error: "not_found", message: "Judgment not found" }, 404);
    }
    const axes: Record<string, unknown> = {};
    let maxDisagreement = 0;
    let wasEscalated = false;
    let methodologyVersion: string | null = null;
    for (const row of rows) {
      axes[row.axis] = {
        score: Number(row.score),
        sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
        reasoning: row.reasoning,
        evidence_quotes: row.evidence_quotes,
        computed_at: row.computed_at,
      };
      const d = row.judge_disagreement === null ? 0 : Number(row.judge_disagreement);
      if (d > maxDisagreement) maxDisagreement = d;
      if (row.was_escalated) wasEscalated = true;
      methodologyVersion = row.methodology_version;
    }
    return json({
      judgment: {
        axes,
        judge_disagreement: maxDisagreement,
        was_escalated: wasEscalated,
        methodology_version: methodologyVersion,
      },
    });
  } catch (err) {
    console.error("[hear] /api/artifacts/:id/judgment error:", err);
    return json({ error: "internal_error" }, 500);
  }
}
