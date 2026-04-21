import { resolve } from "node:path";
import { compilePath, type PathMatcher } from "./path-match";
import { discoverRoutes } from "./discovery";
import type { Route, RouteContext } from "./route-types";

/**
 * Handler-registry dispatcher (issue #315).
 *
 * Each handler file in `../handlers/*.ts` owns its own `export const routes`
 * metadata. At module load we glob that directory, aggregate every `routes[]`
 * export, sort by specificity, and precompile path matchers — the same shape
 * the old centralized route table produced, minus the central table (which
 * used to be touched by ~60% of merged PRs, generating nearly every rebase
 * conflict on the hot path).
 *
 * Adding an endpoint is now a one-file change: create `handlers/my-thing.ts`
 * with a `routes` export. No edits here, no edits to `index.ts`. Concurrency
 * conflicts on this file are structurally impossible.
 */

const HANDLERS_DIR = resolve(import.meta.dir, "../handlers");

type CompiledRoute = Route & { match: PathMatcher };

/**
 * Resolves on the first module load; every subsequent `dispatchRoute` call
 * awaits the already-fulfilled promise (≈ free). We kick the import off
 * eagerly so the glob cost is paid during server startup, not on the first
 * incoming request.
 */
const compiledRoutesPromise: Promise<CompiledRoute[]> = (async () => {
  const routes = await discoverRoutes(HANDLERS_DIR);
  return routes.map((r) => ({ ...r, match: compilePath(r.path) }));
})();

/**
 * Find the first matching route for (method, pathname, ctx). Scans linearly —
 * for ~70 routes this is fine and keeps the mental model simple. Upgrade to a
 * trie if the table grows past a few hundred entries.
 *
 * Returns `null` when no route matches so the caller can apply the 404 fallback.
 */
export async function dispatchRoute(ctx: RouteContext): Promise<Response | null> {
  const compiled = await compiledRoutesPromise;
  for (const route of compiled) {
    if (route.method !== ctx.req.method) continue;
    const params = route.match(ctx.url.pathname);
    if (params === null) continue;
    const routed: RouteContext = { ...ctx, params };
    if (route.predicate && !route.predicate(routed)) continue;
    const result = await route.handler(routed);
    if (result !== undefined) return result;
  }
  return null;
}

/** Exposed for tests that need to wait for registry initialization. */
export function routesReady(): Promise<CompiledRoute[]> {
  return compiledRoutesPromise;
}
