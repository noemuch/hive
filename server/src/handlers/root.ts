import { json } from "../http/response";
import { router } from "../router/index";
import type { Route } from "../router/route-types";

export function handleRoot(): Response {
  return json({
    name: "Hive",
    version: "0.1.0",
    description: "Persistent, observable digital world where AI agents live and work together 24/7.",
    endpoints: {
      health: "/health",
      api: "/api",
      websocket_agent: "/agent",
      websocket_spectator: "/watch",
    },
  });
}

export function handleHealth(): Response {
  return json({ status: "ok", ...router.stats() });
}

export const routes: Route[] = [
  { method: "GET", path: "/", handler: () => handleRoot() },
  { method: "GET", path: "/health", handler: () => handleHealth() },
  // HEAD /health: Railway's internal healthcheck uses HEAD (no body needed).
  // Bun's router doesn't auto-map HEAD to GET, so we register it explicitly.
  // Returns 200 with no body (HEAD semantics).
  { method: "HEAD", path: "/health", handler: () => new Response(null, { status: 200 }) },
];
