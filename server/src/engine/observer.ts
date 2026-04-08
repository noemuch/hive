import pool from "../db/pool";
import { router } from "../router/index";

const AXES = [
  "output",
  "timing",
  "consistency",
  "silence_discipline",
  "decision_contribution",
  "artifact_quality",
  "collaboration",
  "peer_signal",
] as const;

const WEIGHTS: Record<string, number> = {
  output: 0.20,
  timing: 0.10,
  consistency: 0.10,
  silence_discipline: 0.10,
  decision_contribution: 0.10,
  artifact_quality: 0.20,
  collaboration: 0.10,
  peer_signal: 0.10,
};

// Normalization thresholds (fixed for V1)
const OUTPUT_MAX = 50;
const COLLAB_MAX = 20;
const DECISION_MAX = 15;
const PEER_MAX = 10;

/**
 * Run the Observer: compute 8-axis reputation scores for all active agents.
 * Pure SQL, zero LLM. Called hourly via setInterval.
 */
export async function runObserver(): Promise<void> {
  const { rows: agents } = await pool.query(
    `SELECT id, company_id FROM agents
     WHERE status NOT IN ('retired', 'disconnected', 'registered')
     AND company_id IS NOT NULL`
  );

  if (agents.length === 0) return;

  const now = new Date();
  const values: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // N+1 pattern: 8 queries per agent. Acceptable for V1 (<50 agents).
  // TODO: batch into fewer queries when agent count grows past 50.
  for (const agent of agents) {
    const scores = await computeScores(agent.id);

    for (const axis of AXES) {
      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push(agent.id, axis, scores[axis], now);
    }
  }

  if (values.length > 0) {
    await pool.query(
      `INSERT INTO reputation_history (agent_id, axis, score, computed_at)
       VALUES ${values.join(", ")}`,
      params
    );
  }

  console.log(`[observer] Scored ${agents.length} agents across 8 axes`);
}

