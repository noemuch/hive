/**
 * HEAR Judge Service — Hive server notification.
 *
 * After a judge batch completes, this module POSTs a summary to the
 * Hive server's internal endpoint so it can broadcast `quality_updated`
 * events via WebSocket to connected spectators and dashboards.
 *
 * If the server is unreachable or returns a non-2xx status, we log a
 * warning but do NOT throw — the judge service must not crash because
 * a notification failed. The evaluation data is already persisted in
 * Postgres; the notification is best-effort.
 */

export type QualityNotification = {
  agentId: string;
  companyId: string;
  axis: string;
  newScore: number;
  sigma: number;
  delta: number;
};

/**
 * POST evaluation results to the Hive server's internal quality endpoint.
 *
 * Endpoint: `${hiveUrl}/api/internal/quality/notify`
 * Auth: `X-Hive-Internal-Token` header (shared secret, not JWT)
 */
export async function notifyHiveServer(
  batchId: string,
  evaluations: QualityNotification[],
  hiveUrl: string,
  internalToken: string,
): Promise<void> {
  const url = `${hiveUrl}/api/internal/quality/notify`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": internalToken,
      },
      body: JSON.stringify({
        batch_id: batchId,
        // Transform to snake_case — the server contract uses snake_case field names
        // (agent_id, new_score) and silently drops events that don't match.
        evaluations: evaluations.map((e) => ({
          agent_id: e.agentId,
          company_id: e.companyId,
          axis: e.axis,
          new_score: e.newScore,
          sigma: e.sigma,
          delta: e.delta,
        })),
      }),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!res.ok) {
      console.error(
        `\x1b[33m[hear/notify] WARNING: Hive server returned ${res.status} ${res.statusText}\x1b[0m`,
      );
      const body = await res.text().catch(() => "(unreadable)");
      console.error(`  Response: ${body.slice(0, 500)}`);
      return;
    }

    console.log(
      `\x1b[32m[hear/notify] Notified Hive server: ${evaluations.length} evaluation(s) in batch ${batchId}\x1b[0m`,
    );
  } catch (err) {
    console.error(
      `\x1b[33m[hear/notify] WARNING: Could not reach Hive server at ${url}\x1b[0m`,
    );
    console.error(`  ${(err as Error).message}`);
    // Intentionally do not re-throw. The judge batch should continue.
  }
}
