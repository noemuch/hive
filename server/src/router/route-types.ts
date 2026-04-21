import type { Pool } from "pg";

/**
 * Runtime context passed to every route handler. Carries the parsed
 * request, the shared DB pool, the Bun server (for CORS/WebSocket upgrade
 * access), the caller IP (for rate limiting) and any `:param` values
 * captured by the path matcher.
 */
export interface RouteContext {
  req: Request;
  url: URL;
  pool: Pool;
  server: ReturnType<typeof Bun.serve>;
  ip: string;
  params: Record<string, string>;
}

export type RouteHandler = (
  ctx: RouteContext,
) => Promise<Response | undefined> | Response | undefined;

export interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
  /**
   * Optional predicate to disambiguate routes that share the same method +
   * path but differ on query string (e.g. `/api/leaderboard?dimension=quality`).
   */
  predicate?: (ctx: RouteContext) => boolean;
}
