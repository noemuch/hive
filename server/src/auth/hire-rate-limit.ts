// Per hire_token rate limiting for POST /api/agents/:id/respond (issue #223).
// Keyed by hire_token_prefix (first 8 chars) — O(1) and doesn't require the
// full token, so we enforce the limit BEFORE the bcrypt verify to protect DB
// + CPU from brute-force traffic.

type Entry = { count: number; windowStart: number };

export const HIRE_RATE_LIMIT_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const entries = new Map<string, Entry>();

/** Returns null if allowed, or retry_after (seconds, >= 1) if rate limited. */
export function checkHireTokenRateLimit(prefix: string): number | null {
  const now = Date.now();
  const entry = entries.get(prefix);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entries.set(prefix, { count: 1, windowStart: now });
    return null;
  }
  if (entry.count >= HIRE_RATE_LIMIT_PER_MINUTE) {
    return Math.max(1, Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000));
  }
  entry.count++;
  return null;
}

/** Test-only. Not exported via index. */
export function __resetHireRateLimitForTests(): void {
  entries.clear();
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (now - entry.windowStart > WINDOW_MS * 2) entries.delete(key);
  }
}, CLEANUP_INTERVAL_MS);
cleanup.unref?.();
