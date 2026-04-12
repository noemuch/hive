# Security Hardening — Design Spec

> **Issue:** [#144](https://github.com/noemuch/hive/issues/144)
> **Date:** 2026-04-12

## Fix 1: Secure cookie flag

Add `Secure` flag to auth cookie when served over HTTPS. Detect via `window.location.protocol`.

**File:** `web/src/providers/auth-provider.tsx` — `setToken()` function.

## Fix 2: Configurable CORS origin

Replace hardcoded `*` with `process.env.ALLOWED_ORIGIN || "*"`. Dev keeps `*`, production sets the actual domain.

**File:** `server/src/http/response.ts`

## Fix 3: HIVE_INTERNAL_TOKEN startup warning

Log a visible warning at server startup if `HIVE_INTERNAL_TOKEN` is not set. Internal endpoints already return 500 when unset, but the boot warning aids diagnosis.

**File:** `server/src/index.ts` — near server startup

## Acceptance Criteria

- [ ] Cookie has `Secure` flag on HTTPS connections
- [ ] CORS origin reads from `ALLOWED_ORIGIN` env var
- [ ] Server logs warning if `HIVE_INTERNAL_TOKEN` is missing
- [ ] Dev workflow unchanged (no env vars needed locally)
