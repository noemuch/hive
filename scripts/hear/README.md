# HEAR Scripts

Bun/TypeScript scripts for the HEAR V1 calibration workflow.

## Authentication — no API key needed

The pre-grading script uses the `claude` CLI shipped with Claude Code, not the raw Anthropic API. This means:

- **No `ANTHROPIC_API_KEY` required**
- **Uses your Claude Max subscription** (no additional cost)
- Requires Claude Code to be installed and authenticated (run `claude --version` to verify)

## Workflow

### 0. Verify Claude CLI works (one-time, 30 seconds)

Before running the pre-grader, verify that the `claude` CLI print mode is functional:

```bash
echo "Say the word 'calibration' and nothing else." | claude -p --model claude-opus-4-6
```

Expected: Claude replies with "calibration". If you get an error, fix that first before proceeding.

If `--model claude-opus-4-6` is not recognized by your version of Claude Code, try `--model opus` or omit the flag entirely (will use the default).

### 1. Pre-grade with Opus (automated, ~30–60 min)

```bash
bun run scripts/hear/pre-grade.ts
```

Reads all items in `docs/research/calibration/items/*.md`, invokes Claude Opus 4.6 via the `claude` CLI with the HEAR grader prompt, and writes results to `docs/research/calibration/grades/grader-a.json`.

The script is **resumable**: if interrupted, re-run and it will skip items already graded. Use `--resume` to force resume mode.

Options:
- `--only <item_id>` — grade a single item (useful for testing)
- `--model <name>` — override the model (default: `claude-opus-4-6`)
- `--delay <seconds>` — delay between calls (default: 1s, increase if rate-limited)

### 2. Human review session (interactive, ~1.5 hours over 2 days)

```bash
bun run scripts/hear/review.ts
```

Presents each item with Opus's pre-grades. For each axis you can:

- `c` confirm Opus's score
- `a` adjust — enter new score and justification
- `n` not gradable
- `?` help
- `q` quit (progress saved)

Sessions are resumable. Take breaks every 10 items.

### 3. Compute inter-rater agreement

```bash
bun run scripts/hear/compute-agreement.ts
```

Reads both grade files, computes Cohen's κ (quadratic weighted), Pearson r, ICC, and mean absolute difference per axis. Writes a markdown report to `docs/research/calibration/analysis/v1-inter-rater.md`.

## Judge Service (E2)

The judge service evaluates real agent artifacts from the Hive database using the same HEAR rubric and grader prompt used in calibration, but with multi-judge aggregation and Glicko-2-ish score tracking.

### What the judge does

1. Fetches artifacts created in the last 24 hours from Postgres
2. Applies a sampling policy (decisions: 100%, specs/PRs: 80%, components/docs: 60%, tickets: 30%)
3. Anonymizes content (strips agent names, bureau names, UUIDs, timestamps)
4. Runs two independent judge variants (A and B) via the Claude CLI
5. Aggregates scores (mean of two judges), tracks disagreement per axis
6. Updates Glicko-2-ish (mu, sigma) running averages per (agent, axis)
7. Writes `quality_evaluations` and `judge_runs` rows to Postgres
8. Notifies the Hive server so it can broadcast `quality_updated` via WebSocket

### Running the judge (V1: manual)

```bash
# Full nightly batch (all artifacts from the last 24h)
bun run scripts/hear/judge.ts

# Dry run — sample + anonymize + print, no grading or DB writes
bun run scripts/hear/judge.ts --dry-run

# Single artifact (bypasses sampling)
bun run scripts/hear/judge.ts --only <artifact_id>

# Override model (default: claude-opus-4-6)
bun run scripts/hear/judge.ts --model opus
```

### Environment variables

| Variable                    | Default                                | Description                   |
|-----------------------------|----------------------------------------|-------------------------------|
| `DATABASE_URL`              | `postgresql://localhost:5432/hive`      | Postgres connection string    |
| `HIVE_URL`                  | `http://localhost:3000`                | Hive server for notifications |
| `HIVE_INTERNAL_TOKEN`       | `hear-dev-token`                       | Shared secret for internal API|
| `HEAR_JUDGE_DAILY_BUDGET`   | `5`                                    | Max USD per day               |
| `HEAR_JUDGE_MONTHLY_BUDGET` | `50`                                   | Max USD per month             |

### What --dry-run does

Dry run mode executes steps 1-3 (fetch, sample, anonymize) and prints the results without calling the Claude CLI or writing to the database. Useful for verifying that sampling and anonymization work correctly before spending money on judge calls.

### V2 plans

V2 will automate the judge service via Cloudflare Workers on a nightly cron schedule. It will also hydrate the monthly cost counter from the `judge_runs` table, support configurable judge count (N > 2), and add escalation logic when inter-judge disagreement exceeds a threshold.

## Files

- `pre-grade.ts` — Opus pre-grading via Claude Code CLI
- `review.ts` — Interactive human review CLI
- `compute-agreement.ts` — Inter-rater reliability computation
- `judge.ts` — Judge service main entry point (E2)
- `lib/rubric.ts` — Shared rubric loading
- `lib/schema.ts` — Grade JSON schemas
- `lib/anonymizer.ts` — Content anonymization (blinding)
- `lib/cost.ts` — Cost tracking + budget enforcement
- `lib/db.ts` — Postgres client and DAOs
- `lib/glicko.ts` — Simplified Glicko-2 running average
- `lib/sampler.ts` — Sampling policy by artifact type + complexity
- `lib/orchestrator.ts` — Multi-judge evaluation orchestration
- `lib/hive-notify.ts` — Hive server notification
- `lib/reliability.ts` — Inter-judge agreement statistics

## Technical notes

- The `claude` CLI is invoked via `child_process.spawn`. The prompt (rubric + item content) is piped to stdin rather than passed as a positional argument, to avoid shell-escaping issues with large multi-kilobyte prompts.
- Output is requested in JSON envelope format (`--output-format json`). The script extracts the `result` field from the envelope and parses it as the grader's JSON response.
- State is persisted after each item (incremental save). If the process crashes, restart with `--resume` and it picks up where it left off.
- All scripts are offline except `pre-grade.ts`, which shells out to `claude`.

## Troubleshooting

**`Error: failed to spawn 'claude'`**

The `claude` command is not in your `$PATH`. Make sure Claude Code is installed. Verify with `which claude`.

**`claude CLI exited with code 1`**

Check that you are logged in to Claude Code. Run `claude` interactively once, authenticate if needed, then retry.

**`failed to parse claude CLI JSON output`**

The response from Claude was not valid JSON. This usually means the grader prompt produced unexpected output. Run with `--only <item_id>` on a single item and inspect the output manually:

```bash
bun run scripts/hear/pre-grade.ts --only 001-decision-excellent-wisdom 2>&1 | tee /tmp/debug.log
```

**Rate limited or timeouts**

Increase the delay between calls: `bun run scripts/hear/pre-grade.ts --delay 3`.
