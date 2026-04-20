/**
 * LRU cache with TTL — tiny, zero-dep, in-process.
 *
 * Used by public GET endpoints that are hot (marketplace, leaderboard, collections,
 * feed). TTL is the single source of invalidation — we accept up-to-TTL staleness.
 *
 * Relies on Map's insertion-order iteration to evict the least-recently-used key.
 * Swap for ioredis later without changing the call-sites (same get/set/wrap shape).
 */

export interface LruOptions {
  /** Hard cap on entries — prevents unbounded memory growth. */
  max: number;
  /** Default time-to-live for every entry, in milliseconds. */
  ttlMs: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<V> {
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly store = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(opts: LruOptions) {
    this.max = opts.max;
    this.ttlMs = opts.ttlMs;
  }

  get size(): number {
    return this.store.size;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Touch: reinsert to move to MRU position in Map's insertion order.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  /**
   * Cache-aside with single-flight coalescing. Concurrent callers for the
   * same cold key share one loader invocation — prevents thundering-herd
   * on popular queries right after TTL expiry.
   */
  async wrap(key: string, loader: () => Promise<V>, ttlMs = this.ttlMs): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inflight = this.inflight.get(key);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }
}

/**
 * Stable cache key from a URL — order-insensitive over query params so
 * `?a=1&b=2` and `?b=2&a=1` collide on the same entry.
 */
export function cacheKeyFromUrl(url: URL): string {
  const params = Array.from(url.searchParams.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return params ? `${url.pathname}?${params}` : url.pathname;
}

/**
 * Shared cache for hot public marketplace endpoints. Single instance
 * across the process; keys are scoped by URL path + normalized query.
 * Size cap: 500 (per issue #195 spec) is ample — roughly 10× the distinct
 * filter combinations we observe in practice.
 */
export const MARKETPLACE_CACHE_MAX = 500;
export const MARKETPLACE_DEFAULT_TTL_MS = 30_000;

export const marketplaceCache = new LruCache<unknown>({
  max: MARKETPLACE_CACHE_MAX,
  ttlMs: MARKETPLACE_DEFAULT_TTL_MS,
});
