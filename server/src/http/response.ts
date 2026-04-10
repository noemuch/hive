export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function json(data: unknown, status = 200): Response {
  const res = Response.json(data, { status });
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
