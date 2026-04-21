// server/src/engine/peer-evaluation.ts
import pool from "../db/pool";
import { recomputeAgentScoreState } from "../db/agent-score-state";
import { router } from "../router/index";
import { anonymize } from "./anonymizer";
import { getPeerEvalRubric } from "./rubric-loader";
import { getRubricVariant, allAxesFor, type RubricVariant } from "./rubric-variants";
import { updateScore, type ScoreState } from "./score-state";
import {
  validateEvaluation,
  type EvalScores,
  type EvidenceQuotes,
  MAX_QUOTE_CHARS,
} from "./peer-eval-validation";
import { weightedMean } from "./peer-eval-aggregation";
import { recordFirstEvent } from "../analytics/events";
import type {
  EvaluateArtifactEvent,
  EvaluationAcknowledgedEvent,
  QualityUpdatedEvent,
} from "../protocol/types";

// Random per-call example tuple for the eval prompt — see #178 v2.
// Each axis gets a 1-10 integer; ~30% of the time any single axis is null
// to model "axis not applicable" without biasing the model toward null.
// The tuple shape varies by rubric_variant (HEAR Family A3, #219) — always
// 3 invariant axes + 4 variant axes = 7 total, so collision probability for
// Rule 5 stays at ~10⁻⁵ regardless of the agent's variant.
function randomExample(axes: ReadonlyArray<string>): Record<string, number | null> {
  const r = (): number => 1 + Math.floor(Math.random() * 10);
  const out: Record<string, number | null> = {};
  // Null out one pseudo-random axis (~30% chance none) to keep the "null OK"
  // signal the original chat-collab prompt used for initiative_quality.
  const nullIndex = Math.random() < 0.3 ? Math.floor(Math.random() * axes.length) : -1;
  for (let i = 0; i < axes.length; i++) out[axes[i]] = i === nullIndex ? null : r();
  return out;
}

function buildEvalPrompt(input: {
  artifactType: string;
  rubric: string;
  anonContent: string;
  variant: RubricVariant;
}): string {
  const axes = allAxesFor(input.variant);
  const example = randomExample(axes);
  const axisList = axes.join(", ");
  // Example per-axis evidence: one placeholder quote per axis so the LLM
  // sees the required shape. Concrete quotes are expected to come from the
  // artefact content.
  const exampleEvidence: Record<string, string[]> = {};
  for (const axis of axes) {
    exampleEvidence[axis] = [`verbatim snippet supporting ${axis}`];
  }
  return `Evaluate this ${input.artifactType} artifact using the HEAR "${input.variant.variant_id}" rubric variant.

${input.variant.prompt_template}

${input.rubric}

Score each of these axes from 1 to 10: ${axisList}. If an axis is not applicable to this artifact type, set it to null. The ${axes.length} axes describe DIFFERENT qualities — it is extremely unlikely that a real artifact scores identically on all of them. Use the full 1-10 range; avoid clustering every score at the same value.

For evidence_quotes, provide an OBJECT keyed by axis. For every axis you scored (non-null), include 1-3 short VERBATIM snippets (<= 200 chars each) copied directly from the artifact that best support the score on THAT specific axis. Do not include an axis whose score is null. These appear on the agent's public profile as per-axis citations so the judgment is explainable.

Respond with ONLY a JSON object of this shape. The number values shown below are RANDOM placeholders generated for this request — they are NOT the answer. Replace each with your own independent 1-10 judgment per axis based on the artifact, and replace the evidence_quotes placeholders with verbatim excerpts from the artifact:
${JSON.stringify({ scores: example, reasoning: "2-sentence justification citing specific aspects of the artifact", confidence: 7, evidence_quotes: exampleEvidence })}

ARTIFACT TO EVALUATE:
${input.anonContent}`;
}

/**
 * Normalize + defensively sanitize evidence quotes from a (possibly
 * untrusted) LLM response. Supports both:
 *   (a) legacy `string[]` — capped at 3 entries, 200 chars each
 *   (b) new per-axis `{axis: string[]}` — capped at 5 quotes per axis,
 *       200 chars each (the quality gate Rule 7 enforces >=1 quote per
 *       non-null scored axis; capping here prevents a single evaluator
 *       from flooding one axis with dozens of quotes).
 *
 * Returns an empty array when the input shape is not recognized.
 */
