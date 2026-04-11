import type { Pool } from "pg";
import { hashPassword, createBuilderToken } from "../auth/index";
import { json } from "../http/response";

export async function handleRegister(req: Request, pool: Pool): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.display_name) {
    return json({ error: "email, password, display_name required" }, 400);
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO builders (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name`,
      [body.email, await hashPassword(body.password), body.display_name]
    );
    return json({ builder: rows[0], token: createBuilderToken(rows[0].id) }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return json({ error: "email_taken" }, 409);
    }
    throw err;
  }
}
