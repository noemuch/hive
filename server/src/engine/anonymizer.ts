/**
 * Server-side anonymizer for the Hive peer evaluation system.
 *
 * Strips identifying information from artifact content before sending to
 * the judge, ensuring unbiased grading.
 *
 * Replaces:
 *   - Agent names    → [AGENT_1], [AGENT_2], ... (sorted longest-first)
 *   - Company names  → [COMPANY_1], [COMPANY_2], ...
 *   - Builder names  → [BUILDER_1], [BUILDER_2], ...
 *   - UUIDs          → [ID_N]
 *   - ISO dates      → [DATE]
 */

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// Matches YYYY-MM-DD optionally followed by time/timezone components
const ISO_DATE_RE =
  /\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\b/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sort names longest-first so longer names match before substrings
 * (e.g. "Acme Corp Europe" before "Acme Corp"). Drops empty / 1-char entries.
 */
function sortByLengthDesc(names: string[]): string[] {
  return names
    .filter((n) => n && n.trim().length >= 2)
    .sort((a, b) => b.length - a.length);
}

function replaceWord(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, "gi");
  return haystack.replace(re, replacement);
}

export function anonymize(
  content: string,
  agentNames: string[],
  companyNames: string[],
  builderNames: string[],
): { content: string; replacementCount: number } {
  let out = content;
  let replacementCount = 0;

  // 1. Agent names → [AGENT_1], [AGENT_2], ...
  const sortedAgents = sortByLengthDesc(agentNames);
  sortedAgents.forEach((name, i) => {
    const repl = `[AGENT_${i + 1}]`;
    const next = replaceWord(out, name, repl);
    if (next !== out) replacementCount++;
    out = next;
  });

  // 2. Company names → [COMPANY_1], [COMPANY_2], ...
  const sortedCompanies = sortByLengthDesc(companyNames);
  sortedCompanies.forEach((name, i) => {
    const repl = `[COMPANY_${i + 1}]`;
    const next = replaceWord(out, name, repl);
    if (next !== out) replacementCount++;
    out = next;
  });

  // 3. Builder names → [BUILDER_1], [BUILDER_2], ...
  const sortedBuilders = sortByLengthDesc(builderNames);
  sortedBuilders.forEach((name, i) => {
    const repl = `[BUILDER_${i + 1}]`;
    const next = replaceWord(out, name, repl);
    if (next !== out) replacementCount++;
    out = next;
  });

  // 4. UUIDs → [ID_N] (deduplicated: same UUID always maps to same token)
  let idCounter = 0;
  const idMap = new Map<string, string>();
  out = out.replace(UUID_RE, (match) => {
    const key = match.toLowerCase();
    let token = idMap.get(key);
    if (!token) {
      idCounter++;
      token = `[ID_${idCounter}]`;
      idMap.set(key, token);
      replacementCount++;
    }
    return token;
  });

  // 5. ISO dates → [DATE]
  out = out.replace(ISO_DATE_RE, (match) => {
    // Skip pure numbers that happen to match the pattern (sanity check)
    if (!/\d{4}-\d{2}-\d{2}/.test(match)) return match;
    replacementCount++;
    return "[DATE]";
  });

  return { content: out, replacementCount };
}
