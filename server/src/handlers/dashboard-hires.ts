import type { Pool } from "pg";
import { verifyBuilderToken } from "../auth/index";
import { json } from "../http/response";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleDashboardHiresList(req: Request, pool: Pool): Promise<Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);

  try {
    const { rows: myHireRows } = await pool.query(
      `SELECT h.id, h.calls_count, h.created_at, h.expires_at, h.revoked_at,
              (SELECT COALESCE(SUM(c.llm_cost_estimate), 0)
                 FROM agent_hire_calls c WHERE c.hire_id = h.id) AS cost_estimate_usd,
              a.id AS agent_id, a.name AS agent_name, a.role AS agent_role, a.avatar_seed,
              co.id AS company_id, co.name AS company_name,
              b.id AS owner_id, b.display_name AS owner_name
         FROM agent_hires h
         JOIN agents a ON a.id = h.agent_id
         JOIN builders b ON b.id = a.builder_id
         LEFT JOIN companies co ON co.id = a.company_id
        WHERE h.hiring_builder_id = $1 AND h.revoked_at IS NULL
        ORDER BY h.created_at DESC
        LIMIT 100`,
      [decoded.builder_id],
    );

    const { rows: theirHireRows } = await pool.query(
      `SELECT h.id, h.calls_count, h.created_at, h.expires_at, h.revoked_at,
              (SELECT COALESCE(SUM(c.llm_cost_estimate), 0)
                 FROM agent_hire_calls c WHERE c.hire_id = h.id) AS cost_estimate_usd,
              a.id AS agent_id, a.name AS agent_name, a.role AS agent_role, a.avatar_seed,
              co.id AS company_id, co.name AS company_name,
              b.id AS hirer_id, b.display_name AS hirer_name
         FROM agent_hires h
         JOIN agents a ON a.id = h.agent_id
         JOIN builders b ON b.id = h.hiring_builder_id
         LEFT JOIN companies co ON co.id = a.company_id
        WHERE a.builder_id = $1 AND h.revoked_at IS NULL
        ORDER BY h.created_at DESC
        LIMIT 100`,
      [decoded.builder_id],
    );

    const mapRow = (row: Record<string, unknown>, counterpartKey: "owner" | "hirer") => ({
      id: row.id as string,
      agent: {
        id: row.agent_id as string,
        name: row.agent_name as string,
        role: row.agent_role as string,
        avatar_seed: row.avatar_seed as string,
      },
      company: row.company_id
        ? { id: row.company_id as string, name: row.company_name as string }
        : null,
      counterpart:
        counterpartKey === "owner"
          ? { id: row.owner_id as string, display_name: row.owner_name as string }
          : { id: row.hirer_id as string, display_name: row.hirer_name as string },
      calls_count: row.calls_count === null ? 0 : Number(row.calls_count),
      cost_estimate_usd: row.cost_estimate_usd === null ? 0 : Number(row.cost_estimate_usd),
      created_at: row.created_at as string,
      expires_at: row.expires_at as string | null,
    });

    return json({
      my_hires: myHireRows.map((r) => mapRow(r, "owner")),
      their_hires: theirHireRows.map((r) => mapRow(r, "hirer")),
    });
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      return json({ my_hires: [], their_hires: [] });
    }
    throw err;
  }
}

export async function handleDashboardHireRevoke(
  req: Request,
  pool: Pool,
  hireId: string,
): Promise<Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);

  if (!UUID_RE.test(hireId)) {
    return json({ error: "invalid_id", message: "Hire id must be a UUID" }, 400);
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE agent_hires
          SET revoked_at = now()
        WHERE id = $1 AND hiring_builder_id = $2 AND revoked_at IS NULL`,
      [hireId, decoded.builder_id],
    );
    if (rowCount === 0) return json({ error: "not_found", message: "Hire not found" }, 404);
    return json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      return json({ error: "not_found", message: "Hire not found" }, 404);
    }
    throw err;
  }
}
