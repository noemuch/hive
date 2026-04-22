import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LruCache, cacheKeyFromUrl } from "../lru";

describe("LruCache", () => {
  describe("basic get/set", () => {
    it("returns undefined on miss", () => {
      const c = new LruCache<string>({ max: 10, ttlMs: 1000 });
      expect(c.get("nope")).toBeUndefined();
    });

    it("returns stored value on hit", () => {
      const c = new LruCache<string>({ max: 10, ttlMs: 1000 });
      c.set("k", "v");
      expect(c.get("k")).toBe("v");
    });

    it("updates existing key without growing size", () => {
      const c = new LruCache<string>({ max: 10, ttlMs: 1000 });
      c.set("k", "v1");
      c.set("k", "v2");
      expect(c.get("k")).toBe("v2");
      expect(c.size).toBe(1);
    });
  });

  describe("TTL expiry", () => {
    it("expires entries after ttlMs", async () => {
      const c = new LruCache<string>({ max: 10, ttlMs: 20 });
      c.set("k", "v");
      expect(c.get("k")).toBe("v");
      await Bun.sleep(30);
      expect(c.get("k")).toBeUndefined();
    });

    it("treats expired entries as evictable (size decrements on read)", async () => {
      const c = new LruCache<string>({ max: 10, ttlMs: 20 });
      c.set("k", "v");
      expect(c.size).toBe(1);
      await Bun.sleep(30);
      c.get("k"); // triggers lazy eviction
      expect(c.size).toBe(0);
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entry when at capacity", () => {
      const c = new LruCache<string>({ max: 2, ttlMs: 1000 });
      c.set("a", "1");
      c.set("b", "2");
      c.set("c", "3");
      expect(c.get("a")).toBeUndefined();
      expect(c.get("b")).toBe("2");
      expect(c.get("c")).toBe("3");
      expect(c.size).toBe(2);
    });

    it("moves touched key to most-recently-used position", () => {
      const c = new LruCache<string>({ max: 2, ttlMs: 1000 });
      c.set("a", "1");
      c.set("b", "2");
      c.get("a"); // bump a to MRU
      c.set("c", "3"); // should evict b, not a
      expect(c.get("a")).toBe("1");
      expect(c.get("b")).toBeUndefined();
      expect(c.get("c")).toBe("3");
    });
  });

  describe("wrap helper (single-flight loader)", () => {
    it("calls loader on miss, caches, and reuses on hit", async () => {
      const c = new LruCache<{ v: number }>({ max: 10, ttlMs: 1000 });
      let calls = 0;
      const loader = async () => {
        calls++;
        return { v: 42 };
      };
      const r1 = await c.wrap("k", loader);
      const r2 = await c.wrap("k", loader);
      expect(r1.v).toBe(42);
      expect(r2.v).toBe(42);
      expect(calls).toBe(1);
    });

    it("coalesces concurrent loaders for the same key (single-flight)", async () => {
      const c = new LruCache<number>({ max: 10, ttlMs: 1000 });
      let calls = 0;
      const loader = async () => {
        calls++;
        await Bun.sleep(10);
        return 7;
      };
      const [a, b, d] = await Promise.all([
        c.wrap("k", loader),
        c.wrap("k", loader),
        c.wrap("k", loader),
      ]);
      expect(a).toBe(7);
      expect(b).toBe(7);
      expect(d).toBe(7);
      expect(calls).toBe(1);
    });

    it("does not cache when loader rejects", async () => {
      const c = new LruCache<number>({ max: 10, ttlMs: 1000 });
      let calls = 0;
      const failing = async () => {
        calls++;
        throw new Error("boom");
      };
      await expect(c.wrap("k", failing)).rejects.toThrow("boom");
      await expect(c.wrap("k", failing)).rejects.toThrow("boom");
      expect(calls).toBe(2);
      expect(c.size).toBe(0);
    });
  });

  describe("clear + delete", () => {
    it("delete removes a single key", () => {
      const c = new LruCache<string>({ max: 10, ttlMs: 1000 });
      c.set("a", "1");
      c.set("b", "2");
      c.delete("a");
      expect(c.get("a")).toBeUndefined();
      expect(c.get("b")).toBe("2");
    });

    it("clear empties the cache", () => {
      const c = new LruCache<string>({ max: 10, ttlMs: 1000 });
      c.set("a", "1");
      c.set("b", "2");
      c.clear();
      expect(c.size).toBe(0);
      expect(c.get("a")).toBeUndefined();
    });
  });
});

describe("cacheKeyFromUrl", () => {
  it("produces a stable key for identical URLs", () => {
    const u1 = new URL("http://h/api/leaderboard?a=1&b=2");
    const u2 = new URL("http://h/api/leaderboard?a=1&b=2");
    expect(cacheKeyFromUrl(u1)).toBe(cacheKeyFromUrl(u2));
  });

  it("is order-insensitive for query params", () => {
    const u1 = new URL("http://h/api/leaderboard?a=1&b=2");
    const u2 = new URL("http://h/api/leaderboard?b=2&a=1");
    expect(cacheKeyFromUrl(u1)).toBe(cacheKeyFromUrl(u2));
  });

  it("differentiates different paths", () => {
    const u1 = new URL("http://h/api/bureaux");
    const u2 = new URL("http://h/api/leaderboard");
    expect(cacheKeyFromUrl(u1)).not.toBe(cacheKeyFromUrl(u2));
  });

  it("differentiates different query values", () => {
    const u1 = new URL("http://h/api/leaderboard?dimension=quality");
    const u2 = new URL("http://h/api/leaderboard");
    expect(cacheKeyFromUrl(u1)).not.toBe(cacheKeyFromUrl(u2));
  });
});
