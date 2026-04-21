/**
 * Progressive SKILL.md loader for Hive agents.
 *
 * On `auth_ok`, the agent calls `fetchAgentSkills` to load its attached
 * skills. Each reply/kickoff/pulse then calls `composeSystemPromptWithSkills`
 * to score + greedy-pack relevant skills into the system prompt within a
 * hard token budget (~8k tokens). Unrelated skills never hit the LLM —
 * that's the progressive disclosure.
 *
 * Spec: issue #216 (parent epic #183 § 11).
 */

export type AgentSkill = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content_md: string;
  category?: string | null;
  version?: string | null;
};

// Rough heuristic: ~4 chars per token across English + markdown. Good enough
// for budget gating; we're not counting tokens for billing, just bounding
// prompt size to keep reply latency sane.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Word tokens ≥ 3 chars, lowercased. Rejects noise words like "a"/"is"/"it"
// that would otherwise score skills spuriously on every message.
const TOKEN_RE = /[a-z0-9]{3,}/g;

function tokensOf(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(text.toLowerCase().match(TOKEN_RE) || []);
}

function countHits(msgTokens: Set<string>, skillText: string | null | undefined): number {
  if (!skillText) return 0;
  let hits = 0;
  for (const t of tokensOf(skillText)) {
    if (msgTokens.has(t)) hits++;
  }
  return hits;
}

// Weighted relevance score. Slug matches weigh most (usually semantic), then
// title, then description. content_md is deliberately ignored — we'd match
// everything and defeat progressive disclosure.
const WEIGHT_SLUG = 3;
const WEIGHT_TITLE = 2;
const WEIGHT_DESCRIPTION = 1;

export function scoreSkill(message: string, skill: AgentSkill): number {
  const msgTokens = tokensOf(message);
  if (msgTokens.size === 0) return 0;
  // Slugs are dash-separated; split into word tokens before matching.
  const slugText = skill.slug.replace(/[-_]+/g, " ");
  return (
    WEIGHT_SLUG * countHits(msgTokens, slugText) +
    WEIGHT_TITLE * countHits(msgTokens, skill.title) +
    WEIGHT_DESCRIPTION * countHits(msgTokens, skill.description)
  );
}

export function pickRelevantSkills(
  message: string,
  skills: AgentSkill[],
  tokenBudget: number
): AgentSkill[] {
  if (skills.length === 0) return [];
  const scored = skills
    .map((s) => ({ skill: s, score: scoreSkill(message, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: AgentSkill[] = [];
  let used = 0;
  for (const { skill } of scored) {
    const cost = estimateTokens(skill.content_md);
    if (used + cost > tokenBudget) continue;
    picked.push(skill);
    used += cost;
  }
  return picked;
}

export function buildSkillsContext(skills: AgentSkill[]): string {
  if (skills.length === 0) return "";
  return skills
    .map((s) => `### Skill: ${s.title}\n${s.content_md}`)
    .join("\n\n");
}

export function composeSystemPromptWithSkills(
  baseSystemPrompt: string,
  userMessage: string,
  skills: AgentSkill[],
  tokenBudget = 8000
): { prompt: string; picked: AgentSkill[] } {
  const picked = pickRelevantSkills(userMessage, skills, tokenBudget);
  if (picked.length === 0) return { prompt: baseSystemPrompt, picked: [] };
  const ctx = buildSkillsContext(picked);
  return {
    prompt: `${baseSystemPrompt}\n\n## Available skills (use when relevant):\n\n${ctx}`,
    picked,
  };
}

/**
 * Fetch an agent's attached skills from the Hive REST API.
 *
 * Graceful degradation: 404 / non-2xx / network errors return `[]` + a single
 * `console.warn`. This keeps agents running even if the skills endpoint is
 * briefly unreachable or has no attachments yet.
 *
 * `fetchImpl` is injectable so tests can drive responses without network.
 */
export async function fetchAgentSkills(
  agentId: string,
  apiKey: string,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<AgentSkill[]> {
  const base = apiUrl.replace(/\/+$/, "");
  const url = `${base}/api/agents/${agentId}/skills`;
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 404) return [];
    if (!res.ok) {
      console.warn(`[skills] fetch failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = (await res.json()) as { skills?: unknown };
    return Array.isArray(data.skills) ? (data.skills as AgentSkill[]) : [];
  } catch (err) {
    console.warn(`[skills] fetch error:`, (err as Error).message);
    return [];
  }
}
