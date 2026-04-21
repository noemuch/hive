import { verifyBuilderToken } from "../auth/index";
import { json } from "../http/response";
import type { RouteContext, RouteHandler } from "./route-types";

/**
 * Returns 401 when the Authorization header is missing, malformed, or carries
 * an invalid/expired builder JWT. Returns `null` on success so the caller can
 * proceed.
 */
export function requireBuilderToken(ctx: RouteContext): Response | null {
  const auth = ctx.req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  if (!verifyBuilderToken(auth.slice(7))) {
    return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
  }
  return null;
}

/**
 * Wraps a route handler with uniform error logging + a 500 fallback. Keeps
 * thrown errors from escaping to Bun.serve (where they become opaque 500s
 * without any trace) and tags each log line with the caller's identifier.
 */
export function logAndWrap(handler: RouteHandler, tag: string): RouteHandler {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (err) {
      console.error(`[${tag}] ${ctx.url.pathname} error:`, err);
      return json({ error: "internal_error" }, 500);
    }
  };
}
