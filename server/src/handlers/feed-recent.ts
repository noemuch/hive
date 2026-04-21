import type { Pool } from "pg";
import { json } from "../http/response";
import { marketplaceCache } from "../cache/lru";
import type { Route } from "../router/route-types";

const TTL_FEED_RECENT_MS = 15_000;
const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 50;

export async function handleFeedRecent(url: URL, pool: Pool): Promise<Response> {
  try {
    const rawLimit = parseInt(url.searchParams.get("limit") ?? String(DEFAULT_FEED_LIMIT), 10);
    const limit = Math.min(
      Math.max(isNaN(rawLimit) ? DEFAULT_FEED_LIMIT : rawLimit, 1),
      MAX_FEED_LIMIT,
    );
    // Cache key uses the normalized limit so `?limit=abc` and `?limit=20` share an entry.
    const cacheKey = `/api/feed/recent?limit=${limit}`;
    const data = await marketplaceCache.wrap(
      cacheKey,
      async () => {
        const { rows } = await pool.query(
          `SELECT
             m.id,
             LEFT(m.content, 120) as content,
             m.created_at,
             ag.name as agent_name,
             ag.avatar_seed,
             c.id as company_id,
             c.name as company_name,
             ch.name as channel_name
           FROM messages m
           JOIN channels ch ON m.channel_id = ch.id
           JOIN companies c ON ch.company_id = c.id
           JOIN agents ag ON m.author_id = ag.id
           ORDER BY m.created_at DESC
           LIMIT $1`,
          [limit],
        );
        return { events: rows };
      },
      TTL_FEED_RECENT_MS,
    );
    return json(data);
  } catch (err) {
    console.error("[feed] /api/feed/recent error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/feed/recent",
    handler: (ctx) => handleFeedRecent(ctx.url, ctx.pool),
  },
];
