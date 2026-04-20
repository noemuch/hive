import type { Pool } from "pg";
import { json } from "../http/response";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

// Artifact-count milestones surfaced on the activity timeline.
// Keep in sync with the profile UI legend. Any new threshold should be appended
// in ascending order; the Nth-artifact created_at is used as the event time.
const ARTIFACT_MILESTONES = [100, 300, 500, 1000] as const;

type EventType =
  | "artifact_created"
  | "peer_eval_received"
  | "milestone"
  | "joined_company";

type EventRow = {
  type: EventType;
  timestamp: Date | string;
  payload: Record<string, unknown>;
  total: string | number;
};

function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  if (n < MIN_LIMIT) return MIN_LIMIT;
  return n;
}

function parseOffset(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export async function handleAgentActivity(
  agentId: string,
  url: URL,
  pool: Pool,
): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const { rows: existsRows } = await pool.query(
    `SELECT id FROM agents WHERE id = $1`,
    [agentId],
  );
  if (existsRows.length === 0) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = parseOffset(url.searchParams.get("offset"));

  const sql = `
    WITH events AS (
      SELECT
        'artifact_created'::text AS type,
        a.created_at AS timestamp,
        jsonb_build_object(
          'artifact_id', a.id,
          'title', a.title,
          'type', a.type,
          'score', (
            SELECT ROUND(AVG(score), 2)
            FROM quality_evaluations
            WHERE artifact_id = a.id AND invalidated_at IS NULL
          )
        ) AS payload
      FROM artifacts a
      WHERE a.author_id = $1

      UNION ALL

      SELECT
        'peer_eval_received'::text,
        pe.completed_at,
        jsonb_build_object(
          'eval_id', pe.id,
          'evaluator_name', e.name,
          'score', (
            SELECT ROUND(AVG((v.value)::numeric), 2)
            FROM jsonb_each_text(pe.scores) v
            WHERE v.value IS NOT NULL AND v.value <> 'null'
          ),
          'citation', pe.evidence_quotes->>0
        )
      FROM peer_evaluations pe
      JOIN artifacts ar ON ar.id = pe.artifact_id
      JOIN agents e ON e.id = pe.evaluator_agent_id
      WHERE ar.author_id = $1
        AND pe.status = 'completed'
        AND pe.completed_at IS NOT NULL

      UNION ALL

      SELECT
        'milestone'::text,
        m.ts,
        jsonb_build_object('kind', 'artifacts_count', 'value', m.val)
      FROM (
        SELECT
          t.val,
          (
            SELECT created_at FROM artifacts
            WHERE author_id = $1
            ORDER BY created_at ASC
            OFFSET t.val - 1
            LIMIT 1
          ) AS ts
        FROM unnest($4::int[]) AS t(val)
      ) m
      WHERE m.ts IS NOT NULL

      UNION ALL

      SELECT
        'joined_company'::text,
        ag.created_at,
        jsonb_build_object('company_id', c.id, 'company_name', c.name)
      FROM agents ag
      JOIN companies c ON c.id = ag.company_id
      WHERE ag.id = $1
    )
    SELECT type, timestamp, payload, COUNT(*) OVER () AS total
    FROM events
    ORDER BY timestamp DESC
    LIMIT $2 OFFSET $3
  `;

  const { rows } = await pool.query<EventRow>(sql, [
    agentId,
    limit,
    offset,
    ARTIFACT_MILESTONES as unknown as number[],
  ]);

  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  const events = rows.map((r) => ({
    type: r.type,
    timestamp:
      r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
    payload: r.payload,
  }));

  return json({
    events,
    total,
    has_more: offset + events.length < total,
  });
}
