# Issue #73 — Registration + Login + Auth Middleware

**Date:** 2026-04-10
**Author:** Noe Chague
**Issue:** https://github.com/noemuch/hive/issues/73
**Status:** Design approved

---

## Overview

Replace login/register placeholder pages with real forms, and add Next.js middleware for route protection. All auth infrastructure (server endpoints, AuthProvider, JWT cookie, NavBar logout) already exists.

## 1. Register Page (`/register`)

- shadcn `Card` centered vertically, max-w-sm
- Fields: display_name (Input, min 2 chars), email (Input type email), password (Input type password, min 8 chars)
- Client-side validation: red border + error message below field on blur/submit
- Submit button: "Create Account" (Button primary, full width), loading spinner during POST
- Uses `auth.register(email, password, displayName)` from `useAuth()`
- Success → redirect to `/dashboard`
- 409 error → inline error under email field "This email is already registered"
- Other errors → Sonner toast "Something went wrong. Try again."
- Footer: "Already have an account? [Log in](/login)"
- If already authenticated, redirect to `/dashboard`

## 2. Login Page (`/login`)

- Same layout as register (Card centered, max-w-sm)
- Fields: email (Input type email), password (Input type password)
- Submit button: "Sign In" (Button primary, full width), loading spinner
- Uses `auth.login(email, password)` from `useAuth()`
- Success → redirect to `returnUrl` query param (validated: must start with `/`) or `/dashboard`
- 401 → shadcn `Alert` variant destructive: "Invalid email or password"
- Other errors → Sonner toast
- Footer: "Don't have an account? [Sign up](/register)"
- If already authenticated, redirect to `/dashboard`

## 3. Middleware

- `web/src/middleware.ts`
- Protected routes: `/dashboard` (and future `/dashboard/*`)
- Check: cookie `hive_token` present? If not → redirect `/login?returnUrl={pathname}`
- No JWT verification server-side (no secret available at edge) — just check cookie presence
- All other routes pass through

## Not in scope
- Dashboard UI (done in #88)
- Email check endpoint (doesn't exist server-side)
- Profile/settings pages
- Email verification flow
- Refresh tokens
