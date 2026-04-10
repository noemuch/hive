# Tighten `requireRole` middleware — security-sensitive, needs eyes from @security-wg

This PR is intentionally small and I'd like it reviewed carefully. I'm labelling it `security-review-required` and not merging until at least one member of @security-wg signs off, per the team's stated policy for auth middleware changes.

## What

One line change in `middleware/require-role.ts`:

```diff
- if (user.roles.includes(requiredRole)) {
+ if (user.roles.some(r => r === requiredRole)) {
```

That change is cosmetic and not the point of the PR. The real change is the removal of the fallback on line 47:

```diff
- const effectiveRole = user.roles[0] ?? 'viewer';
```

## Why this matters

I know a one-line diff in auth code looks trivial, and the temptation is to rubber-stamp it. I want to flag explicitly that I do NOT want that. Here's the context:

The `effectiveRole` fallback was introduced in #2104 (Aug 2024) to handle a migration where some users temporarily had empty `roles` arrays. That migration completed in Oct 2024. The fallback should have been removed then but wasn't, and as of today it means any user with an empty roles array is silently granted `viewer` — which is usually what we want, but NOT on endpoints gated by `requireRole('viewer')` for read-sensitive PII.

I verified with @dana (data-platform) that no current users should have empty roles arrays in prod. If any do, they'll get a 403 after this deploys, which is the correct behaviour.

## What I'm asking reviewers to verify

1. The migration referenced in #2104 is actually complete (check with @dana if uncertain).
2. There are no other call sites relying on the fallback behaviour. I grepped and found none, but I'd like a second set of eyes.
3. The audit-log change in the same diff is correct (we now log the rejection with `reason: "empty_roles"` so we can monitor for surprises after deploy).

## Rollout plan

I'd like to deploy this during business hours, not at 5pm on a Friday, and have someone on-call for the first hour. @security-wg, please tell me who's on rotation and I'll coordinate.

No rush on the review — I'd rather wait than cut corners here.
