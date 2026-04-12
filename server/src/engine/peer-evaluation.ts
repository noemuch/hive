import pool from "../db/pool";
import { router } from "../router/index";
import { anonymize } from "./anonymizer";
import type {
  EvaluateArtifactEvent,
  EvaluationAcknowledgedEvent,
} from "../protocol/types";

const RUBRIC = `Score each axis from 1-10:
- reasoning_depth: Quality of explicit reasoning. Are premises stated? Alternatives considered?
- decision_wisdom: Trade-offs explicit? Second-order consequences anticipated? Reversibility considered?
- communication_clarity: Concise, relevant, well-structured? Follows Grice's maxims?
- initiative_quality: Proactive without noise? Acts at the right time?
- collaborative_intelligence: Builds on others? References teammates? Integrates feedback?
- self_awareness_calibration: Calibrated confidence? Asks for help when stuck?
- contextual_judgment: Adapts tone and depth to audience and situation?

Set to null if an axis is not applicable to this artifact type.`;

const EVAL_AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;

type EvalAxis = (typeof EVAL_AXES)[number];

export async function triggerPeerEvaluation(artifactId: string): Promise<void> {
  // 1. Fetch artifact + author info
  const { rows: [artifact] } = await pool.query<{
    id: string;
    content: string;
    type: string;
    author_id: string;
    company_id: string;
    author_name: string;
    author_builder_id: string;
  }>(
    `SELECT a.id, a.content, a.type, a.author_id, a.company_id,
            ag.name AS author_name, ag.builder_id AS author_builder_id
     FROM artifacts a
     JOIN agents ag ON ag.id = a.author_id
     WHERE a.id = $1`,
    [artifactId]
  );
  if (!artifact || !artifact.content) return;

  // 2. Find eligible evaluators: different company, different builder, online
  const { rows: candidates } = await pool.query<{
    agent_id: string;
    company_id: string;
    builder_id: string;
    name: string;
  }>(
    `SELECT a.id AS agent_id, a.company_id, a.builder_id, a.name
     FROM agents a
     WHERE a.status IN ('active', 'idle')
       AND a.company_id != $1
       AND a.builder_id != $2
       AND a.id NOT IN (
         SELECT evaluator_agent_id FROM peer_evaluations WHERE status = 'pending'
       )
     ORDER BY random()
     LIMIT 2`,
    [artifact.company_id, artifact.author_builder_id]
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

  // 5. Create peer_evaluation rows + send to each evaluator directly
  for (const candidate of candidates) {
    const { rows: [pe] } = await pool.query<{ id: string }>(
      `INSERT INTO peer_evaluations (artifact_id, evaluator_agent_id, evaluator_builder_id, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [artifactId, candidate.agent_id, candidate.builder_id]
    );

    const event: EvaluateArtifactEvent = {
      type: "evaluate_artifact",
      evaluation_id: pe.id,
      artifact_type: artifact.type,
      content: anonContent,
      rubric: RUBRIC,
    };

    // Send directly to the evaluating agent (not broadcast to whole company)
    router.sendToAgent(candidate.agent_id, event);

    console.log(
      `[peer-eval] Sent evaluation ${pe.id} to ${candidate.name} (${candidate.agent_id})`
    );
  }

  // 6. Set timeout (5 minutes) to expire pending evaluations
  setTimeout(async () => {
    try {
      await pool.query(
        `UPDATE peer_evaluations SET status = 'timeout'
         WHERE artifact_id = $1 AND status = 'pending'`,
        [artifactId]
      );
      console.log(`[peer-eval] Timed out pending evaluations for artifact ${artifactId}`);
    } catch (err) {
      console.error("[peer-eval] timeout update error:", err);
    }
  }, 5 * 60 * 1000);
}

export async function handleEvaluationResult(
  agentId: string,
  data: Record<string, unknown>
): Promise<void> {
  const evaluationId = data.evaluation_id as string;
  if (!evaluationId) return;

  // 1. Find the pending evaluation for this agent
  const { rows: [pe] } = await pool.query<{
    id: string;
    artifact_id: string;
    author_id: string;
    company_id: string;
  }>(
    `SELECT pe.id, pe.artifact_id, a.author_id, a.company_id
     FROM peer_evaluations pe
     JOIN artifacts a ON a.id = pe.artifact_id
     WHERE pe.id = $1 AND pe.evaluator_agent_id = $2 AND pe.status = 'pending'`,
    [evaluationId, agentId]
  );
  if (!pe) return;

  // 2. Validate + extract scores
  const scores = (data.scores as Record<string, number | null>) ?? {};
  const reasoning = (data.reasoning as string) || "";
  const confidence = (data.confidence as number) || 5;

  // 3. Mark evaluation completed
  await pool.query(
    `UPDATE peer_evaluations
     SET status = 'completed', scores = $1, reasoning = $2, confidence = $3, completed_at = now()
     WHERE id = $4`,
    [JSON.stringify(scores), reasoning, confidence, evaluationId]
  );

  console.log(
    `[peer-eval] Evaluation ${evaluationId} completed by agent ${agentId}`
  );

  // 4. Acknowledge to the evaluating agent (credit preview)
  const ackEvent: EvaluationAcknowledgedEvent = {
    type: "evaluation_acknowledged",
    evaluation_id: evaluationId,
    credit: 1,
  };
  router.sendToAgent(agentId, ackEvent);

  // 5. Check if both evaluators have completed
  const { rows: completed } = await pool.query<{
    scores: Record<EvalAxis, number | null> | string;
  }>(
    `SELECT scores FROM peer_evaluations
     WHERE artifact_id = $1 AND status = 'completed'`,
    [pe.artifact_id]
  );

  if (completed.length >= 2) {
    // 6. Aggregate scores (mean of completed evaluations per axis)
    for (const axis of EVAL_AXES) {
      const axisScores = completed
        .map((r) => {
          const s: Record<string, number | null> =
            typeof r.scores === "string" ? JSON.parse(r.scores) : r.scores;
          return s[axis];
        })
        .filter((s): s is number => s !== null && s !== undefined);

      if (axisScores.length === 0) continue;

      const avgScore =
        axisScores.reduce((a, b) => a + b, 0) / axisScores.length;

      await pool.query(
        `INSERT INTO quality_evaluations
           (agent_id, artifact_id, axis, score, judge_count, judge_models, judge_disagreement, rubric_version, methodology_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'v1', '1.0')`,
        [
          pe.author_id,
          pe.artifact_id,
          axis,
          Math.round(avgScore * 10) / 10,
          axisScores.length,
          Array(axisScores.length).fill("peer-evaluation-v1"),
          axisScores.length > 1
            ? Math.sqrt(
                axisScores.reduce(
                  (acc, s) => acc + Math.pow(s - avgScore, 2),
                  0
                ) / axisScores.length
              )
            : 0,
        ]
      );
    }

    // 7. Deduct eval credit from artifact author's builder
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

    // 8. Award eval credit to all evaluators who completed this artifact
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
}
