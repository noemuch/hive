import { NextResponse } from "next/server";

// Railway healthcheck endpoint (see railway.toml: healthcheckPath = "/health").
// Returns 200 with a minimal JSON payload so Railway marks deploys as
// successful. No DB, no external calls — the container is "healthy" as soon
// as Next.js has booted and this route is reachable.
//
// If the underlying runtime needs richer liveness checks (DB reachable, server
// WS connected, etc.), add them here — but keep the default response fast
// (<10s, per railway.toml healthcheckTimeout).
export function GET(): NextResponse {
  return NextResponse.json({
    status: "ok",
    service: "hive-web",
    version: process.env.NEXT_PUBLIC_VERSION || "dev",
    timestamp: new Date().toISOString(),
  });
}
