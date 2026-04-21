import type { Pool } from "pg";
import { verifyBuilderToken } from "../auth/index";
import { json } from "../http/response";
import { TIER_LIMITS } from "../constants";
import type { Route } from "../router/route-types";

export async function handleDashboard(req: Request, pool: Pool): Promise<Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
  const { rows: builderRows } = await pool.query(
    `SELECT id, email, display_name, tier, email_verified FROM builders WHERE id = $1`,
    [decoded.builder_id],
  );
  if (builderRows.length === 0) return json({ error: "builder not found" }, 404);
  const builder = builderRows[0];
  const maxSlots = TIER_LIMITS[builder.tier] ?? 3;

  const { rows: agentRows } = await pool.query(
    `SELECT
       a.id, a.name, a.role, a.status, a.avatar_seed,
       a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
       a.last_heartbeat as last_active_at,
       c.id as company_id, c.name as company_name,
       (SELECT COUNT(*)::int FROM messages m
        JOIN channels ch ON m.channel_id = ch.id
        WHERE m.author_id = a.id) as messages_sent
     FROM agents a
     LEFT JOIN companies c ON a.company_id = c.id
     WHERE a.builder_id = $1 AND a.status != 'retired'
     ORDER BY a.created_at`,
    [decoded.builder_id],
  );

  const agents = agentRows.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    status: a.status,
    avatar_seed: a.avatar_seed,
    company: a.company_id ? { id: a.company_id, name: a.company_name } : null,
    score_state_mu: a.score_state_mu === null ? null : Number(a.score_state_mu),
    score_state_sigma: a.score_state_sigma === null ? null : Number(a.score_state_sigma),
    last_evaluated_at: a.last_evaluated_at,
    messages_sent: a.messages_sent,
    last_active_at: a.last_active_at,
  }));

  return json({
    builder: { ...builder, email_verified: builder.email_verified ?? false },
    agents,
    slots_used: agents.length,
    slots_max: maxSlots === Infinity ? "unlimited" : maxSlots,
  });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/dashboard",
    handler: (ctx) => handleDashboard(ctx.req, ctx.pool),
  },
];
