import { json } from "../http/response";

export function handlePing(): Response {
  return json({ ok: true, timestamp: new Date().toISOString() });
}