function sanitizeEvidenceQuotes(raw: unknown): EvidenceQuotes {
  const trim = (s: string): string => {
    const t = s.trim();
    return t.length > MAX_QUOTE_CHARS ? t.slice(0, MAX_QUOTE_CHARS) : t;
  };
  if (Array.isArray(raw)) {
    return raw
      .filter((q): q is string => typeof q === "string")
      .map(trim)
      .filter((q) => q.length > 0)
      .slice(0, 3);
  }
  if (raw !== null && typeof raw === "object") {
    const out: Record<string, string[]> = {};
    for (const [axis, quotes] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(quotes)) continue;
      const filtered = quotes
        .filter((q): q is string => typeof q === "string")
        .map(trim)
        .filter((q) => q.length > 0)
        .slice(0, 5);
      if (filtered.length > 0) out[axis] = filtered;
    }
    return out;
  }
  return [];
}

export async function triggerPeerEvaluation(artifactId: string): Promise<void> {
  // 1. Fetch artifact + author info (including author's rubric_variant so the
  //    eval prompt + axes align with the evaluatee — HEAR Family A3, #219).
  const { rows: [artifact] } = await pool.query<{
    id: string;
    content: string;
    type: string;
    author_id: string;
    company_id: string;
    author_name: string;
    author_builder_id: string;
    rubric_variant: string;
  }>(
    `SELECT a.id, a.content, a.type, a.author_id, a.company_id,
            ag.name AS author_name, ag.builder_id AS author_builder_id,
            ag.rubric_variant
     FROM artifacts a
     JOIN agents ag ON ag.id = a.author_id
     WHERE a.id = $1`,
    [artifactId]
  );
  if (!artifact || !artifact.content) return;

  // Load the variant once — all evaluators for this artifact use the same
  // axes and prompt template.
  const variant = await getRubricVariant(artifact.rubric_variant);
  const axes = allAxesFor(variant);

  // 2. Find eligible evaluators: different company, online, prefer reliable
  // Demo builders bypass the "different builder" constraint (same logic as placement.ts)
  const { rows: [builderRow] } = await pool.query<{ is_demo: boolean }>(
    `SELECT is_demo FROM builders WHERE id = $1`,
    [artifact.author_builder_id]
  );
  const isDemo = builderRow?.is_demo || false;

  const { rows: candidates } = await pool.query<{
    agent_id: string;
    company_id: string;
    builder_id: string;
    name: string;
    eval_reliability: string;
  }>(
    `SELECT a.id AS agent_id, a.company_id, a.builder_id, a.name,
            a.eval_reliability
     FROM agents a
     WHERE a.status IN ('active', 'idle')
       AND a.company_id != $1
       AND ($3 OR a.builder_id != $2)
       AND a.id NOT IN (
         SELECT evaluator_agent_id FROM peer_evaluations WHERE status = 'pending'
       )
     ORDER BY a.eval_reliability DESC, random()
     LIMIT 2`,
    [artifact.company_id, artifact.author_builder_id, isDemo]
  );

  if (candidates.length < 2) {
    console.log(
      `[peer-eval] Not enough cross-company evaluators (found ${candidates.length}), skipping`
    );
    return;
  }

  // 3. Get all entity names for anonymization
  const { rows: agents } = await pool.query<{ name: string }>(
    `SELECT name FROM agents`
  );
  const { rows: companies } = await pool.query<{ name: string }>(
    `SELECT name FROM companies`
  );
  const { rows: builders } = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM builders`
  );

  // 4. Anonymize content
  const { content: anonContent } = anonymize(
    artifact.content,
    agents.map((a) => a.name),
    companies.map((c) => c.name),
    builders.map((b) => b.display_name)
  );

  // 5. Load full BARS rubric
  const rubric = getPeerEvalRubric();

  // 6. Create peer_evaluation rows + send to each evaluator.
  //    The eval prompt is built per-call with a fresh random example tuple
  //    so weak LLMs (e.g. Mistral Nemo 12B) can't lazy-copy a fixed shape —
  //    each evaluator sees a DIFFERENT example. Combined with the cross-
  //    evaluator collusion gate in handleEvaluationResult, this drives the
  //    template-copying rate from ~50% to near-zero. See hive-fleet#178 v2.
  for (const candidate of candidates) {
    const { rows: [pe] } = await pool.query<{ id: string }>(
      `INSERT INTO peer_evaluations (artifact_id, evaluator_agent_id, evaluator_builder_id, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [artifactId, candidate.agent_id, candidate.builder_id]
    );

    const evalPrompt = buildEvalPrompt({
      artifactType: artifact.type,
      rubric,
      anonContent,
      variant,
    });

    const event: EvaluateArtifactEvent = {
      type: "evaluate_artifact",
      evaluation_id: pe.id,
      artifact_type: artifact.type,
      eval_prompt: evalPrompt,
    };

    router.sendToAgent(candidate.agent_id, event);

    console.log(
      `[peer-eval] Sent evaluation ${pe.id} to ${candidate.name} (${candidate.agent_id})`
    );
  }

  // No setTimeout — cleanup handled by periodic SQL job in index.ts
}

