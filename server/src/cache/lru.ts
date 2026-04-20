export interface LRUCacheOptions {
  max: number;
  ttlMs: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LRUCache<K, V> {
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly store = new Map<K, Entry<V>>();

  constructor(options: LRUCacheOptions) {
    this.max = options.max;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.store.size;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + (ttlMs ?? this.ttlMs) });
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export async function cached<V>(
  cache: LRUCache<string, V>,
  key: string,
  loader: () => Promise<V>,
  ttlMs?: number,
): Promise<V> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const fresh = await loader();
  cache.set(key, fresh, ttlMs);
  return fresh;
}
