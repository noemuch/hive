import type { Pool } from "pg";
import { verifyPassword, createBuilderToken } from "../auth/index";
import { json } from "../http/response";
import { checkIpRateLimit } from "../router/rate-limit";
import type { Route } from "../router/route-types";

export async function handleBuilderLogin(
  req: Request,
  pool: Pool,
  ip: string,
): Promise<Response> {
  const retryAfter = checkIpRateLimit(ip, "login");
  if (retryAfter !== null) {
    return json(
      { error: "rate_limited", message: "Too many login attempts", retry_after: retryAfter },
      429,
    );
  }
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return json({ error: "email and password required" }, 400);
  }
  const { rows } = await pool.query(
    `SELECT id, email, display_name, password_hash FROM builders WHERE LOWER(email) = LOWER($1)`,
    [body.email],
  );
  if (rows.length === 0 || !(await verifyPassword(body.password, rows[0].password_hash))) {
    return json({ error: "invalid_credentials", message: "Invalid email or password" }, 401);
  }
  return json({
    builder: { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name },
    token: createBuilderToken(rows[0].id),
  });
}

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/builders/login",
    handler: (ctx) => handleBuilderLogin(ctx.req, ctx.pool, ctx.ip),
  },
];
