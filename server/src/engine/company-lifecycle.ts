import pool from "../db/pool";
import { router } from "../router/index";

export type LifecycleState = "forming" | "active" | "struggling" | "dissolved";

/**
 * Check and update a company's lifecycle state based on current agent count.
 * Called on every agent_joined / agent_left event.
 *
 * Only handles immediate transitions:
 *   FORMING → ACTIVE (2+ agents)
 *   STRUGGLING → ACTIVE (2+ agents recover)
 *
 * Time-based transitions (ACTIVE → STRUGGLING after 48h, etc.)
 * are handled by checkAllLifecycles() on a periodic interval.
 */
export async function checkLifecycle(companyId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT c.lifecycle_state,
            (SELECT COUNT(*)::int FROM agents
             WHERE company_id = $1
             AND status IN ('active', 'idle', 'assigned', 'connected')) as active_count
     FROM companies c WHERE c.id = $1`,
    [companyId]
  );

  if (rows.length === 0) return;

  const company = rows[0];
  const oldState: LifecycleState = company.lifecycle_state;
  const activeCount: number = company.active_count;
  let newState: LifecycleState = oldState;

  // Immediate transitions (agent count thresholds)
  if (oldState === "forming" && activeCount >= 2) {
    newState = "active";
  } else if (oldState === "struggling" && activeCount >= 2) {
    newState = "active";
  }

  // Update agent_count_cache and last_activity_at
  await pool.query(
    `UPDATE companies SET agent_count_cache = $1, last_activity_at = now() WHERE id = $2`,
    [activeCount, companyId]
  );

  if (newState !== oldState) {
    await transitionState(companyId, oldState, newState);
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
    `SELECT c.id FROM companies c
     WHERE c.lifecycle_state = 'active'
     AND c.last_activity_at < now() - INTERVAL '48 hours'
     AND (SELECT COUNT(*) FROM agents
          WHERE company_id = c.id
          AND status IN ('active', 'idle', 'assigned', 'connected')) < 2`
  );

  for (const company of declining) {
    await transitionState(company.id, "active", "struggling");
  }

  // STRUGGLING for 7+ days with < 2 active agents → DISSOLVED
  const { rows: struggling } = await pool.query(
    `SELECT c.id FROM companies c
     WHERE c.lifecycle_state = 'struggling'
     AND c.last_activity_at < now() - INTERVAL '7 days'
     AND (SELECT COUNT(*) FROM agents
          WHERE company_id = c.id
          AND status IN ('active', 'idle', 'assigned', 'connected')) < 2`
  );

  for (const company of struggling) {
    await transitionState(company.id, "struggling", "dissolved");
  }

  // FORMING for 7+ days with 0 agents → DISSOLVED
  const { rows: emptyForming } = await pool.query(
    `SELECT c.id FROM companies c
     WHERE c.lifecycle_state = 'forming'
     AND c.founded_at < now() - INTERVAL '7 days'
     AND (SELECT COUNT(*) FROM agents
          WHERE company_id = c.id
          AND status IN ('active', 'idle', 'assigned', 'connected')) = 0`
  );

  for (const company of emptyForming) {
    await transitionState(company.id, "forming", "dissolved");
  }
}

async function transitionState(
  companyId: string,
  oldState: LifecycleState,
  newState: LifecycleState
): Promise<void> {
  await pool.query(
    `UPDATE companies SET lifecycle_state = $1,
       dissolved_at = CASE WHEN $1 = 'dissolved' THEN now() ELSE NULL END
     WHERE id = $2`,
    [newState, companyId]
  );

  // On dissolution: unassign all agents
  if (newState === "dissolved") {
    await pool.query(
      `UPDATE agents SET company_id = NULL, status = 'connected'
       WHERE company_id = $1 AND status NOT IN ('retired', 'disconnected')`,
      [companyId]
    );
  }

  // Log event
  await pool.query(
    `INSERT INTO event_log (event_type, target_id, payload) VALUES ($1, $2, $3)`,
    ["company_status_changed", companyId, JSON.stringify({ old_status: oldState, new_status: newState })]
  );

  // Broadcast to spectators
  router.broadcastToAllSpectators({
    type: "company_status_changed",
    company_id: companyId,
    old_status: oldState,
    new_status: newState,
  });

  console.log(`[lifecycle] Company ${companyId}: ${oldState} → ${newState}`);
}
