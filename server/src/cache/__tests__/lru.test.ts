import { describe, it, expect } from "bun:test";
import { LRUCache, cached } from "../lru";

describe("LRUCache", () => {
  it("returns undefined on miss", () => {
    const cache = new LRUCache<string, number>({ max: 10, ttlMs: 1000 });
    expect(cache.get("absent")).toBeUndefined();
  });

  it("returns set value on hit within TTL", () => {
    const cache = new LRUCache<string, number>({ max: 10, ttlMs: 1000 });
    cache.set("k", 42);
    expect(cache.get("k")).toBe(42);
  });

  it("expires entries after TTL", () => {
    let now = 1_000_000;
    const cache = new LRUCache<string, number>({ max: 10, ttlMs: 100, now: () => now });
    cache.set("k", 42);
    now += 50;
    expect(cache.get("k")).toBe(42);
    now += 60;
    expect(cache.get("k")).toBeUndefined();
  });

  it("evicts least-recently-used entry when max exceeded", () => {
    const cache = new LRUCache<string, number>({ max: 2, ttlMs: 10_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("updates recency on get so recently-accessed entries survive eviction", () => {
    const cache = new LRUCache<string, number>({ max: 2, ttlMs: 10_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  it("overwrites existing key without growing size past max", () => {
    const cache = new LRUCache<string, number>({ max: 2, ttlMs: 10_000 });
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("clear() empties the cache", () => {
    const cache = new LRUCache<string, number>({ max: 10, ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("cached()", () => {
  it("calls loader on miss, caches result on hit", async () => {
    const cache = new LRUCache<string, number>({ max: 10, ttlMs: 1000 });
    let calls = 0;
    const loader = async () => { calls++; return 7; };
    expect(await cached(cache, "k", loader)).toBe(7);
    expect(await cached(cache, "k", loader)).toBe(7);
    expect(calls).toBe(1);
  });

  it("re-invokes loader after TTL expiry", async () => {
    let now = 1_000_000;
    const cache = new LRUCache<string, number>({ max: 10, ttlMs: 100, now: () => now });
    let calls = 0;
    const loader = async () => { calls++; return calls; };
    expect(await cached(cache, "k", loader)).toBe(1);
    now += 150;
    expect(await cached(cache, "k", loader)).toBe(2);
  });

  it("honors per-entry ttlMs override", async () => {
    let now = 1_000_000;
    const cache = new LRUCache<string, number>({ max: 10, ttlMs: 10_000, now: () => now });
    let calls = 0;
    const loader = async () => { calls++; return calls; };
    await cached(cache, "k", loader, 50);
    now += 100;
    await cached(cache, "k", loader, 50);
    expect(calls).toBe(2);
  });
});
