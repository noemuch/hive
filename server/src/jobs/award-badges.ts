import type { Pool } from "pg";

export type BadgeType =
  | "30-day-proven"
  | "90-day-proven"
  | "top-10-pct-role"
  | "1000-artifacts"
  | "mistral-champion"
  | "polyglot";

export const BADGE_TYPES: readonly BadgeType[] = [
  "30-day-proven",
  "90-day-proven",
  "top-10-pct-role",
  "1000-artifacts",
  "mistral-champion",
  "polyglot",
] as const;

const THIRTY_DAY_MIN_SCORE = 7;
const NINETY_DAY_MIN_SCORE = 7.5;
const THIRTY_DAY_TENURE = 30;
const NINETY_DAY_TENURE = 90;
const ARTIFACT_MILESTONE = 1000;
const POLYGLOT_MIN_DOMAINS = 3;
const TOP_PCT = 10;

// ─── Pure rule predicates (unit-tested) ───────────────────────────────────────

export function qualifiesFor30DayProven(args: { tenureDays: number; scoreMu: number | null }): boolean {
  return args.scoreMu !== null && args.tenureDays >= THIRTY_DAY_TENURE && args.scoreMu >= THIRTY_DAY_MIN_SCORE;
}

export function qualifiesFor90DayProven(args: { tenureDays: number; scoreMu: number | null }): boolean {
  return args.scoreMu !== null && args.tenureDays >= NINETY_DAY_TENURE && args.scoreMu >= NINETY_DAY_MIN_SCORE;
}

export function qualifiesFor1000Artifacts(artifactCount: number): boolean {
  return artifactCount >= ARTIFACT_MILESTONE;
}

/**
 * Polyglot = equipped with distinct "domains" ≥ 3, where a domain maps to an
 * entry in `displayed_specializations`. Case-insensitive de-dup, ignores blanks.
 */
export function qualifiesForPolyglot(specializations: string[]): boolean {
  const cleaned = new Set<string>();
  for (const s of specializations) {
    const t = s?.trim().toLowerCase();
    if (t) cleaned.add(t);
  }
  return cleaned.size >= POLYGLOT_MIN_DOMAINS;
}

/**
 * Given a list of score_state_mu values (null = unrated → excluded), return the
 * cutoff mu at which the agent enters the top-N%. ceil() ensures at least one
 * winner when the cohort is tiny. Returns null when cohort is empty.
 */
export function topNPercentThreshold(scores: (number | null)[], percent: number): number | null {
  const rated = scores.filter((s): s is number => s !== null).sort((a, b) => b - a);
  if (rated.length === 0) return null;
  const cutoffCount = Math.max(1, Math.ceil(rated.length * (percent / 100)));
  return rated[cutoffCount - 1];
}

// ─── DB awarding (idempotent via composite PK) ────────────────────────────────

type AwardCounts = Record<BadgeType, number>;

function emptyCounts(): AwardCounts {
  return {
    "30-day-proven": 0,
    "90-day-proven": 0,
    "top-10-pct-role": 0,
    "1000-artifacts": 0,
    "mistral-champion": 0,
    "polyglot": 0,
  };
}

/**
 * Runs the six badge rules and inserts any newly-earned rows. Safe to run any
 * number of times per day — composite PK (agent_id, badge_type) makes each
 * INSERT idempotent via ON CONFLICT DO NOTHING.
 */
export async function awardBadges(pool: Pool): Promise<{ awarded: number; byType: AwardCounts }> {
  const counts = emptyCounts();

  counts["30-day-proven"] = await insertTenureBadge(pool, "30-day-proven", THIRTY_DAY_TENURE, THIRTY_DAY_MIN_SCORE);
  counts["90-day-proven"] = await insertTenureBadge(pool, "90-day-proven", NINETY_DAY_TENURE, NINETY_DAY_MIN_SCORE);
  counts["top-10-pct-role"] = await insertTopPctRoleBadge(pool);
  counts["1000-artifacts"] = await insertArtifactMilestoneBadge(pool);
  counts["mistral-champion"] = await insertMistralChampionBadge(pool);
  counts["polyglot"] = await insertPolyglotBadge(pool);

  const awarded = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { awarded, byType: counts };
}

async function insertTenureBadge(
  pool: Pool,
  badge: BadgeType,
  minDays: number,
  minScore: number,
): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO agent_badges (agent_id, badge_type)
     SELECT a.id, $1
     FROM agents a
     WHERE a.status <> 'retired'
       AND a.score_state_mu IS NOT NULL
       AND a.score_state_mu >= $2
       AND COALESCE(a.backdated_joined_at, a.created_at) <= now() - ($3 || ' days')::interval
     ON CONFLICT (agent_id, badge_type) DO NOTHING`,
    [badge, minScore, minDays],
  );
  return rowCount ?? 0;
}

async function insertTopPctRoleBadge(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `WITH ranked AS (
       SELECT
         a.id,
         a.role,
         a.score_state_mu,
         PERCENT_RANK() OVER (PARTITION BY a.role ORDER BY a.score_state_mu ASC) AS pr,
         COUNT(*)      OVER (PARTITION BY a.role) AS role_size
       FROM agents a
       WHERE a.status <> 'retired'
         AND a.score_state_mu IS NOT NULL
     )
     INSERT INTO agent_badges (agent_id, badge_type)
     SELECT id, $1
     FROM ranked
     WHERE role_size >= $2
       AND pr >= $3
     ON CONFLICT (agent_id, badge_type) DO NOTHING`,
    ["top-10-pct-role", 10, 1 - TOP_PCT / 100],
  );
  return rowCount ?? 0;
}

async function insertArtifactMilestoneBadge(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO agent_badges (agent_id, badge_type)
     SELECT author_id, $1
     FROM artifacts
     WHERE author_id IS NOT NULL
     GROUP BY author_id
     HAVING COUNT(*) >= $2
     ON CONFLICT (agent_id, badge_type) DO NOTHING`,
    ["1000-artifacts", ARTIFACT_MILESTONE],
  );
  return rowCount ?? 0;
}

async function insertMistralChampionBadge(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO agent_badges (agent_id, badge_type)
     SELECT a.id, $1
     FROM agents a
     WHERE a.llm_provider = $2
       AND a.status <> 'retired'
       AND a.score_state_mu IS NOT NULL
       AND a.score_state_mu = (
         SELECT MAX(score_state_mu)
         FROM agents
         WHERE llm_provider = $2
           AND status <> 'retired'
           AND score_state_mu IS NOT NULL
       )
     ON CONFLICT (agent_id, badge_type) DO NOTHING`,
    ["mistral-champion", "mistral"],
  );
  return rowCount ?? 0;
}

async function insertPolyglotBadge(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO agent_badges (agent_id, badge_type)
     SELECT a.id, $1
     FROM agents a
     WHERE a.status <> 'retired'
       AND COALESCE(array_length(a.displayed_specializations, 1), 0) >= $2
     ON CONFLICT (agent_id, badge_type) DO NOTHING`,
    ["polyglot", POLYGLOT_MIN_DOMAINS],
  );
  return rowCount ?? 0;
}
