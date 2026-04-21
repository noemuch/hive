// server/src/db/temporal-refresh.ts
//
// Debounced refresh for the agent_temporal_stats materialized view.
//
// Temporal credibility (#236 / A14) is a long-tail feature — it surfaces
// stability over weeks/months. Per-write refresh would be wasteful; a daily
// granularity is fine. We don't yet have an in-process scheduler or a
// GitHub-Actions cron for MVs, so this helper is wired into the quality
// notify path with a 1-hour in-memory debounce as a best-effort guarantee
// that the MV is never more than ~60 minutes stale for a workspace that
// gets at least one eval per hour.
//
// A nightly scheduled refresh (GitHub Actions `workflow_dispatch` or a
// dedicated cron pod) is the long-term owner. Wiring that up is deferred
// to a follow-up because App permissions prevent editing .github/workflows.

import type { Pool } from "pg";

const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

type RefreshState = {
  lastRefreshAt: number;
  inFlight: Promise<void> | null;
};

const state: RefreshState = {
  lastRefreshAt: 0,
  inFlight: null,
};

type Queryable = {
  query: (text: string) => Promise<unknown>;
};

/**
 * Trigger a `REFRESH MATERIALIZED VIEW CONCURRENTLY agent_temporal_stats`
 * if at least `cooldownMs` has elapsed since the last successful refresh.
 * Concurrent callers share the same in-flight promise, so the view is
 * never refreshed more than once at a time.
 *
 * The optional `now()` arg is a seam for tests — otherwise defaults to
 * `Date.now()`.
 *
 * Returns `true` when a refresh ran (or is awaited), `false` when skipped
 * due to the cooldown.
 */
export async function maybeRefreshTemporalStats(
  db: Queryable | Pool,
  opts: { cooldownMs?: number; now?: () => number } = {},
): Promise<boolean> {
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = opts.now ? opts.now() : Date.now();

  if (state.inFlight) {
    await state.inFlight;
    return true;
  }

  if (now - state.lastRefreshAt < cooldownMs) {
    return false;
  }

  const promise = (async () => {
    try {
      await db.query("REFRESH MATERIALIZED VIEW CONCURRENTLY agent_temporal_stats");
      state.lastRefreshAt = opts.now ? opts.now() : Date.now();
    } catch (err) {
      // A concurrent refresh error or a migration not-yet-applied would
      // both manifest here. Swallow so a notify batch never fails just
      // because the long-tail MV is unavailable — log at warn level so
      // regressions show up in observability.
      // eslint-disable-next-line no-console
      console.warn("[temporal-refresh] failed:", err instanceof Error ? err.message : String(err));
    } finally {
      state.inFlight = null;
    }
  })();

  state.inFlight = promise;
  await promise;
  return true;
}

/**
 * Test-only: reset the module-level debounce state so each test starts
 * from a clean slate.
 */
export function __resetTemporalRefreshStateForTests(): void {
  state.lastRefreshAt = 0;
  state.inFlight = null;
}
