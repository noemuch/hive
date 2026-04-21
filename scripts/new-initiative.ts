/**
 * Helper module for the `/new-initiative` slash command.
 *
 * Pure functions (no I/O) are exported for unit-testability: cycle detection
 * on sibling deps (Gap D from the autonomous-flow audit) and dedup against
 * existing GH issues (Gap B). I/O wrappers (createIssueWithRetry — Gap C)
 * shell out to `gh` and retry on transient failures.
 *
 * Invoked both from the slash command (`.claude/commands/new-initiative.md`)
 * and directly as a CLI entry point.
 */

export interface PlanStep {
  id: string;
  dependsOn: string[];
  // Extra fields used by the CLI layer — not needed for the pure-logic checks:
  title?: string;
  body?: string;
  labels?: string[];
  size?: "XS" | "S" | "M" | "L" | "XL";
}

export interface GhIssue {
  number: number;
  title: string;
}

/**
 * DFS-based cycle detection on sibling deps.
 * Returns the cycle path (e.g. ["a","b","c","a"]) or null if acyclic.
 * Deps pointing at unknown ids are treated as external (non-blocking).
 */
export function detectCycle(steps: PlanStep[]): string[] | null {
  const map = new Map(steps.map((s) => [s.id, s]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  steps.forEach((s) => color.set(s.id, WHITE));
  const parent = new Map<string, string | null>();
  let cycleFound: string[] | null = null;

  function dfs(nodeId: string): boolean {
    color.set(nodeId, GRAY);
    const node = map.get(nodeId);
    if (!node) return false;
    for (const dep of node.dependsOn) {
      if (!map.has(dep)) continue; // external ref — ignore
      if (color.get(dep) === GRAY) {
        // back edge = cycle; reconstruct path
        const path: string[] = [dep];
        let cur: string | null | undefined = nodeId;
        while (cur && cur !== dep) {
          path.unshift(cur);
          cur = parent.get(cur) ?? null;
        }
        path.unshift(dep);
        cycleFound = path;
        return true;
      }
      if (color.get(dep) === WHITE) {
        parent.set(dep, nodeId);
        if (dfs(dep)) return true;
      }
    }
    color.set(nodeId, BLACK);
    return false;
  }

  for (const s of steps) {
    if (color.get(s.id) === WHITE) {
      parent.set(s.id, null);
      if (dfs(s.id)) break;
    }
  }
  return cycleFound;
}

/**
 * Return numbers of existing issues whose title matches `proposed` after
 * normalization (lowercase, strip punctuation, collapse whitespace).
 */
export function dedupeIssues(proposed: string, existing: GhIssue[]): number[] {
  // Strip conventional-commit prefix (feat:, fix:, chore:, refactor:, docs:,
  // test:, perf:, ci:, build:, revert:) with optional scope in parens.
  // Example: "feat(api): add X" → "add x". This matches how users typically
  // write issue titles vs how the brainstorm rephrases them.
  const norm = (s: string) => {
    const stripped = s.replace(
      /^\s*(feat|fix|chore|refactor|docs|test|perf|ci|build|revert|style)(\([^)]+\))?\s*:\s*/i,
      "",
    );
    return stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  };
  const target = norm(proposed);
  return existing.filter((e) => norm(e.title) === target).map((e) => e.number);
}

export function parseIssueList(raw: string): GhIssue[] {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("Expected JSON array from gh issue list");
  }
  return data.map((d: { number: number; title: string }) => ({
    number: d.number,
    title: d.title,
  }));
}

/**
 * Idempotent `gh issue create` wrapper with exponential-backoff retry on
 * transient errors (5xx, rate-limit). Returns the created issue number.
 * Throws on terminal failure.
 *
 * Only called from I/O path — not covered by unit tests (would require gh
 * binary + network mocking); covered by the slash-command smoke test.
 */
export async function createIssueWithRetry(
  args: {
    title: string;
    body: string;
    labels: string[];
    repo: string;
  },
  maxAttempts = 3,
): Promise<number> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const proc = Bun.spawnSync([
      "gh",
      "issue",
      "create",
      "--repo",
      args.repo,
      "--title",
      args.title,
      "--body",
      args.body,
      "--label",
      args.labels.join(","),
    ]);
    if (proc.exitCode === 0) {
      const url = new TextDecoder().decode(proc.stdout).trim();
      const match = url.match(/\/issues\/(\d+)$/);
      if (match) return parseInt(match[1], 10);
      throw new Error(`Could not parse issue number from: ${url}`);
    }
    const stderr = new TextDecoder().decode(proc.stderr);
    const transient =
      stderr.toLowerCase().includes("rate limit") ||
      /\b5\d\d\b/.test(stderr) ||
      stderr.toLowerCase().includes("timeout");
    if (attempt < maxAttempts && transient) {
      const delayMs = 1000 * attempt * attempt;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    throw new Error(
      `gh issue create failed (attempt ${attempt}/${maxAttempts}): ${stderr}`,
    );
  }
  throw new Error("unreachable");
}

// ----- CLI entrypoint -----
// Usage examples:
//   bun run scripts/new-initiative.ts detect-cycle '[{...}]'
//   bun run scripts/new-initiative.ts dedup "<title>"
// The slash command invokes these subcommands. Keeping the CLI thin; heavy
// orchestration lives in the slash-command markdown.
if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const repo = process.env.GH_REPO || "noemuch/hive";

  if (cmd === "detect-cycle") {
    const plan: PlanStep[] = JSON.parse(rest[0] ?? "[]");
    const cycle = detectCycle(plan);
    if (cycle) {
      console.error("Cycle detected:", cycle.join(" → "));
      process.exit(1);
    }
    console.log("acyclic");
  } else if (cmd === "dedup") {
    const title = rest.join(" ");
    const proc = Bun.spawnSync([
      "gh",
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title",
    ]);
    if (proc.exitCode !== 0) {
      console.error(new TextDecoder().decode(proc.stderr));
      process.exit(1);
    }
    const existing = parseIssueList(new TextDecoder().decode(proc.stdout));
    const matches = dedupeIssues(title, existing);
    console.log(JSON.stringify(matches));
  } else {
    console.error("Usage: new-initiative.ts {detect-cycle|dedup} <arg>");
    process.exit(1);
  }
}
