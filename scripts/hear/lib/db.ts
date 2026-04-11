/**
 * HEAR Judge Service — Postgres client and DAOs.
 *
 * Centralizes all DB I/O for the judge pipeline:
 *   - Read production artifacts from the last 24 hours
 *   - Read agent / builder / company names for the anonymizer
 *   - Read previous Glicko-2-ish state for an (agent, axis)
 *   - Insert quality_evaluations rows
 *   - Insert judge_runs audit rows
 *
 * V1 uses the same `pg` driver the Hive server uses. Connect via DATABASE_URL.
 */

import pg from "pg";

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (_pool) return _pool;
  _pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/hive",
    max: 5,
  });
  _pool.on("error", (err) => {
    console.error("[hear/judge] Unexpected PostgreSQL error:", err);
  });
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ---------- Reads ----------

export type ArtifactRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  author_id: string;
  company_id: string;
  created_at: Date;
};

/**
 * Fetch artifacts created in the previous N hours that haven't been
 * evaluated yet. Idempotent: running the batch multiple times per day
 * won't produce duplicate quality_evaluations rows.
 *
 * The "not yet evaluated" check excludes artifacts that already have at
 * least one row in quality_evaluations within the same time window. A
 * manual re-evaluation path (V2) can bypass this via a separate query.
 */
export async function fetchRecentArtifacts(
  hoursBack = 24,
): Promise<ArtifactRow[]> {
  const pool = getPool();
  // Capture the window boundaries ONCE (both reads use the same timestamps)
  // to avoid a race where two NOW() calls span a clock tick.
  const { rows } = await pool.query<ArtifactRow>(
    `WITH window_bounds AS (
       SELECT NOW() - ($1 || ' hours')::INTERVAL as start_ts, NOW() as end_ts
     )
     SELECT a.id, a.type, a.title, a.content, a.author_id, a.company_id, a.created_at
       FROM artifacts a, window_bounds wb
      WHERE a.created_at >= wb.start_ts
        AND a.created_at <  wb.end_ts
        AND a.content IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM quality_evaluations qe
          WHERE qe.artifact_id = a.id
        )
      ORDER BY a.created_at DESC`,
    [String(hoursBack)],
  );
  return rows;
}

/**
 * Fetch a single artifact by id (for --only mode).
 */
export async function fetchArtifactById(
  id: string,
): Promise<ArtifactRow | null> {
  const pool = getPool();
  const { rows } = await pool.query<ArtifactRow>(
    `SELECT id, type, title, content, author_id, company_id, created_at
       FROM artifacts
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export type NameMaps = {
  agentNames: Map<string, string>;     // agent_id -> name
  builderNames: Map<string, string>;   // builder_id -> name
  companyNames: Map<string, string>;   // company_id -> name
  channelNames: Map<string, string>;   // channel_id -> name
};

/**
 * Pull all entity names from the DB so the anonymizer can scrub them
 * from artifact content. Cheap: ~hundreds of rows total in V1.
 */
export async function fetchNameMaps(): Promise<NameMaps> {
  const pool = getPool();
  const [agents, builders, companies, channels] = await Promise.all([
    pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM agents WHERE name IS NOT NULL`,
    ),
    pool.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM builders WHERE display_name IS NOT NULL`,
    ),
    pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM companies WHERE name IS NOT NULL`,
    ),
    pool
      .query<{ id: string; name: string }>(
        `SELECT id, name FROM channels WHERE name IS NOT NULL`,
      )
      .catch(() => ({ rows: [] as { id: string; name: string }[] })),
  ]);
  return {
    agentNames: new Map(agents.rows.map((r) => [r.id, r.name])),
    builderNames: new Map(
      builders.rows.map((r) => [r.id, r.display_name]),
    ),
    companyNames: new Map(companies.rows.map((r) => [r.id, r.name])),
    channelNames: new Map(channels.rows.map((r) => [r.id, r.name])),
  };
}

export type PriorState = { mu: number; sigma: number } | null;

/**
 * Look up the most recent (mu, sigma) for an (agent, axis) pair.
 * Returns null if no prior evaluation exists.
 */
export async function fetchPriorState(
  agentId: string,
  axis: string,
): Promise<PriorState> {
  const pool = getPool();
  const { rows } = await pool.query<{
    score_state_mu: string | null;
    score_state_sigma: string | null;
  }>(
    `SELECT score_state_mu, score_state_sigma
       FROM quality_evaluations
      WHERE agent_id = $1 AND axis = $2
      ORDER BY computed_at DESC
      LIMIT 1`,
    [agentId, axis],
  );
  if (rows.length === 0) return null;
  const mu = rows[0].score_state_mu;
  const sigma = rows[0].score_state_sigma;
  if (mu === null || sigma === null) return null;
  return { mu: Number(mu), sigma: Number(sigma) };
}

// ---------- Writes ----------

export type EvaluationInsert = {
  agentId: string;
  artifactId: string | null;
  axis: string;
  score: number;
  scoreStateMu: number;
  scoreStateSigma: number;
  scoreStateVolatility: number;
  judgeCount: number;
  judgeModels: string[];
  judgeDisagreement: number;
  wasEscalated: boolean;
  reasoning: string;
  evidenceQuotes: string[];
  rubricVersion: string;
  methodologyVersion: string;
};

export async function insertQualityEvaluation(
  e: EvaluationInsert,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO quality_evaluations (
       agent_id, artifact_id, axis, score,
       score_state_mu, score_state_sigma, score_state_volatility,
       judge_count, judge_models, judge_disagreement,
       was_escalated, reasoning, evidence_quotes,
       rubric_version, methodology_version
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7,
       $8, $9, $10,
       $11, $12, $13::jsonb,
       $14, $15
     )`,
    [
      e.agentId,
      e.artifactId,
      e.axis,
      e.score,
      e.scoreStateMu,
      e.scoreStateSigma,
      e.scoreStateVolatility,
      e.judgeCount,
      e.judgeModels,
      e.judgeDisagreement,
      e.wasEscalated,
      e.reasoning,
      JSON.stringify(e.evidenceQuotes),
      e.rubricVersion,
      e.methodologyVersion,
    ],
  );
}

export type JudgeRunInsert = {
  batchId: string;
  artifactId: string | null;
  agentId: string | null;
  axis: string;
  judgeIndex: number;
  promptVersion: string;
  model: string;
  temperature: number;
  inputHash: string;
  rawOutput: unknown;
  score: number | null;
  judgeConfidence: number | null;
  costUsd: number | null;
  durationMs: number | null;
};

export async function insertJudgeRun(r: JudgeRunInsert): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO judge_runs (
       batch_id, artifact_id, agent_id, axis, judge_index,
       prompt_version, model, temperature, input_hash, raw_output,
       score, judge_confidence, cost_usd, duration_ms
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10::jsonb,
       $11, $12, $13, $14
     )`,
    [
      r.batchId,
      r.artifactId,
      r.agentId,
      r.axis,
      r.judgeIndex,
      r.promptVersion,
      r.model,
      r.temperature,
      r.inputHash,
      JSON.stringify(r.rawOutput),
      r.score,
      r.judgeConfidence,
      r.costUsd,
      r.durationMs,
    ],
  );
}
