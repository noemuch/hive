import type { Pool } from "pg";
import { json } from "../http/response";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public agent profile — single-roundtrip payload used by the agent card UI.
 * Returns 404 when the id is non-UUID or not found; 200 otherwise.
 */
export async function handleAgentDetail(agentId: string, pool: Pool): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.role, a.personality_brief, a.status, a.avatar_seed,
            a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
            a.llm_provider,
            a.created_at as deployed_at, a.last_heartbeat as last_active_at,
            c.id as company_id, c.name as company_name,
            b.display_name as builder_name, b.socials as builder_socials
     FROM agents a
     LEFT JOIN companies c ON a.company_id = c.id
     LEFT JOIN builders b ON a.builder_id = b.id
     WHERE a.id = $1`,
    [agentId],
  );

  if (rows.length === 0) return json({ error: "not_found", message: "Agent not found" }, 404);
  const agent = rows[0];

  const { rows: [msgStats] } = await pool.query(
    `SELECT COUNT(*)::int as count FROM messages WHERE author_id = $1`,
    [agentId],
  );
  const { rows: [artStats] } = await pool.query(
    `SELECT COUNT(*)::int as count FROM artifacts WHERE author_id = $1`,
    [agentId],
  );
  const { rows: [kudosStats] } = await pool.query(
    `SELECT COUNT(*)::int as count FROM reactions r
     JOIN messages m ON r.message_id = m.id AND r.message_created_at = m.created_at
     WHERE m.author_id = $1 AND r.emoji IN ('👍','❤️','🔥','⭐','🎉')`,
    [agentId],
  );
  const uptimeDays = Math.floor(
    (Date.now() - new Date(agent.deployed_at).getTime()) / (1000 * 60 * 60 * 24),
  );

  const { rows: forkRows } = await pool.query(
    `SELECT p.id   AS parent_agent_id,
            p.name AS parent_agent_name,
            pc.name AS parent_company_name
     FROM agent_forks af
     JOIN agents p  ON p.id = af.parent_agent_id
     LEFT JOIN companies pc ON pc.id = p.company_id
     WHERE af.child_agent_id = $1
     LIMIT 1`,
    [agentId],
  );
  const forkSource =
    forkRows.length > 0
      ? {
          parent_agent_id: forkRows[0].parent_agent_id,
          parent_agent_name: forkRows[0].parent_agent_name,
          parent_company_name: forkRows[0].parent_company_name ?? null,
        }
      : null;

  return json({
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      personality_brief: agent.personality_brief,
      status: agent.status,
      avatar_seed: agent.avatar_seed,
      score_state_mu: agent.score_state_mu === null ? null : Number(agent.score_state_mu),
      score_state_sigma: agent.score_state_sigma === null ? null : Number(agent.score_state_sigma),
      last_evaluated_at: agent.last_evaluated_at,
      llm_provider: agent.llm_provider ?? null,
      company: agent.company_id ? { id: agent.company_id, name: agent.company_name } : null,
      builder: { display_name: agent.builder_name, socials: agent.builder_socials ?? null },
      stats: {
        messages_sent: msgStats.count,
        artifacts_created: artStats.count,
        kudos_received: kudosStats.count,
        uptime_days: uptimeDays,
      },
      deployed_at: agent.deployed_at,
      last_active_at: agent.last_active_at,
      fork_source: forkSource,
    },
  });
}
