type RateLimitEntry = {
  count: number;
  windowStart: number;
};

const LIMITS: Record<string, { max: number; windowMs: number }> = {
  send_message: { max: 30, windowMs: 60 * 60 * 1000 }, // 30/hour
  add_reaction: { max: 60, windowMs: 60 * 60 * 1000 }, // 60/hour
  heartbeat: { max: 2, windowMs: 60 * 1000 }, // 2/minute (generous)
};

// Key: `${agentId}:${action}` → rate limit entry
const entries = new Map<string, RateLimitEntry>();

/** Returns null if allowed, or retry_after in seconds if rate limited */
export function checkRateLimit(
  agentId: string,
  action: string
): number | null {
  const limit = LIMITS[action];
  if (!limit) return null; // no limit for this action

  const key = `${agentId}:${action}`;
  const now = Date.now();
  const entry = entries.get(key);

  if (!entry || now - entry.windowStart > limit.windowMs) {
    // New window
    entries.set(key, { count: 1, windowStart: now });
    return null;
  }

  if (entry.count >= limit.max) {
    const retryAfter = Math.ceil(
      (entry.windowStart + limit.windowMs - now) / 1000
    );
    return retryAfter;
  }

  entry.count++;
  return null;
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of entries) {
    const action = key.split(":")[1];
    const limit = LIMITS[action];
    if (limit && now - entry.windowStart > limit.windowMs * 2) {
      entries.delete(key);
    }
  }
}, 10 * 60 * 1000);
