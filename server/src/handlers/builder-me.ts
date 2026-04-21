import type { Pool } from "pg";
import { verifyBuilderToken, verifyPassword, hashPassword } from "../auth/index";
import { json } from "../http/response";
import { TIER_LIMITS } from "../constants";
import { validateSocials } from "../router/rate-limit";

export async function handleBuilderMeGet(req: Request, pool: Pool): Promise<Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
  const { rows } = await pool.query(
    `SELECT b.id, b.email, b.display_name, b.tier, b.email_verified, b.created_at, b.socials,
      COUNT(a.id) FILTER (WHERE a.status NOT IN ('retired','disconnected'))::int AS agent_count,
      COUNT(a.id) FILTER (WHERE a.status = 'active')::int AS active_agent_count
     FROM builders b
     LEFT JOIN agents a ON a.builder_id = b.id
     WHERE b.id = $1
     GROUP BY b.id`,
    [decoded.builder_id],
  );
  if (rows.length === 0) return json({ error: "not_found", message: "Builder not found" }, 404);
  const row = rows[0];
  return json({
    builder: {
      ...row,
      tier_limit: TIER_LIMITS[row.tier] === Infinity ? -1 : (TIER_LIMITS[row.tier] ?? 3),
    },
  });
}

export async function handleBuilderMePatch(req: Request, pool: Pool): Promise<Response> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return json({ error: "unauthorized", message: "Unauthorized" }, 401);

  const payload = verifyBuilderToken(token);
  if (!payload) return json({ error: "unauthorized", message: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid body" }, 400);

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string" || body.display_name.trim().length < 2) {
      return json(
        { error: "validation_error", message: "Display name must be at least 2 characters" },
        400,
      );
    }
    updates.push(`display_name = $${paramIndex++}`);
    values.push(body.display_name.trim());
  }

  if (body.email !== undefined) {
    if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return json({ error: "validation_error", message: "Invalid email address" }, 400);
    }
    const existing = await pool.query(
      "SELECT id FROM builders WHERE email = $1 AND id != $2",
      [body.email, payload.builder_id],
    );
    if (existing.rows.length > 0) {
      return json({ error: "email_taken", message: "This email is already registered" }, 409);
    }
    updates.push(`email = $${paramIndex++}`);
    values.push(body.email);
  }

  if (body.socials !== undefined) {
    const socialsError = validateSocials(body.socials);
    if (socialsError) {
      return json({ error: "validation_error", message: socialsError }, 400);
    }
    updates.push(`socials = $${paramIndex++}`);
    values.push(JSON.stringify(body.socials));
  }

  if (body.new_password !== undefined || body.current_password !== undefined) {
    if (!body.current_password || !body.new_password) {
      return json(
        { error: "validation_error", message: "Both current_password and new_password are required" },
        400,
      );
    }
    if (typeof body.new_password !== "string" || body.new_password.length < 8) {
      return json(
        { error: "validation_error", message: "New password must be at least 8 characters" },
        400,
      );
    }
    const { rows: builderRows } = await pool.query(
      "SELECT password_hash FROM builders WHERE id = $1",
      [payload.builder_id],
    );
    if (builderRows.length === 0) return json({ error: "not_found" }, 404);
    const valid = await verifyPassword(body.current_password, builderRows[0].password_hash);
    if (!valid) return json({ error: "wrong_password", message: "Incorrect current password" }, 403);
    updates.push(`password_hash = $${paramIndex++}`);
    values.push(await hashPassword(body.new_password));
  }

  if (updates.length === 0) {
    return json({ error: "validation_error", message: "No fields to update" }, 400);
  }

  updates.push(`updated_at = now()`);
  values.push(payload.builder_id);

  const { rows } = await pool.query(
    `UPDATE builders SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING id, email, display_name, tier, email_verified, created_at, socials`,
    values,
  );

  return json({ builder: rows[0] });
}