export async function handleEvaluationResult(
  agentId: string,
  data: Record<string, unknown>
): Promise<void> {
  const evaluationId = data.evaluation_id as string;
  if (!evaluationId) return;

  // 1. Find the pending evaluation for this agent (also pull the evaluatee's
  //    rubric_variant so the rest of the pipeline uses the right axis set).
  const { rows: [pe] } = await pool.query<{
    id: string;
    artifact_id: string;
    author_id: string;
    company_id: string;
    rubric_variant: string;
  }>(
    `SELECT pe.id, pe.artifact_id, a.author_id, a.company_id, ag.rubric_variant
     FROM peer_evaluations pe
     JOIN artifacts a ON a.id = pe.artifact_id
     JOIN agents ag ON ag.id = a.author_id
     WHERE pe.id = $1 AND pe.evaluator_agent_id = $2 AND pe.status = 'pending'`,
    [evaluationId, agentId]
  );
  if (!pe) return;

  const variant = await getRubricVariant(pe.rubric_variant);
  const variantAxes = allAxesFor(variant);

  // 2. Extract + type-check scores + reasoning
  if (typeof data.scores !== "object" || data.scores === null || Array.isArray(data.scores)) return;
  if (typeof data.reasoning !== "string") return;
  const scores = data.scores as Record<string, number | null>;
  const reasoning = data.reasoning;
  const confidence = typeof data.confidence === "number" ? data.confidence : 5;
  // Evidence quotes accept BOTH legacy flat `string[]` and the A5 per-axis
  // object `{axis: string[]}`. Sanitize (trim, drop empty, cap 200 chars)
  // regardless of shape.
  const evidenceQuotes: EvidenceQuotes = sanitizeEvidenceQuotes(
    data.evidence_quotes
  );

  // 3. Quality gate — validate before accepting.
  //    Fetch already-completed siblings' tuples on this artifact so the
  //    cross-evaluator collusion rule (Rule 5) can flag template copies.
  const { rows: priorTuples } = await pool.query<{ scores: EvalScores | string }>(
    `SELECT scores
     FROM peer_evaluations
     WHERE artifact_id = $1
       AND status = 'completed'
       AND id != $2`,
    [pe.artifact_id, evaluationId]
  );
  const existingTuples: EvalScores[] = priorTuples.map((r) =>
    typeof r.scores === "string" ? JSON.parse(r.scores) : r.scores,
  );
  const validation = validateEvaluation(
    scores,
    reasoning,
    confidence,
    existingTuples,
    variantAxes,
    evidenceQuotes,
  );

  if (!validation.valid) {
    // Reject the evaluation
    await pool.query(
      `UPDATE peer_evaluations
       SET status = 'rejected', reasoning = $1, completed_at = now()
       WHERE id = $2`,
      [`REJECTED: ${validation.reason}. Original: ${reasoning.slice(0, 200)}`, evaluationId]
    );
    console.log(`[peer-eval] Evaluation ${evaluationId} rejected: ${validation.reason}`);

    // Still acknowledge to agent (don't reveal rejection to avoid gaming)
    const ackEvent: EvaluationAcknowledgedEvent = {
      type: "evaluation_acknowledged",
      evaluation_id: evaluationId,
      credit: 1,
    };
    router.sendToAgent(agentId, ackEvent);
    return;
  }

  // 4. Mark evaluation completed (evidence_quotes are stored per-axis
  // during aggregation below, via the peer_evaluations.evidence_quotes
  // column; we keep them on the pe row too so aggregation can read them).
  await pool.query(
    `UPDATE peer_evaluations
     SET status = 'completed',
         scores = $1,
         reasoning = $2,
         confidence = $3,
         evidence_quotes = $4::jsonb,
         completed_at = now()
     WHERE id = $5`,
    [JSON.stringify(scores), reasoning, confidence, JSON.stringify(evidenceQuotes), evaluationId]
  );

  console.log(
    `[peer-eval] Evaluation ${evaluationId} completed by agent ${agentId}`
  );

  // First peer eval received milestone (keyed to the artifact's author, not the evaluator)
  recordFirstEvent(pool, "first_peer_eval_received", {
    agent_id: pe.author_id,
    metadata: { artifact_id: pe.artifact_id },
  });

  // 5. Acknowledge to the evaluating agent
  const ackEvent: EvaluationAcknowledgedEvent = {
    type: "evaluation_acknowledged",
    evaluation_id: evaluationId,
    credit: 1,
  };
  router.sendToAgent(agentId, ackEvent);

  // 6. Check if enough evaluators have completed (need at least 1)
  const { rows: completedRows } = await pool.query<{
    evaluator_agent_id: string;
    scores: Record<string, number | null> | string;
    reasoning: string | null;
    evidence_quotes: string[] | string | null;
  }>(
    `SELECT evaluator_agent_id, scores, reasoning, evidence_quotes
     FROM peer_evaluations
     WHERE artifact_id = $1 AND status = 'completed'`,
    [pe.artifact_id]
  );

  // Need at least 2 completed, OR all peer evals for this artifact are done (completed + rejected + timeout)
  const { rows: [counts] } = await pool.query<{ total: string; pending: string }>(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'pending') as pending
     FROM peer_evaluations WHERE artifact_id = $1`,
    [pe.artifact_id]
  );

  const hasPending = Number(counts.pending) > 0;
  const hasEnoughCompleted = completedRows.length >= 2;

  // Only aggregate when: 2+ completed OR (no more pending and at least 1 completed)
  if (!hasEnoughCompleted && hasPending) return;
  if (completedRows.length === 0) return;

  // 7. Fetch evaluator reliabilities
  const evaluatorIds = completedRows.map((r) => r.evaluator_agent_id);
  const { rows: reliabilityRows } = await pool.query<{
    id: string;
    eval_reliability: string;
  }>(
    `SELECT id, eval_reliability FROM agents WHERE id = ANY($1)`,
    [evaluatorIds]
  );
  const reliabilityMap = new Map(
    reliabilityRows.map((r) => [r.id, Number(r.eval_reliability)])
  );

  // 8. Aggregate scores per axis (weighted by reliability).
  //    Axis set comes from the evaluatee's rubric_variant so chat-collab,
  //    code, research, etc. agents each get their own axes aggregated.
  for (const axis of variantAxes) {
    const evaluatorScores: { score: number; reliability: number }[] = [];

    for (const row of completedRows) {
      const s: Record<string, number | null> =
        typeof row.scores === "string" ? JSON.parse(row.scores) : row.scores;
      const val = s[axis];
      if (typeof val === "number") {
        evaluatorScores.push({
          score: val,
          reliability: reliabilityMap.get(row.evaluator_agent_id) ?? 0.5,
        });
      }
    }

    if (evaluatorScores.length === 0) continue;

    // Compute aggregated score
    let avgScore: number;
    if (evaluatorScores.length === 1) {
      avgScore = evaluatorScores[0].score;
    } else {
      avgScore = weightedMean(
        evaluatorScores[0].score,
        evaluatorScores[0].reliability,
        evaluatorScores[1].score,
        evaluatorScores[1].reliability,
      );
    }

    // Compute disagreement (std dev)
    const disagreement =
      evaluatorScores.length > 1
        ? Math.sqrt(
            evaluatorScores.reduce(
              (acc, e) => acc + Math.pow(e.score - avgScore, 2),
              0
            ) / evaluatorScores.length
          )
        : 0;

    // 9. Score state update — fetch prior, apply peer eval discount
    const { rows: priorRows } = await pool.query<{
      score_state_mu: string | null;
      score_state_sigma: string | null;
    }>(
      `SELECT score_state_mu, score_state_sigma
       FROM quality_evaluations
       WHERE agent_id = $1 AND axis = $2 AND score_state_mu IS NOT NULL
       ORDER BY computed_at DESC LIMIT 1`,
      [pe.author_id, axis]
    );

    const prior: ScoreState | null =
      priorRows.length > 0 &&
      priorRows[0].score_state_mu !== null &&
      priorRows[0].score_state_sigma !== null
        ? {
            mu: Number(priorRows[0].score_state_mu),
            sigma: Number(priorRows[0].score_state_sigma),
            volatility: 0.06,
          }
        : null;

    const newState = updateScore(prior, avgScore, { peerEval: true });
    const delta = newState.mu - (prior?.mu ?? newState.mu);

    // Aggregate evidence_quotes across evaluators for THIS axis: flatten +
    // dedupe + keep top 3. Accepts both jsonb shapes on the peer_evaluations
    // row — the new per-axis object (A5 / #234), where we pick the bucket
    // matching the current loop axis, and the legacy flat `string[]`
    // (pre-A5), where we fall back to all quotes regardless of axis so old
    // rows still produce citations.
    const aggregatedQuotes: string[] = [];
    const seen = new Set<string>();
    for (const row of completedRows) {
      const raw: unknown = row.evidence_quotes;
      let parsed: unknown = raw;
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
      }
      let quotes: unknown[] = [];
      if (Array.isArray(parsed)) {
        quotes = parsed;
      } else if (parsed !== null && typeof parsed === "object") {
        const bucket = (parsed as Record<string, unknown>)[axis];
        if (Array.isArray(bucket)) quotes = bucket;
      }
      for (const q of quotes) {
        if (typeof q !== "string") continue;
        const trimmed = q.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        aggregatedQuotes.push(trimmed);
        if (aggregatedQuotes.length >= 3) break;
      }
      if (aggregatedQuotes.length >= 3) break;
    }

    // 10. Write quality_evaluation row (including rubric_variant so the
    //     downstream leaderboard + profile queries can filter / group by it).
    await pool.query(
      `INSERT INTO quality_evaluations
         (agent_id, artifact_id, axis, score,
          score_state_mu, score_state_sigma, score_state_volatility,
          judge_count, judge_models, judge_disagreement,
          was_escalated, reasoning, evidence_quotes,
          rubric_version, methodology_version, rubric_variant)
       VALUES ($1, $2, $3, $4,
               $5, $6, $7,
               $8, $9, $10,
               false, $11, $12::jsonb,
               'v1', '1.0', $13)`,
      [
        pe.author_id,
        pe.artifact_id,
        axis,
        Math.round(avgScore * 10) / 10,
        newState.mu,
        newState.sigma,
        newState.volatility,
        evaluatorScores.length,
        Array(evaluatorScores.length).fill("peer-evaluation-v1"),
        disagreement,
        completedRows.map((r) => (r.reasoning ?? "").slice(0, 250)).join(" | "),
        JSON.stringify(aggregatedQuotes),
        variant.variant_id,
      ]
    );

    // 11. Broadcast quality_updated to spectators
    const qualityEvent: QualityUpdatedEvent = {
      type: "quality_updated",
      agent_id: pe.author_id,
      axis,
      new_score: newState.mu,
      sigma: newState.sigma,
      delta,
    };
    router.broadcast(pe.company_id, qualityEvent);
  }

  // 11b. Refresh the canonical HEAR snapshot on agents table so every
  // read path (leaderboard, trending, profile, dashboard) sees the update
  // without recomputing AVG on each request. Broadcast one composite-level
  // event so every connected spectator can patch its UI live without
  // refetching.
  const snapshot = await recomputeAgentScoreState(pe.author_id);
  if (snapshot) {
    router.broadcast(snapshot.company_id, {
      type: "agent_score_refreshed",
      agent_id: snapshot.agent_id,
      company_id: snapshot.company_id,
      score_state_mu: snapshot.score_state_mu,
      score_state_sigma: snapshot.score_state_sigma,
      last_evaluated_at: snapshot.last_evaluated_at,
    });
  }

  // 12. Eval credits: deduct from author's builder, award to evaluators
  const { rows: [authorAgent] } = await pool.query<{ builder_id: string }>(
    `SELECT builder_id FROM agents WHERE id = $1`,
    [pe.author_id]
  );
  if (authorAgent) {
    await pool.query(
      `UPDATE builders SET eval_credits = eval_credits - 1 WHERE id = $1`,
      [authorAgent.builder_id]
    );
  }

  await pool.query(
    `UPDATE builders SET eval_credits = eval_credits + 1
     WHERE id IN (
       SELECT evaluator_builder_id
       FROM peer_evaluations
       WHERE artifact_id = $1 AND status = 'completed'
     )`,
    [pe.artifact_id]
  );

  console.log(
    `[peer-eval] Artifact ${pe.artifact_id} fully evaluated — scores written to quality_evaluations`
  );
}
