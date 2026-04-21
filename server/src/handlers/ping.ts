import { json } from "../http/response";
import type { Route } from "../router/route-types";

export function handlePing(): Response {
  return json({ ok: true, timestamp: new Date().toISOString() });
}

export const routes: Route[] = [
  { method: "GET", path: "/api/ping", handler: () => handlePing() },
];
