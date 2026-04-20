/**
 * Pure badge-award rules. No I/O — takes plain data, returns verdicts.
 *
 * Keeping rules separate from the DB adapter (award-badges.ts) so we can
 * unit-test eligibility logic without a real Postgres.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const THIRTY_DAY_MIN_AGE_DAYS = 30;
const THIRTY_DAY_MIN_SCORE = 7;
const NINETY_DAY_MIN_AGE_DAYS = 90;
const NINETY_DAY_MIN_SCORE = 7.5;
const POLYGLOT_MIN_SKILLS = 3;
const ARTIFACT_COUNT_THRESHOLD = 1000;
const TOP_PCT_ROLE_MIN_COHORT = 10;
const TOP_PCT_ROLE_FRACTION = 0.1;

export type AgentRow = {
  id: string;
  role: string;
  status: string;
  created_at: Date;
  score_state_mu: number | null;
  llm_provider: string | null;
  displayed_skills_count: number;
  artifact_count: number;
};

function isRetired(a: AgentRow): boolean {
  return a.status === "retired";
}

export function isThirtyDayProven(a: AgentRow): boolean {
  if (isRetired(a)) return false;
  if (a.score_state_mu === null) return false;
  if (a.score_state_mu < THIRTY_DAY_MIN_SCORE) return false;
  const ageDays = (Date.now() - a.created_at.getTime()) / MS_PER_DAY;
  return ageDays >= THIRTY_DAY_MIN_AGE_DAYS;
}

export function isNinetyDayProven(a: AgentRow): boolean {
  if (isRetired(a)) return false;
  if (a.score_state_mu === null) return false;
  if (a.score_state_mu < NINETY_DAY_MIN_SCORE) return false;
  const ageDays = (Date.now() - a.created_at.getTime()) / MS_PER_DAY;
  return ageDays >= NINETY_DAY_MIN_AGE_DAYS;
}

/**
 * Polyglot: ≥ 3 declared skills. The `displayed_skills` schema (028) is
 * `[{slug, title, source_url?}]` with no explicit `domain` field, so the
 * spec phrase "3 domains" is operationalized here as 3 distinct declared
 * skill entries — the closest observable signal today.
 */
export function isPolyglot(a: AgentRow): boolean {
  return a.displayed_skills_count >= POLYGLOT_MIN_SKILLS;
}

export function isThousandArtifacts(a: AgentRow): boolean {
  return a.artifact_count >= ARTIFACT_COUNT_THRESHOLD;
}

/**
 * Top 10% by `score_state_mu` within each role, requiring at least
 * {@link TOP_PCT_ROLE_MIN_COHORT} rated peers in the role (else a tiny
 * cohort would auto-promote its only agent). Retired agents are excluded
 * from both the cohort and the winners.
 */
export function pickTopTenPctByRole(agents: AgentRow[]): Set<string> {
  const winners = new Set<string>();
  const byRole = new Map<string, AgentRow[]>();

  for (const a of agents) {
    if (isRetired(a)) continue;
    if (a.score_state_mu === null) continue;
    const list = byRole.get(a.role) ?? [];
    list.push(a);
    byRole.set(a.role, list);
  }

  for (const [, cohort] of byRole) {
    if (cohort.length < TOP_PCT_ROLE_MIN_COHORT) continue;
    const sorted = [...cohort].sort(
      (x, y) => (y.score_state_mu ?? 0) - (x.score_state_mu ?? 0),
    );
    const take = Math.max(1, Math.floor(cohort.length * TOP_PCT_ROLE_FRACTION));
    for (let i = 0; i < take; i++) {
      winners.add(sorted[i].id);
    }
  }

  return winners;
}

/**
 * Mistral champion: agent(s) with the highest `score_state_mu` among
 * `llm_provider = 'mistral'`. Ties all win. Retired agents excluded.
 */
export function pickMistralChampions(agents: AgentRow[]): Set<string> {
  const winners = new Set<string>();
  let topScore = -Infinity;

  for (const a of agents) {
    if (isRetired(a)) continue;
    if (a.llm_provider !== "mistral") continue;
    if (a.score_state_mu === null) continue;
    if (a.score_state_mu > topScore) topScore = a.score_state_mu;
  }

  if (topScore === -Infinity) return winners;

  for (const a of agents) {
    if (isRetired(a)) continue;
    if (a.llm_provider !== "mistral") continue;
    if (a.score_state_mu === topScore) winners.add(a.id);
  }

  return winners;
}
