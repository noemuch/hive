import pool from "../db/pool";
import { router } from "../router/index";
import { broadcastStatsUpdate } from "./handlers";

export type LifecycleState = "forming" | "active" | "struggling" | "dissolved";

/**
 * Check and update a bureau's lifecycle state based on current agent count.
 * Called on every agent_joined / agent_left event.
 *
 * Only handles immediate transitions:
 *   FORMING → ACTIVE (2+ agents)
 *   STRUGGLING → ACTIVE (2+ agents recover)
 *
 * Time-based transitions (ACTIVE → STRUGGLING after 48h, etc.)
 * are handled by checkAllLifecycles() on a periodic interval.
 */
export async function checkLifecycle(bureauId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT c.lifecycle_state,
            (SELECT COUNT(*)::int FROM agents
             WHERE bureau_id = $1
             AND status IN ('active', 'idle', 'assigned', 'connected')) as active_count
     FROM bureaux c WHERE c.id = $1`,
    [bureauId]
  );

  if (rows.length === 0) return;

  const bureau = rows[0];
  const oldState: LifecycleState = bureau.lifecycle_state;
  const activeCount: number = bureau.active_count;
  let newState: LifecycleState = oldState;

  // Immediate transitions: forming or struggling → active when 2+ agents
  if ((oldState === "forming" || oldState === "struggling") && activeCount >= 2) {
    newState = "active";
  }

  // Update agent_count_cache and last_activity_at
  await pool.query(
    `UPDATE bureaux SET agent_count_cache = $1, last_activity_at = now() WHERE id = $2`,
    [activeCount, bureauId]
  );

  if (newState !== oldState) {
    await transitionState(bureauId, oldState, newState);
  }
}

/**
 * Periodic check for time-based transitions.
 * Run on an interval (every 5 minutes).
 *
 *   ACTIVE → STRUGGLING: < 2 active agents for 48h
 *   STRUGGLING → DISSOLVED: < 2 active agents for 7 days
 *   FORMING → DISSOLVED: 0 agents for 7 days
 */
export async function checkAllLifecycles(): Promise<void> {
  // ACTIVE for 48h+ with < 2 active agents → STRUGGLING
  const { rows: declining } = await pool.query(
    `SELECT c.id FROM bureaux c
     WHERE c.lifecycle_state = 'active'
     AND c.last_activity_at < now() - INTERVAL '48 hours'
     AND (SELECT COUNT(*) FROM agents
          WHERE bureau_id = c.id
          AND status IN ('active', 'idle', 'assigned', 'connected')) < 2`
  );

  for (const bureau of declining) {
    await transitionState(bureau.id, "active", "struggling");
  }

  // STRUGGLING for 7+ days with < 2 active agents → DISSOLVED
  const { rows: struggling } = await pool.query(
    `SELECT c.id FROM bureaux c
     WHERE c.lifecycle_state = 'struggling'
     AND c.last_activity_at < now() - INTERVAL '7 days'
     AND (SELECT COUNT(*) FROM agents
          WHERE bureau_id = c.id
          AND status IN ('active', 'idle', 'assigned', 'connected')) < 2`
  );

  for (const bureau of struggling) {
    await transitionState(bureau.id, "struggling", "dissolved");
  }

  // FORMING for 7+ days with 0 agents → DISSOLVED
  const { rows: emptyForming } = await pool.query(
    `SELECT c.id FROM bureaux c
     WHERE c.lifecycle_state = 'forming'
     AND c.founded_at < now() - INTERVAL '7 days'
     AND (SELECT COUNT(*) FROM agents
          WHERE bureau_id = c.id
          AND status IN ('active', 'idle', 'assigned', 'connected')) = 0`
  );

  for (const bureau of emptyForming) {
    await transitionState(bureau.id, "forming", "dissolved");
  }
}

async function transitionState(
  bureauId: string,
  oldState: LifecycleState,
  newState: LifecycleState
): Promise<void> {
  await pool.query(
    `UPDATE bureaux SET lifecycle_state = $1,
       dissolved_at = CASE WHEN $1 = 'dissolved' THEN now() ELSE NULL END
     WHERE id = $2`,
    [newState, bureauId]
  );

  // On dissolution: unassign all agents
  if (newState === "dissolved") {
    await pool.query(
      `UPDATE agents SET bureau_id = NULL, status = 'connected'
       WHERE bureau_id = $1 AND status NOT IN ('retired', 'disconnected')`,
      [bureauId]
    );
  }

  // Log event
  await pool.query(
    `INSERT INTO event_log (event_type, target_id, payload) VALUES ($1, $2, $3)`,
    ["bureau_status_changed", bureauId, JSON.stringify({ old_status: oldState, new_status: newState })]
  );

  // Broadcast to spectators
  router.broadcastToAllSpectators({
    type: "bureau_status_changed",
    bureau_id: bureauId,
    old_status: oldState,
    new_status: newState,
  });

  // Notify watch_all subscribers of stats change
  broadcastStatsUpdate(bureauId);

  console.log(`[lifecycle] Bureau ${bureauId}: ${oldState} → ${newState}`);
}
