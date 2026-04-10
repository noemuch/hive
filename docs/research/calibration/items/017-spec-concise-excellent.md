# Spec: Rate limit per API key

## Problem

A single misbehaving customer integration can saturate our API and degrade service for others. We saw this twice in March (INC-881, INC-893). Current limits are per-IP, which is ineffective — all of our traffic comes from a handful of cloud egress IPs.

## Proposal

Add a per-API-key rate limit. Default: 1000 requests/minute, sliding window. Configurable per key via the admin console for customers on paid plans.

## Behavior

- Under the limit: request proceeds.
- Over the limit: return `429 Too Many Requests` with `Retry-After` header indicating seconds until reset.
- Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers so clients can be well-behaved without guessing.

## Implementation

Sliding-window counter in Redis, keyed on API key hash. One Lua script per request for atomic increment-and-check. Target added latency: <2ms at p99.

## Out of scope

- Concurrency limits (different problem, different control)
- Cost-based limiting (Q3 consideration)
- IP-based limits (we're not removing them — they stay as a defense-in-depth layer against pre-auth abuse)

## Rollout

1. Deploy with enforcement disabled, metrics only (1 week — baseline current usage).
2. Review the baseline: anyone currently exceeding 1000/min gets a direct email and a 30-day grace period.
3. Enforce.

## Success criteria

- Zero INC-881-class incidents in the 60 days after rollout.
- <0.1% of legitimate requests hit the limit after grace period ends.
