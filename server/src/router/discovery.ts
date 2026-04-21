import { Glob } from "bun";
import type { Route } from "./route-types";

/**
 * Auto-discovery scans a directory for `.ts` modules and collects every
 * `Route` exported from them (either as `export const route: Route` or
 * `export const routes: Route[]`). Files that don't export either are
 * silently skipped so shared helpers (e.g. `collections.ts`, `hear-axes.ts`)
 * can live next to handlers without special casing.
 *
 * The net effect: adding a new endpoint is a one-file change — create
 * `handlers/my-thing.ts` with a `routes` export and restart. No edits to
 * index.ts, no edits to a central registry file. This eliminates the
 * rebase-conflict hotspot observed in issue #315 (60% of merged PRs
 * touched the same registration file).
 */

/** Files matched by this glob are loaded and inspected. */
const HANDLER_GLOB = "*.ts";

function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts") || file.endsWith(".spec.ts");
}

/**
 * Count static (non-parameterised) path segments. `/api/agents/:id/badges`
 * has 3 static segments; `/api/agents/:id` has 2.
 */
function staticSegmentCount(path: string): number {
  return path
    .split("/")
    .filter((seg) => seg.length > 0 && !seg.startsWith(":"))
    .length;
}

/**
 * Specificity order (first match wins in the dispatcher):
 *
 * 1. Predicate-gated routes before unqualified routes sharing the same path
 *    (e.g. `/api/leaderboard?dimension=quality` before the plain leaderboard).
 * 2. More static segments first (static wins over parametric — critical so
 *    `/api/agents/marketplace` shadows `/api/agents/:id`).
 * 3. Longer path first (finer-grained routes before catch-alls).
 * 4. Stable tie-break on method+path for deterministic ordering across
 *    runs (important for tests).
 */
export function sortRoutes(routes: Route[]): Route[] {
  return routes
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => {
      const pa = a.r.predicate ? 1 : 0;
      const pb = b.r.predicate ? 1 : 0;
      if (pa !== pb) return pb - pa;

      const sa = staticSegmentCount(a.r.path);
      const sb = staticSegmentCount(b.r.path);
      if (sa !== sb) return sb - sa;

      if (a.r.path.length !== b.r.path.length) {
        return b.r.path.length - a.r.path.length;
      }

      const key = (r: Route) => `${r.method} ${r.path}`;
      const ka = key(a.r);
      const kb = key(b.r);
      if (ka !== kb) return ka.localeCompare(kb);

      return a.idx - b.idx;
    })
    .map((entry) => entry.r);
}

/**
 * Load every `*.ts` file in `dir` (excluding test files) and aggregate the
 * `route` / `routes` exports. Returns them sorted by specificity so the
 * dispatcher can short-circuit on the first match.
 *
 * Duplicate (method, path, predicate-less) entries throw — two routes
 * claiming the same slot is almost always a bug, and silently picking one
 * hides it.
 */
export async function discoverRoutes(dir: string): Promise<Route[]> {
  const glob = new Glob(HANDLER_GLOB);
  const collected: Route[] = [];

  for await (const file of glob.scan({ cwd: dir })) {
    if (isTestFile(file)) continue;
    const mod = (await import(`${dir}/${file}`)) as {
      route?: Route;
      routes?: Route[];
    };
    if (Array.isArray(mod.routes)) {
      for (const r of mod.routes) collected.push(r);
    }
    if (mod.route) collected.push(mod.route);
  }

  assertNoDuplicates(collected);
  return sortRoutes(collected);
}

function assertNoDuplicates(routes: Route[]): void {
  const seen = new Map<string, Route>();
  for (const r of routes) {
    if (r.predicate) continue;
    const key = `${r.method} ${r.path}`;
    const prev = seen.get(key);
    if (prev) {
      throw new Error(
        `Duplicate route registration: ${key}. Add a predicate to disambiguate, or keep only one definition.`,
      );
    }
    seen.set(key, r);
  }
}
