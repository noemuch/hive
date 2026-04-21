import { join } from "node:path";
import type { Pool } from "pg";
import { json } from "../http/response";
import type { Route } from "../router/route-types";

export function handleResearchMethodology(): Response {
  return json({
    rubric_version: "1.0",
    methodology_version: "1.0",
    axes: [
      { id: "reasoning_depth", label: "Reasoning Depth" },
      { id: "decision_wisdom", label: "Decision Wisdom" },
      { id: "communication_clarity", label: "Communication Clarity" },
      { id: "initiative_quality", label: "Initiative Quality" },
      { id: "collaborative_intelligence", label: "Collaborative Intelligence" },
      { id: "self_awareness_calibration", label: "Self-Awareness & Calibration" },
      { id: "contextual_judgment", label: "Contextual Judgment" },
    ],
    theoretical_frameworks: [
      { name: "Dual Process Theory", citation: "Kahneman (2011). Thinking, Fast and Slow." },
      { name: "Grice's Cooperative Principle", citation: "Grice (1975). Logic and Conversation." },
      { name: "Bloom's Taxonomy", citation: "Anderson & Krathwohl (2001). A Taxonomy for Learning." },
      { name: "Self-Determination Theory", citation: "Deci & Ryan (1985). Intrinsic Motivation." },
      { name: "Metacognition / Calibration", citation: "Flavell (1979). Metacognition and Cognitive Monitoring." },
      { name: "Contextual Integrity", citation: "Nissenbaum (2004). Privacy as Contextual Integrity." },
    ],
  });
}

export async function handleResearchCalibrationStats(): Promise<Response> {
  try {
    const resultsPath = join(
      import.meta.dir,
      "../../docs/research/calibration/analysis/e4-results.json",
    );
    const file = Bun.file(resultsPath);
    if (await file.exists()) {
      const data = await file.json();
      return json({
        cohen_kappa: null,
        krippendorff_alpha: null,
        icc: null,
        test_retest_correlation: null,
        calibration_drift: null,
        last_computed: data.computed_at ?? null,
        factor_analysis: data.factor_analysis ?? null,
        discriminant_validity: data.discriminant_validity ?? null,
        irt: data.irt ?? null,
        fairness: data.fairness ?? null,
      });
    }
  } catch {
    // fall through to null response
  }
  return json({
    cohen_kappa: null,
    krippendorff_alpha: null,
    icc: null,
    test_retest_correlation: null,
    calibration_drift: null,
    last_computed: null,
    factor_analysis: null,
    discriminant_validity: null,
    irt: null,
    fairness: null,
  });
}

const MONTHLY_JUDGE_BUDGET_USD = 50;

export async function handleResearchCost(pool: Pool): Promise<Response> {
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(cost_usd), 0)::float as current_month_usd,
         COALESCE(AVG(cost_usd), 0)::float as cost_per_eval_avg,
         COUNT(*)::int as run_count
       FROM judge_runs
       WHERE created_at >= date_trunc('month', now())
         AND invalidated_at IS NULL`,
    );
    const r = rows[0] || { current_month_usd: 0, cost_per_eval_avg: 0, run_count: 0 };
    return json({
      current_month_usd: Number(r.current_month_usd) || 0,
      monthly_cap_usd: MONTHLY_JUDGE_BUDGET_USD,
      cost_per_eval_avg: Number(r.cost_per_eval_avg) || 0,
      trend: "stable",
    });
  } catch (err) {
    console.error("[hear] /api/research/cost error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export async function handleResearchCalibrationSet(url: URL, pool: Pool): Promise<Response> {
  const rawLimit = parseInt(url.searchParams.get("limit") || "10", 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 10 : rawLimit, 1), 50);
  const rawOffset = parseInt(url.searchParams.get("offset") || "0", 10);
  const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);
  try {
    const { rows: items } = await pool.query(
      `SELECT id, artifact_type, artifact_content, rubric_version, added_at
       FROM calibration_set
       ORDER BY added_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    if (items.length === 0) return json({ items: [] });
    const ids = items.map((i) => i.id);
    const { rows: grades } = await pool.query(
      `SELECT calibration_id, grader_id, axis, score, justification, graded_at
       FROM calibration_grades
       WHERE calibration_id = ANY($1)`,
      [ids],
    );
    const gradesByCalib = new Map<string, unknown[]>();
    for (const g of grades) {
      if (!gradesByCalib.has(g.calibration_id)) gradesByCalib.set(g.calibration_id, []);
      gradesByCalib.get(g.calibration_id)!.push({
        grader_id: g.grader_id,
        axis: g.axis,
        score: g.score,
        justification: g.justification,
        graded_at: g.graded_at,
      });
    }
    const payload = items.map((i) => ({
      id: i.id,
      artifact_type: i.artifact_type,
      anonymized_content: i.artifact_content,
      rubric_version: i.rubric_version,
      added_at: i.added_at,
      grades: gradesByCalib.get(i.id) || [],
    }));
    return json({ items: payload, limit, offset });
  } catch (err) {
    console.error("[hear] /api/research/calibration-set error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/research/methodology",
    handler: () => handleResearchMethodology(),
  },
  {
    method: "GET",
    path: "/api/research/calibration-stats",
    handler: () => handleResearchCalibrationStats(),
  },
  {
    method: "GET",
    path: "/api/research/cost",
    handler: (ctx) => handleResearchCost(ctx.pool),
  },
  {
    method: "GET",
    path: "/api/research/calibration-set",
    handler: (ctx) => handleResearchCalibrationSet(ctx.url, ctx.pool),
  },
];
