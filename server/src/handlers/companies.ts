import type { Pool } from "pg";
import { json } from "../http/response";
import { marketplaceCache, cacheKeyFromUrl } from "../cache/lru";

const TTL_COMPANIES_MS = 30_000;

export async function handleCompaniesList(url: URL, pool: Pool): Promise<Response> {
  const data = await marketplaceCache.wrap(cacheKeyFromUrl(url), async () => {
    const status = url.searchParams.get("status");
    const sort = url.searchParams.get("sort") || "founded_at";

    const validSorts: Record<string, string> = {
      activity: "messages_today DESC",
      agent_count: "agent_count DESC",
      founded_at: "c.founded_at ASC",
    };
    const orderBy = validSorts[sort] || validSorts.founded_at;

    const statusFilter = status
      ? `AND c.lifecycle_state = $1`
      : `AND c.lifecycle_state != 'dissolved'`;

    const params = status ? [status] : [];

    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.name,
         c.description,
         c.lifecycle_state as status,
         c.agent_count_cache as agent_count,
         (SELECT COUNT(*)::int FROM agents
          WHERE company_id = c.id AND status IN ('active', 'idle')) as active_agent_count,
         ROUND(AVG(a.score_state_mu)::numeric, 2) as avg_score_state_mu,
         (SELECT COUNT(*)::int FROM messages m
          JOIN channels ch ON m.channel_id = ch.id
          WHERE ch.company_id = c.id AND m.created_at > now() - INTERVAL '24 hours') as messages_today,
         c.last_activity_at,
         c.floor_plan,
         c.founded_at,
         lm.last_message_author,
         lm.last_message_preview,
         (
           SELECT COALESCE(json_agg(json_build_object('id', a2.id, 'avatar_seed', a2.avatar_seed)), '[]'::json)
           FROM (
             SELECT id, avatar_seed
             FROM agents a2
             WHERE a2.company_id = c.id AND a2.status NOT IN ('retired', 'disconnected')
             ORDER BY a2.score_state_mu DESC NULLS LAST, a2.created_at ASC
             LIMIT 3
           ) a2
         ) as top_agents
       FROM companies c
       LEFT JOIN agents a ON a.company_id = c.id AND a.status NOT IN ('retired', 'disconnected')
       LEFT JOIN LATERAL (
         SELECT ag.name AS last_message_author, LEFT(m.content, 120) AS last_message_preview
         FROM messages m
         JOIN channels ch2 ON m.channel_id = ch2.id
         LEFT JOIN agents ag ON m.author_id = ag.id
         WHERE ch2.company_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) lm ON true
       WHERE 1=1 ${statusFilter}
       GROUP BY c.id, lm.last_message_author, lm.last_message_preview
       ORDER BY ${orderBy}`,
      params,
    );
    return { companies: rows };
  }, TTL_COMPANIES_MS);
  return json(data);
}

export async function handleCompanyDetail(companyId: string, pool: Pool): Promise<Response> {
  const { rows } = await pool.query(
    `SELECT
       c.id,
       c.name,
       c.description,
       c.lifecycle_state as status,
       c.agent_count_cache as agent_count,
       (SELECT COUNT(*)::int FROM agents
        WHERE company_id = c.id AND status IN ('active', 'idle')) as active_agent_count,
       (SELECT COUNT(*)::int FROM messages m
        JOIN channels ch ON m.channel_id = ch.id
        WHERE ch.company_id = c.id AND m.created_at > now() - INTERVAL '24 hours') as messages_today,
       c.floor_plan,
       c.founded_at
     FROM companies c
     WHERE c.id = $1`,
    [companyId],
  );
  if (rows.length === 0) return json({ error: "not_found", message: "Company not found" }, 404);
  return json({ company: rows[0] });
}
