/**
 * HEAR Judge Service — Anonymization (blinding).
 *
 * Implements Component 2 of HEAR-methodology.md.
 *
 * Strips identifying information from artifact content before sending to
 * the judge. The judge MUST NOT be able to recognize who wrote the artifact
 * or which company it came from — this is essential for unbiased grading.
 *
 * V1 rules (regex-based, simple but effective):
 *   - Agent names    → [AGENT_A], [AGENT_B], ... (consistent within an artifact)
 *   - Builder names  → [BUILDER_X]
 *   - Company names  → [COMPANY_1]
 *   - Channel names  → [CHANNEL_NAME]
 *   - Cross-artifact references (UUIDs, @artifact-id) → [ARTIFACT_REF_N]
 *   - Absolute timestamps → relative form ("2 hours ago", "yesterday")
 *
 * What we preserve:
 *   - Full content of the artifact
 *   - Artifact type
 *   - Role of the author (passed separately to the prompt)
 */

import type { NameMaps } from "./db";

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// 2026-04-09T14:23:00.000Z, 2026-04-09 14:23, 14:23 UTC, etc.
const ISO_DATE_RE =
  /\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\b/g;

export type AnonymizeResult = {
  content: string;
  /** Map of original → replacement, useful for debugging / audit. */
  replacements: Record<string, string>;
};

/**
 * Sort entries by length descending so longer names match before substrings
 * (e.g. "Acme Corp Europe" before "Acme Corp"). Empty / 1-char names are
 * dropped to avoid catastrophic over-matching.
 */
function sortByLengthDesc(entries: [string, string][]): [string, string][] {
  return entries
    .filter(([orig]) => orig && orig.trim().length >= 2)
    .sort((a, b) => b[0].length - a[0].length);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace all whole-word matches of `needle` with `replacement`.
 * Word boundaries respect Unicode letters (best-effort with \b).
 */
function replaceWord(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, "g");
  return haystack.replace(re, replacement);
}

export function anonymizeContent(
  content: string,
  names: NameMaps,
  now: Date = new Date(),
): AnonymizeResult {
  const replacements: Record<string, string> = {};

  // 1. Companies → [COMPANY_1], [COMPANY_2], ...
  let companyCounter = 0;
  const companyMap = new Map<string, string>();
  for (const [_id, name] of sortByLengthDesc([...names.companyNames])) {
    if (companyMap.has(name)) continue;
    companyCounter += 1;
    companyMap.set(name, `[COMPANY_${companyCounter}]`);
  }

  // 2. Agents → [AGENT_A], [AGENT_B], ...
  // Use letter labels for the first 26, then [AGENT_27]+
  let agentCounter = 0;
  const agentMap = new Map<string, string>();
  for (const [_id, name] of sortByLengthDesc([...names.agentNames])) {
    if (agentMap.has(name)) continue;
    const label =
      agentCounter < 26
        ? String.fromCharCode("A".charCodeAt(0) + agentCounter)
        : String(agentCounter + 1);
    agentMap.set(name, `[AGENT_${label}]`);
    agentCounter += 1;
  }

  // 3. Builders → [BUILDER_A], [BUILDER_B], ...
  // Use the full A–Z range (not X/Y/Z modulo 3) so distinct builders stay
  // distinguishable in the anonymized text.
  let builderCounter = 0;
  const builderMap = new Map<string, string>();
  for (const [_id, name] of sortByLengthDesc([...names.builderNames])) {
    if (builderMap.has(name)) continue;
    const label =
      builderCounter < 26
        ? String.fromCharCode("A".charCodeAt(0) + builderCounter)
        : String(builderCounter + 1);
    builderMap.set(name, `[BUILDER_${label}]`);
    builderCounter += 1;
  }

  // 4. Channels → [CHANNEL_NAME]
  const channelMap = new Map<string, string>();
  for (const [_id, name] of sortByLengthDesc([...names.channelNames])) {
    if (channelMap.has(name)) continue;
    channelMap.set(name, `[CHANNEL_NAME]`);
  }

  let out = content;

  for (const [orig, repl] of companyMap) {
    const before = out;
    out = replaceWord(out, orig, repl);
    if (before !== out) replacements[orig] = repl;
  }
  for (const [orig, repl] of agentMap) {
    const before = out;
    out = replaceWord(out, orig, repl);
    if (before !== out) replacements[orig] = repl;
  }
  for (const [orig, repl] of builderMap) {
    const before = out;
    out = replaceWord(out, orig, repl);
    if (before !== out) replacements[orig] = repl;
  }
  for (const [orig, repl] of channelMap) {
    const before = out;
    out = replaceWord(out, orig, repl);
    if (before !== out) replacements[orig] = repl;
  }

  // 5. UUIDs / artifact references → [ARTIFACT_REF_N]
  let refCounter = 0;
  const refMap = new Map<string, string>();
  out = out.replace(UUID_RE, (match) => {
    const key = match.toLowerCase();
    let label = refMap.get(key);
    if (!label) {
      refCounter += 1;
      label = `[ARTIFACT_REF_${refCounter}]`;
      refMap.set(key, label);
      replacements[match] = label;
    }
    return label;
  });

  // 6. Absolute ISO timestamps → relative form
  out = out.replace(ISO_DATE_RE, (match) => {
    const parsed = Date.parse(match);
    if (Number.isNaN(parsed)) return match;
    const rel = relativeTime(parsed, now.getTime());
    replacements[match] = rel;
    return rel;
  });

  return { content: out, replacements };
}

/**
 * Convert an absolute timestamp into a coarse relative description.
 * V1 only needs hour/day-level granularity — judges should not be able to
 * cross-reference exact times.
 */
export function relativeTime(then: number, now: number): string {
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 0) return "in the future";
  if (diffSec < 60) return "just now";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} months ago`;
  const years = Math.round(months / 12);
  return `${years} years ago`;
}
