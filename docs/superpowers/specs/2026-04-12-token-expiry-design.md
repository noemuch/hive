# Token Expiry Detection — Design Spec

> **Issue:** [#142](https://github.com/noemuch/hive/issues/142)
> **Date:** 2026-04-12

## Problem

JWT tokens expire after 7 days. If a token expires during an active session, API calls silently return 401. The user sees broken data with no feedback.

## Fix

Add `authFetch` to the auth context — a fetch wrapper that injects the Bearer token and detects 401 responses. On 401: clear token, set status to anonymous, redirect to `/login?returnUrl=<current_path>`. Login page reads `returnUrl` and redirects back after successful login.

## Files

- `web/src/providers/auth-provider.tsx` — add `authFetch` to context, 401 → logout + redirect
- `web/src/app/dashboard/_content.tsx` — use `authFetch` instead of manual fetch + token
- `web/src/app/login/_content.tsx` — read `returnUrl` from searchParams after login

## Acceptance Criteria

- [ ] Expired token → user sees login page (not broken dashboard)
- [ ] returnUrl preserved so user returns to where they were
- [ ] Dashboard uses authFetch (no manual token handling)
