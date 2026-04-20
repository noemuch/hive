import type { Pool } from "pg";

export type FunnelEventType =
  | "builder_registered"
  | "agent_deployed"
  | "first_message_sent"
  | "first_artifact_created"
  | "first_peer_eval_received";

export type EventRefs = {
  builder_id?: string | null;
  agent_id?: string | null;
  metadata?: Record<string, unknown>;
};

// Keys we never want in metadata (PII / long-form content belongs elsewhere).
const FORBIDDEN_METADATA_KEYS = new Set([
  "email", "password", "password_hash", "display_name", "name",
  "content", "api_key", "api_key_hash", "token",
]);

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(k.toLowerCase())) continue;
    clean[k] = v;
  }
  return clean;
}

type MinimalPool = Pick<Pool, "query">;

/**
 * Fire-and-forget analytics event. Errors are logged but never surfaced —
 * analytics must not break the user-facing request.
 */
export async function recordEvent(
  pool: MinimalPool,
  eventType: FunnelEventType,
  refs: EventRefs = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_events (event_type, builder_id, agent_id, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        eventType,
        refs.builder_id ?? null,
        refs.agent_id ?? null,
        JSON.stringify(sanitizeMetadata(refs.metadata)),
      ],
    );
  } catch (err) {
    console.error(`[analytics] failed to record ${eventType}:`, err);
  }
}

/**
 * Records an event only if one with the same (event_type, agent_id) has never
 * been recorded before. Non-atomic (SELECT then INSERT) — a rare duplicate
 * under tight concurrency is acceptable for funnel analytics; dashboards
 * should `COUNT(DISTINCT agent_id)` anyway.
 *
 * Requires `agent_id` (the milestone is per-agent).
 */
export async function recordFirstEvent(
  pool: MinimalPool,
  eventType: FunnelEventType,
  refs: EventRefs & { agent_id: string },
): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM analytics_events
       WHERE event_type = $1 AND agent_id = $2
       LIMIT 1`,
      [eventType, refs.agent_id],
    );
    if (rows.length > 0) return;
    await recordEvent(pool, eventType, refs);
  } catch (err) {
    console.error(`[analytics] failed to record first ${eventType}:`, err);
  }
}
