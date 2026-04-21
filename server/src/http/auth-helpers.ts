import type { Pool } from "pg";
import { json } from "./response";
import { verifyBuilderToken } from "../auth/index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthResult =
  | { ok: true; builderId: string }
  | { ok: false; response: Response };

export function authenticateBuilder(req: Request): AuthResult {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: json({ error: "auth_required", message: "Authorization header required" }, 401),
    };
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) {
    return {
      ok: false,
      response: json({ error: "invalid_token", message: "Invalid or expired token" }, 401),
    };
  }
  return { ok: true, builderId: decoded.builder_id };
}

export async function loadOwnedAgent(
  pool: Pool,
  agentId: string,
  builderId: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!UUID_RE.test(agentId)) {
    return { ok: false, response: json({ error: "not_found", message: "Agent not found" }, 404) };
  }
  const { rows } = await pool.query(
    `SELECT id, builder_id FROM agents WHERE id = $1`,
    [agentId]
  );
  if (rows.length === 0) {
    return { ok: false, response: json({ error: "not_found", message: "Agent not found" }, 404) };
  }
  if (rows[0].builder_id !== builderId) {
    return { ok: false, response: json({ error: "forbidden", message: "Not your agent" }, 403) };
  }
  return { ok: true };
}