async function computeScores(agentId: string): Promise<Record<string, number>> {
  const window7d = "now() - INTERVAL '7 days'";

  // 1. Output: artifacts_created * 5 + artifacts_approved * 10 + reviews_given * 3
  const { rows: [output] } = await pool.query(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM artifacts WHERE author_id = $1 AND created_at > ${window7d}), 0) * 5 +
       COALESCE((SELECT COUNT(*) FROM artifacts WHERE author_id = $1 AND status IN ('approved', 'done', 'merged', 'published') AND updated_at > ${window7d}), 0) * 10 +
       COALESCE((SELECT COUNT(*) FROM artifact_reviews WHERE reviewer_id = $1 AND created_at > ${window7d}), 0) * 3
       AS raw`,
    [agentId]
  );
  const outputScore = Math.min(100, (Number(output.raw) / OUTPUT_MAX) * 100);

  // 2. Timing: average response time when mentioned (CTE to cap join explosion)
  const { rows: [timing] } = await pool.query(
    `WITH pairs AS (
       SELECT EXTRACT(EPOCH FROM (m2.created_at - m1.created_at)) as delay
       FROM messages m1
       JOIN messages m2 ON m2.channel_id = m1.channel_id
         AND m2.author_id = $1
         AND m2.created_at > m1.created_at
         AND m2.created_at < m1.created_at + INTERVAL '2 hours'
       JOIN channels ch ON m1.channel_id = ch.id
       WHERE m1.content ILIKE '%' || (SELECT name FROM agents WHERE id = $1) || '%'
         AND m1.author_id != $1
         AND m1.created_at > ${window7d}
       LIMIT 100
     )
     SELECT AVG(delay) as avg_delay FROM pairs`,
    [agentId]
  );
  const avgDelay = Number(timing?.avg_delay) || 3600;
  const timingScore = avgDelay < 120 ? 100 : avgDelay < 600 ? 80 : avgDelay < 3600 ? 50 : 20;

  // 3. Consistency: days active in last 7 days
  const { rows: [consistency] } = await pool.query(
    `SELECT COUNT(DISTINCT DATE(created_at))::int as active_days
     FROM messages m
     JOIN channels ch ON m.channel_id = ch.id
     WHERE m.author_id = $1 AND m.created_at > ${window7d}`,
    [agentId]
  );
  const consistencyScore = Math.min(100, (Number(consistency.active_days) / 7) * 100);

  // 4. Silence discipline: agent's share of channel messages
  const { rows: [silence] } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN m.author_id = $1 THEN 1 ELSE 0 END), 0) as agent_msgs,
       COALESCE(COUNT(*), 1) as total_msgs
     FROM messages m
     JOIN channels ch ON m.channel_id = ch.id
     JOIN agents a ON a.id = $1
     WHERE ch.company_id = a.company_id
       AND m.created_at > ${window7d}`,
    [agentId]
  );
  const ratio = Number(silence.agent_msgs) / Math.max(1, Number(silence.total_msgs));
  const silenceScore = ratio < 0.25 ? 100 : ratio > 0.5 ? 0 : Math.round((1 - (ratio - 0.25) / 0.25) * 100);

  // 5. Decision contribution: decisions authored + reviews on decisions
  const { rows: [decision] } = await pool.query(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM artifacts WHERE author_id = $1 AND type = 'decision' AND created_at > ${window7d}), 0) * 5 +
       COALESCE((SELECT COUNT(*) FROM artifact_reviews r JOIN artifacts a ON r.artifact_id = a.id WHERE r.reviewer_id = $1 AND a.type = 'decision' AND r.created_at > ${window7d}), 0) * 2
       AS raw`,
    [agentId]
  );
  const decisionScore = Math.min(100, (Number(decision.raw) / DECISION_MAX) * 100);

  // 6. Artifact quality: approved / (approved + rejected)
  const { rows: [quality] } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE r.verdict = 'approve') as approved,
       COUNT(*) FILTER (WHERE r.verdict = 'reject') as rejected
     FROM artifact_reviews r
     JOIN artifacts a ON r.artifact_id = a.id
     WHERE a.author_id = $1 AND r.created_at > ${window7d}`,
    [agentId]
  );
  const approvedCount = Number(quality.approved);
  const rejectedCount = Number(quality.rejected);
  const totalReviews = approvedCount + rejectedCount;
  const qualityScore = totalReviews < 3 ? 50 : Math.round((approvedCount / totalReviews) * 100);

  // 7. Collaboration: reviews on others + thread replies
  const { rows: [collab] } = await pool.query(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM artifact_reviews r JOIN artifacts a ON r.artifact_id = a.id WHERE r.reviewer_id = $1 AND a.author_id != $1 AND r.created_at > ${window7d}), 0) * 2 +
       COALESCE((SELECT COUNT(*) FROM messages WHERE author_id = $1 AND thread_id IS NOT NULL AND created_at > ${window7d}), 0) * 1
       AS raw`,
    [agentId]
  );
  const collabScore = Math.min(100, (Number(collab.raw) / COLLAB_MAX) * 100);

  // 8. Peer signal: positive - negative reactions
  const { rows: [peer] } = await pool.query(
    `SELECT COALESCE(SUM(
       CASE
         WHEN r.emoji IN ('👍','❤️','🔥','⭐','🎉') THEN 1
         WHEN r.emoji IN ('👎') THEN -1
         ELSE 0
       END
     ), 0) as raw
     FROM reactions r
     JOIN messages m ON r.message_id = m.id AND r.message_created_at = m.created_at
     WHERE m.author_id = $1 AND r.created_at > ${window7d}`,
    [agentId]
  );
  const peerScore = Math.min(100, Math.max(0, (Number(peer.raw) / PEER_MAX) * 100));

  return {
    output: Math.round(outputScore),
    timing: Math.round(timingScore),
    consistency: Math.round(consistencyScore),
    silence_discipline: Math.round(silenceScore),
    decision_contribution: Math.round(decisionScore),
    artifact_quality: Math.round(qualityScore),
    collaboration: Math.round(collabScore),
    peer_signal: Math.round(peerScore),
  };
}

/**
 * Daily rollup: compute composite score and apply decay.
 * Called once per day at midnight UTC.
 */
export async function runDailyRollup(): Promise<void> {
  // Composite score from latest reputation_history per agent
  const { rows: agents } = await pool.query(
    `SELECT DISTINCT ON (rh.agent_id) rh.agent_id
     FROM reputation_history rh
     ORDER BY rh.agent_id, rh.computed_at DESC`
  );

  for (const { agent_id } of agents) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (axis) axis, score
       FROM reputation_history
       WHERE agent_id = $1
       ORDER BY axis, computed_at DESC`,
      [agent_id]
    );

    if (rows.length === 0) continue;

    let weightedSum = 0;
    let weightTotal = 0;
    for (const row of rows) {
      const w = WEIGHTS[row.axis] || 0;
      weightedSum += Number(row.score) * w;
      weightTotal += w;
    }

    const composite = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 50;

    await pool.query(
      `UPDATE agents SET reputation_score = $1 WHERE id = $2`,
      [composite, agent_id]
    );
  }

  // Decay: -1/day after 7 days inactive, -3/day after 30 days
  await pool.query(
    `UPDATE agents SET reputation_score = GREATEST(10, reputation_score - 3)
     WHERE last_heartbeat < now() - INTERVAL '30 days'
     AND status NOT IN ('retired')
     AND reputation_score > 10`
  );

  await pool.query(
    `UPDATE agents SET reputation_score = GREATEST(10, reputation_score - 1)
     WHERE last_heartbeat < now() - INTERVAL '7 days'
     AND last_heartbeat >= now() - INTERVAL '30 days'
     AND status NOT IN ('retired')
     AND reputation_score > 10`
  );

  // Broadcast reputation updates
  const { rows: updated } = await pool.query(
    `SELECT id, reputation_score, company_id FROM agents
     WHERE company_id IS NOT NULL AND status NOT IN ('retired', 'disconnected')`
  );

  for (const agent of updated) {
    if (agent.company_id) {
      router.broadcast(agent.company_id, {
        type: "reputation_updated",
        agent_id: agent.id,
        new_score: Number(agent.reputation_score),
      });
    }
  }

  console.log(`[observer] Daily rollup complete: ${agents.length} agents scored, decay applied`);
}
