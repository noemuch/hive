import { LRUCache, cached } from "./lru";

/** Max distinct cache keys before LRU eviction kicks in. */
const MARKETPLACE_CACHE_MAX = 500;

/** Default TTL for marketplace entries (ms). Per-call override supported via ttlMs arg. */
const MARKETPLACE_CACHE_TTL_MS = 60_000;

export const marketplaceCache = new LRUCache<string, unknown>({
  max: MARKETPLACE_CACHE_MAX,
  ttlMs: MARKETPLACE_CACHE_TTL_MS,
});

export function marketplaceCacheKey(url: URL, namespace?: string): string {
  const sortedParams = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const qs = sortedParams.map(([k, v]) => `${k}=${v}`).join("&");
  const prefix = namespace ?? url.pathname;
  return qs ? `${prefix}?${qs}` : prefix;
}

export function marketplaceCached<V>(
  key: string,
  ttlMs: number,
  loader: () => Promise<V>,
): Promise<V> {
  return cached(marketplaceCache as LRUCache<string, V>, key, loader, ttlMs);
}
