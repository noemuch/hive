# Sprint 0: Security Hardening — Design Spec

**Date:** 2026-04-13
**Status:** Draft
**Scope:** 9 security fixes required before production readiness
**Approach:** Fix in place (index.ts refactoring deferred to Sprint 1)

## Fixes

### Fix 1: Rate limit on /api/builders/login

**Problem:** No rate limiting. Brute force possible.
**Solution:** Add IP-based rate limit: 10 attempts per 15 minutes per IP. Return 429 with `Retry-After` header.
**Implementation:** New helper `checkIpRateLimit(ip, action)` in `server/src/router/rate-limit.ts` using a separate in-memory Map keyed by `${ip}:${action}`. The existing `checkRateLimit` is agent-scoped (keyed by agentId); this one is IP-scoped for unauthenticated endpoints.
**File:** `server/src/index.ts` (login route), `server/src/router/rate-limit.ts` (new function)

### Fix 2: Rate limit on /api/builders/register

**Problem:** No rate limiting. Spam account creation possible.
**Solution:** 5 registrations per hour per IP. Same `checkIpRateLimit` helper.
**File:** `server/src/handlers/register.ts`, `server/src/router/rate-limit.ts`

### Fix 3: UUID validation on spectator watch_company

**Problem:** `data.company_id` used directly in SQL without validation. SQL injection risk.
**Solution:** Validate against UUID v4 regex before query: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. Reject with error if invalid.
**File:** `server/src/index.ts` (spectator message handler)

### Fix 4: Email validation on registration

**Problem:** No email format validation. Invalid emails stored.
**Solution:** Validate with regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (same as PATCH endpoint). Normalize to lowercase before INSERT with `ON CONFLICT` check.
**File:** `server/src/handlers/register.ts`

### Fix 5: Case-insensitive email login

**Problem:** `WHERE email = $1` is case-sensitive. `Test@Example.com` and `test@example.com` are different accounts.
**Solution:** `WHERE LOWER(email) = LOWER($1)` in login query. Registration already normalizes to lowercase (Fix 4).
**File:** `server/src/index.ts` (login route)

### Fix 6: Validate socials structure

**Problem:** Builder socials JSONB accepts arbitrary nested objects. Stored XSS risk.
**Solution:** Whitelist allowed keys: `github`, `twitter`, `linkedin`, `website`. Each value must be a string, max 200 chars. Reject if any key is not whitelisted or value exceeds limit.
**File:** `server/src/index.ts` (PATCH /api/builders/me)

### Fix 7: Review comment length limit

**Problem:** `event.comment` in `review_artifact` has no length limit. DoS via giant strings.
**Solution:** `MAX_COMMENT_LENGTH = 2000`. Validate in handler, return error if exceeded.
**File:** `server/src/engine/handlers.ts`

### Fix 8: CI pipeline

**Problem:** No automated tests on push. Regressions ship undetected.
**Solution:** GitHub Actions workflow that runs:
- `cd server && bun test`
- `cd scripts/hear && bun test`
On every push to `main` and on PRs.
**File:** `.github/workflows/ci.yml`

### Fix 9: Backup script

**Problem:** No database backups. One bad migration = total data loss.
**Solution:** Script `scripts/backup-db.sh` that runs `pg_dump` to a timestamped file. Documented in README. Manual execution (Railway has no native cron for db backups).
**File:** `scripts/backup-db.sh`

## File change map

| File | Action | Fixes |
|------|--------|-------|
| `server/src/router/rate-limit.ts` | Modify | #1, #2 (add `checkIpRateLimit`) |
| `server/src/index.ts` | Modify | #1, #3, #5, #6 |
| `server/src/handlers/register.ts` | Modify | #2, #4 |
| `server/src/engine/handlers.ts` | Modify | #7 |
| `.github/workflows/ci.yml` | Create | #8 |
| `scripts/backup-db.sh` | Create | #9 |

## Testing

- Unit test for `checkIpRateLimit` (pass under limit, block over limit, window reset)
- Unit test for UUID validation regex
- Unit test for email validation + lowercase normalization
- Unit test for socials validation (good input, bad keys, long values)
- Existing tests must still pass
