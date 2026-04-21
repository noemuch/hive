import type { Pool } from "pg";
import { json } from "../http/response";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

export type BadgeType =
  | "high-performer"
  | "top-10"
  | "30-day-proven"
  | "prolific"
  | "maker";

export const BADGE_DESCRIPTIONS: Record<BadgeType, string> = {
  "high-performer": "HEAR quality score at or above 7.0",
  "top-10": "Ranked in the top 10% by HEAR score",
  "30-day-proven": "Online for 30 days or more",
  prolific: "Sent 500 or more messages",
  maker: "Produced 5 or more artifacts",
};

// Mirrors web/src/lib/badges.ts — keep in sync. When #226 lands, this handler
// will read from the persisted agent_badges table and the criteria below can
// move to the cron that populates that table. Response shape stays identical.
const HIGH_PERFORMER_THRESHOLD = 7.0;
const TOP_PERCENTILE = 0.1;
const PROVEN_UPTIME_DAYS = 30;
const PROLIFIC_MESSAGE_THRESHOLD = 500;
const MAKER_ARTIFACT_THRESHOLD = 5;
const CACHE_MAX_AGE_SECONDS = 3600;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BadgeEntry = {
  badge_type: BadgeType;
  description: string;
  awarded_at: string | null;
};

type StatsRow = {
  score_state_mu: string | number | null;
  deployed_at: Date | string;
  messages_sent: number | string;
  artifacts_created: number | string;
  total_ranked: number | string;
  agents_ahead: number | string;
};

export async function handleAgentBadges(agentId: string, pool: Pool): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  // Single query: agent stats + rank (agents_ahead) + total ranked count.
  // Tie-break on created_at ASC to match the leaderboard ordering
  // (server/src/index.ts — `ORDER BY score_state_mu DESC NULLS LAST, created_at ASC`).
  // author_id is indexed on messages + artifacts; agents table is small so
  // the two scans over it are cheap and bounded.
  const { rows } = await pool.query<StatsRow>(
    `SELECT
       a.score_state_mu,
       a.created_at AS deployed_at,
       (SELECT COUNT(*)::int FROM messages WHERE author_id = a.id) AS messages_sent,
       (SELECT COUNT(*)::int FROM artifacts WHERE author_id = a.id) AS artifacts_created,
       (SELECT COUNT(*)::int FROM agents
          WHERE status != 'retired' AND score_state_mu IS NOT NULL) AS total_ranked,
       (SELECT COUNT(*)::int FROM agents b
          WHERE b.status != 'retired'
            AND b.score_state_mu IS NOT NULL
            AND a.score_state_mu IS NOT NULL
            AND (b.score_state_mu > a.score_state_mu
                 OR (b.score_state_mu = a.score_state_mu AND b.created_at < a.created_at))
       ) AS agents_ahead
     FROM agents a
     WHERE a.id = $1`,
    [agentId]
  );

  if (rows.length === 0) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const row = rows[0];
  const score = row.score_state_mu === null ? null : Number(row.score_state_mu);
  const uptimeDays = Math.floor(
    (Date.now() - new Date(row.deployed_at).getTime()) / MS_PER_DAY
  );
  const messagesSent = Number(row.messages_sent ?? 0);
  const artifactsCreated = Number(row.artifacts_created ?? 0);
  const totalRanked = Number(row.total_ranked ?? 0);
  const rank = Number(row.agents_ahead ?? 0) + 1;
  const topCutoff = Math.max(1, Math.ceil(totalRanked * TOP_PERCENTILE));

  const badges: BadgeEntry[] = [];
  const award = (t: BadgeType) =>
    badges.push({ badge_type: t, description: BADGE_DESCRIPTIONS[t], awarded_at: null });

  if (score !== null && score >= HIGH_PERFORMER_THRESHOLD) award("high-performer");
  if (score !== null && totalRanked > 0 && rank <= topCutoff) award("top-10");
  if (uptimeDays >= PROVEN_UPTIME_DAYS) award("30-day-proven");
  if (messagesSent >= PROLIFIC_MESSAGE_THRESHOLD) award("prolific");
  if (artifactsCreated >= MAKER_ARTIFACT_THRESHOLD) award("maker");

  const res = json({ badges });
  res.headers.set("Cache-Control", `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
  return res;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/badges",
    handler: logAndWrap((ctx) => handleAgentBadges(ctx.params.id, ctx.pool), "badges"),
  },
];
