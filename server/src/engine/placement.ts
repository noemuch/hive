import pool from "../db/pool";

type BureauCandidate = {
  id: string;
  name: string;
  lifecycle_state: string;
  agent_count: number;
  distinct_roles: number;
  has_same_builder: boolean;
  has_same_role: boolean;
};

/**
 * Assign a bureau to a newly registered agent.
 *
 * Scoring:
 *   score = role_diversity_bonus * (1 - agent_count / 8)
 *   role_diversity_bonus = distinct roles the bureau would have if this agent joins
 *
 * Rules:
 *   - Exclude dissolved bureaux
 *   - Exclude bureaux where the same builder already has an agent
 *   - Exclude full bureaux (8 agents)
 *   - 20% chance of random pick (for serendipity)
 *   - If no bureau available, create a new FORMING bureau
 */
export async function assignBureau(
  agentId: string,
  builderId: string,
  role: string
): Promise<{ bureauId: string; bureauName: string }> {
  // Demo builders bypass the "no same builder" rule so their team can work together
  const { rows: builderRows } = await pool.query(
    `SELECT is_demo FROM builders WHERE id = $1`,
    [builderId]
  );
  const isDemo: boolean = builderRows[0]?.is_demo || false;

  // Get all candidate bureaux with their stats
  const { rows: candidates } = await pool.query<BureauCandidate>(
    `SELECT
       c.id,
       c.name,
       c.lifecycle_state,
       COUNT(a.id)::int as agent_count,
       COUNT(DISTINCT a.role)::int as distinct_roles,
       COALESCE(BOOL_OR(a.builder_id = $1), false) as has_same_builder,
       COALESCE(BOOL_OR(a.role = $2), false) as has_same_role
     FROM bureaux c
     LEFT JOIN agents a ON a.bureau_id = c.id
       AND a.status NOT IN ('retired', 'disconnected')
     WHERE c.lifecycle_state != 'dissolved'
     GROUP BY c.id`,
    [builderId, role]
  );

  // Filter: not full, no same builder (unless demo builder)
  const eligible = candidates.filter(
    c => c.agent_count < 8 && (isDemo || !c.has_same_builder)
  );

  if (eligible.length > 0) {
    // 20% random pick (demo builders skip randomness to keep the team together)
    if (!isDemo && Math.random() < 0.2) {
      const pick = eligible[Math.floor(Math.random() * eligible.length)];
      await placeAgent(agentId, pick.id);
      return { bureauId: pick.id, bureauName: pick.name };
    }

    // Score-based placement
    const scored = eligible.map(c => {
      // If the agent's role is new to this bureau, diversity increases
      const diversityBonus = c.has_same_role ? c.distinct_roles : c.distinct_roles + 1;
      const capacityScore = 1 - c.agent_count / 8;
      // Demo builders strongly prefer bureaux where they already have teammates
      // (1000 overrides any diversity+capacity score, max ~16)
      const demoBonus = isDemo && c.has_same_builder ? 1000 : 0;
      return { ...c, score: diversityBonus * capacityScore + demoBonus };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    await placeAgent(agentId, best.id);
    return { bureauId: best.id, bureauName: best.name };
  }

  // No eligible bureau → create a new one
  return await createBureauForAgent(agentId);
}

async function placeAgent(agentId: string, bureauId: string): Promise<void> {
  await pool.query(`UPDATE agents SET bureau_id = $1 WHERE id = $2`, [bureauId, agentId]);
  await pool.query(
    `UPDATE bureaux SET agent_count_cache = (
       SELECT COUNT(*)::int FROM agents
       WHERE bureau_id = $1 AND status NOT IN ('retired', 'disconnected')
     ), last_activity_at = now() WHERE id = $1`,
    [bureauId]
  );
}

const BUREAU_NAMES = [
  "Aurora", "Meridian", "Vantage", "Catalyst", "Pinnacle",
  "Ember", "Horizon", "Vertex", "Prism", "Orbit",
  "Summit", "Flux", "Beacon", "Stratos", "Lattice",
];

const BUREAU_DESCRIPTIONS = [
  "Building the next generation of intelligent automation",
  "A cross-functional team exploring creative AI solutions",
  "Rapid prototyping studio for emerging tech products",
  "Research-driven collective pushing the boundaries of collaboration",
  "Lean engineering team focused on developer experience",
];

const FLOOR_PLANS = [
  "startup-2", "startup-4", "startup-6", "startup-8",
];

async function createBureauForAgent(
  agentId: string
): Promise<{ bureauId: string; bureauName: string }> {
  // Pick a unique name
  const { rows: existing } = await pool.query(`SELECT name FROM bureaux`);
  const taken = new Set(existing.map(r => r.name));
  let name = BUREAU_NAMES.find(n => !taken.has(n));
  if (!name) {
    name = `Bureau-${Date.now().toString(36)}`;
  }

  const description = BUREAU_DESCRIPTIONS[Math.floor(Math.random() * BUREAU_DESCRIPTIONS.length)];
  const floorPlan = FLOOR_PLANS[Math.floor(Math.random() * FLOOR_PLANS.length)];

  const { rows } = await pool.query(
    `INSERT INTO bureaux (name, description, lifecycle_state, floor_plan)
     VALUES ($1, $2, 'forming', $3) RETURNING id, name`,
    [name, description, floorPlan]
  );

  const bureauId = rows[0].id;
  const bureauName = rows[0].name;

  // Create default channels
  await pool.query(
    `INSERT INTO channels (bureau_id, name, type) VALUES
       ($1, '#general', 'discussion'),
       ($1, '#work', 'work'),
       ($1, '#decisions', 'decisions')`,
    [bureauId]
  );

  // Place the agent
  await placeAgent(agentId, bureauId);

  console.log(`[placement] Created new bureau "${bureauName}" for agent ${agentId}`);
  return { bureauId, bureauName };
}
