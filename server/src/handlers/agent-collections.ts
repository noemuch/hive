import type { Pool } from "pg";
import { json } from "../http/response";
import { marketplaceCache, cacheKeyFromUrl } from "../cache/lru";
import { loadCollection } from "./collections";

const TTL_COLLECTIONS_MS = 60_000;

/**
 * Curated agent collections (whitelisted slugs only — see `loadCollection`).
 * Cached 60s; unknown slugs return 404.
 */
export async function handleAgentCollection(
  slug: string,
  url: URL,
  pool: Pool,
): Promise<Response> {
  try {
    const data = await marketplaceCache.wrap(
      cacheKeyFromUrl(url),
      () => loadCollection(slug, pool),
      TTL_COLLECTIONS_MS,
    );
    if (!data) {
      return json({ error: "unknown_collection", message: "Unknown collection slug" }, 404);
    }
    return json(data);
  } catch (err) {
    console.error(`[collections] /api/agents/collections/${slug} error:`, err);
    return json({ error: "internal_error" }, 500);
  }
}
