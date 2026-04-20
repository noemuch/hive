# QA Digest + Quota Resilience — Implementation Plan

**Date**: 2026-04-20
**Goal**: Elevate Noé's role from "IT project manager" to "product UX reviewer".
- Every morning at **08:00 UTC (≈ 9h Paris)**, Claude opens a pedagogical QA digest issue listing everything shipped + a visual test checklist.
- When Claude Max quotas exhaust on both accounts (Lyse + Finary), workflows self-pause on a labeled "quota-paused" state and auto-resume without human intervention once quotas reset.

## Deliverables

1. `.github/quota-state.json` — persistent state file tracking quota exhaustion deadlines (committed by bots).
2. `.github/workflows/daily-qa-digest.yml` — 08:00 UTC cron + workflow_dispatch that uses Claude Sonnet 4.6 to write the digest as a GitHub issue.
3. `.github/workflows/quota-monitor.yml` — 30-min cron that reads the state file and retires `quota-paused` labels once deadlines are past.
4. Updates to `claude-ready.yml` + `review.yml` — post-failure step that parses error output for "hit your limit", updates the state file via commit, and applies `quota-paused` on the triggering issue.
5. `CLAUDE.md` additions — documentation of the digest contract + quota resilience model.
6. 2 new labels: `qa-digest`, `quota-paused`.

## Sequencing

1. **State file first** — nothing can parse it if it doesn't exist.
2. **Labels** — needed by both quota-monitor and builder failure step.
3. **quota-monitor.yml** — independent, can be tested in isolation via `workflow_dispatch`.
4. **Updates to claude-ready.yml + review.yml** — depend on state file + labels.
5. **daily-qa-digest.yml** — independent, can be tested last via `workflow_dispatch`.
6. **CLAUDE.md** — documents the finished system.
7. **End-to-end validation** — dispatch digest manually, simulate quota exhaustion.

## Key design decisions

### State file schema

```json
{
  "primary_exhausted_until": null | "2026-04-20T20:00:00Z",
  "secondary_exhausted_until": null | "2026-04-21T00:00:00Z",
  "last_check": "2026-04-20T17:30:00Z",
  "history": [
    { "account": "primary", "detected_at": "2026-04-20T15:00:00Z", "reset_at": "2026-04-20T20:00:00Z", "run_url": "..." }
  ]
}
```

Appended to on each quota hit; `history` capped at 100 entries (circular).

### Error-to-reset parsing

Anthropic's error format is roughly: `You've hit your limit · resets 4pm (UTC)` or `resets 2026-04-20T20:00:00Z`. Fallback when parse fails: set deadline to `now + 2h` (conservative upper bound of 5h rolling bucket).

### Digest generation

Use `anthropics/claude-code-action@v1` with a specific prompt:
- Model: Sonnet 4.6 (cheaper than Opus, quality sufficient for summarization)
- Input context: `gh pr list --state merged --search "merged:>=YYYY-MM-DDT00:00:00Z"` + file diffs
- Output: single issue via `gh issue create`, labelled `qa-digest` + `priority:medium`
- Title format: `📋 QA Digest — <FR date>` (e.g. "📋 QA Digest — Mercredi 21 avril 2026")

### URL inference for QA checklist

Given a merged PR with files in `web/src/app/<route>/page.tsx`, infer:
- Path: `/<route>` (strip `web/src/app/` and `/page.tsx`, handle `[id]` as `:id`)
- URL: `https://hive-web-production.up.railway.app<path>`

For non-page changes (components, APIs), just describe in prose.

### Quota-monitor unlock logic

On each run:
1. Read `.github/quota-state.json`.
2. For primary/secondary: if `exhausted_until` past `now` → clear it.
3. If both cleared (or were already null) AND there are issues with `quota-paused` label:
   - Remove `quota-paused` from each
   - If the issue still has `agent-ready`, the dispatch-ready cron will naturally re-apply `ready-to-ship` on next run (or we can trigger it explicitly).
4. Commit the updated state file (even if no changes — keeps `last_check` fresh).

## Test plan

- **Unit**: jq + regex on fixture error strings for parse correctness.
- **Integration**: manual `workflow_dispatch` on `daily-qa-digest` against today's real merged PRs.
- **Simulation**: manually edit `.github/quota-state.json` to set a past deadline on an issue with `quota-paused` label → run quota-monitor → verify label removed + state cleared.

## Out of scope (future)

- Stripe-billed ANTHROPIC_API_KEY tier 3 fallback (complex, user rejected).
- SMS/push notifications for digest (email + GitHub mobile push are enough).
- Weekly rollup / monthly retrospective (evaluate after 1 week of daily).
- Multi-language digest (stays French-only for Noé).
