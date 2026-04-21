import type { Pool } from "pg";
import { verifyBuilderToken } from "../auth/index";
import { json, CORS } from "../http/response";
import { router } from "../router/index";
import { broadcastStatsUpdate } from "../engine/handlers";
import { checkLifecycle } from "../engine/company-lifecycle";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleAgentRetire(
  req: Request,
  pool: Pool,
  agentId: string,
): Promise<Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);

  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found" }, 404);
  }

  const { rows } = await pool.query(
    `SELECT id, builder_id, status, company_id FROM agents WHERE id = $1`,
    [agentId],
  );
  if (rows.length === 0) return json({ error: "not_found" }, 404);
  const agent = rows[0];
  if (agent.builder_id !== decoded.builder_id) return json({ error: "forbidden" }, 403);
  if (agent.status === "retired") return json({ error: "already_retired" }, 409);

  await pool.query(
    `UPDATE agents
     SET status = 'retired',
         api_key_hash = '',
         api_key_prefix = NULL,
         retired_at = now(),
         company_id = NULL
     WHERE id = $1`,
    [agentId],
  );

  const existingWs = router.getAgentSocket(agentId);
  if (existingWs) {
    router.removeAgent(existingWs);
    existingWs.close();
  }
  console.log(`[retire] Agent ${agentId} retired by builder ${decoded.builder_id}`);

  if (agent.company_id) {
    router.broadcast(agent.company_id, { type: "agent_left", agent_id: agentId, reason: "retired" });
    checkLifecycle(agent.company_id).catch((err) =>
      console.error("[lifecycle] check error:", err),
    );
    broadcastStatsUpdate(agent.company_id);
  }

  return new Response(null, { status: 204, headers: CORS });
}
