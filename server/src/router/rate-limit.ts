type RateLimitEntry = {
  count: number;
  windowStart: number;
};

const LIMITS: Record<string, { max: number; windowMs: number }> = {
  send_message: { max: 30, windowMs: 60 * 60 * 1000 }, // 30/hour
  send_message_public: { max: 2, windowMs: 60 * 1000 }, // 2/minute for #public
  add_reaction: { max: 60, windowMs: 60 * 60 * 1000 }, // 60/hour
  heartbeat: { max: 2, windowMs: 60 * 1000 }, // 2/minute (generous)
  create_artifact: { max: 10, windowMs: 60 * 60 * 1000 }, // 10/hour
  update_artifact: { max: 30, windowMs: 60 * 60 * 1000 }, // 30/hour
  review_artifact: { max: 20, windowMs: 60 * 60 * 1000 }, // 20/hour
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

// ---- IP-based rate limiting (unauthenticated endpoints) ----

const IP_LIMITS: Record<string, { max: number; windowMs: number }> = {
  login: { max: 10, windowMs: 15 * 60 * 1000 },   // 10 attempts / 15 min
  register: { max: 5, windowMs: 60 * 60 * 1000 },  // 5 accounts / hour
};

const ipEntries = new Map<string, RateLimitEntry>();

/** IP-based rate limit for unauthenticated endpoints. Returns retry_after in seconds, or null if allowed. */
export function checkIpRateLimit(ip: string, action: string): number | null {
  const limit = IP_LIMITS[action];
  if (!limit) return null;

  const key = `${ip}:${action}`;
  const now = Date.now();
  const entry = ipEntries.get(key);

  if (!entry || now - entry.windowStart > limit.windowMs) {
    ipEntries.set(key, { count: 1, windowStart: now });
    return null;
  }

  if (entry.count >= limit.max) {
    return Math.ceil((entry.windowStart + limit.windowMs - now) / 1000);
  }

  entry.count++;
  return null;
}

// ---- Shared helpers ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUUID(s: string): boolean {
  return UUID_RE.test(s);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}

const VALID_SOCIAL_KEYS = new Set(["github", "twitter", "linkedin", "website"]);
const MAX_SOCIAL_VALUE_LENGTH = 200;

export function validateSocials(socials: unknown): string | null {
  if (typeof socials !== "object" || socials === null || Array.isArray(socials)) {
    return "socials must be an object";
  }
  for (const [key, value] of Object.entries(socials as Record<string, unknown>)) {
    if (!VALID_SOCIAL_KEYS.has(key)) return `invalid social key: ${key}`;
    if (typeof value !== "string") return `social ${key} must be a string`;
    if (value.length > MAX_SOCIAL_VALUE_LENGTH) return `social ${key} exceeds ${MAX_SOCIAL_VALUE_LENGTH} chars`;
  }
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
  // Also cleanup IP entries
  for (const [key, entry] of ipEntries) {
    const action = key.split(":")[1];
    const limit = IP_LIMITS[action];
    if (limit && now - entry.windowStart > limit.windowMs * 2) {
      ipEntries.delete(key);
    }
  }
}, 10 * 60 * 1000);
