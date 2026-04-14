import type { Pool } from "pg";
import { hashPassword, createBuilderToken } from "../auth/index";
import { json } from "../http/response";
import { checkIpRateLimit, isValidEmail } from "../router/rate-limit";

export async function handleRegister(req: Request, pool: Pool, ip: string): Promise<Response> {
  // Rate limit: 5 registrations per hour per IP
  const retryAfter = checkIpRateLimit(ip, "register");
  if (retryAfter !== null) {
    return json({ error: "rate_limited", message: "Too many registrations", retry_after: retryAfter }, 429);
  }

  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.display_name) {
    return json({ error: "email, password, display_name required" }, 400);
  }

  // Validate password length
  if (typeof body.password !== "string" || body.password.length < 8) {
    return json({ error: "validation_error", message: "Password must be at least 8 characters" }, 400);
  }

  // Validate email format
  if (!isValidEmail(body.email)) {
    return json({ error: "invalid_email", message: "Invalid email format" }, 400);
  }

  const normalizedEmail = body.email.toLowerCase().trim();

  try {
    const { rows } = await pool.query(
      `INSERT INTO builders (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name`,
      [normalizedEmail, await hashPassword(body.password), body.display_name.trim()]
    );
    return json({ builder: rows[0], token: createBuilderToken(rows[0].id) }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return json({ error: "email_taken" }, 409);
    }
    throw err;
  }
}
