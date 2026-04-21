# Hive Full Autonomy v2 — Design Spec

**Date**: 2026-04-21
**Author**: Claude Opus 4.7 (with Noé)
**Goal**: Close the end-to-end autonomy loop so Hive literally develops itself — production bugs flow back as issues, large issues auto-decompose, main CI self-heals, preview URLs are verified post-merge, and the system retros weekly on its own output.

---

## 1. Motivation + market alignment

Current Hive autonomy v1 (7 workflows, STEP 1.5 conflict resolution, throttle, nudge, digest) already outpaces the GitHub Agentic Workflows 2026 baseline on throughput and conflict handling but lags on three loops that close the dev cycle:

1. **Runtime → dev loop** — Hive runs on Railway; a runtime error today has no path back into the dev system. Standard: Sentry Seer / Continue CLI + Sentry MCP / GitAuto all feed production errors into agent-ready issues.
2. **Large scope → many small PRs** — a single `agent-ready` label on a big issue produces one large PR that is statistically more likely to conflict. Anthropic's Agent Teams & ROMA pattern decompose at the agent-team level.
3. **Main health** — if `main`'s CI fails post-merge, every subsequent PR starts from a broken base. The "Pipeline Doctor / Repair Agent" pattern auto-heals.

Plus two quality multipliers (preview verification + weekly retro) and two cost/observability polish items (prompt cache keep-alive + per-PR cost comment), and one soft triage improvement (auto-labeling on new issues).

**Two-reviewer for risky paths**: explicitly out of scope — conflicts with the user's "Claude merges TOUT" directive from 2026-04-20. Can be re-introduced later as opt-in via `needs-second-opinion` label if wanted.

---

## 2. Architecture — 8 new/modified workflows + 1 config

```
                           ┌───────────────────────────────────────┐
                           │        PRODUCTION (Railway)           │
                           │   Sentry catches runtime errors ──┐   │
                           └────────────────────────────────┬──┼───┘
                                                            │  │
                ┌────────── sentry-triage.yml ──────────────┘  │
                │  Webhook receives Sentry event,               │
                │  dedups by fingerprint, creates               │
                │  issue with stack trace + context,            │
                │  labels `agent-ready` + `source:sentry`       │
                └────────────────┬──────────────────────────────┘
                                 │
                                 ▼
 ┌─────────── issue-triage.yml ───────────┐
 │  NEW issue (any source) → Sonnet 4.6:  │   ◄─── enriches `agent-ready` backlog
 │   - Auto-labels: type, area, size      │
 │   - If size=XL → apply `needs-split`   │
 └────────────────┬───────────────────────┘
                  │
                  ▼
 ┌─────────── issue-splitter.yml ─────────────────────┐
 │  Triggered by `needs-split` label.                 │
 │  Sonnet 4.6 + superpowers:brainstorming:           │
 │   - Reads body + code context                      │
 │   - Emits 2-6 child issues via native sub-issues   │
 │   - Parent becomes `epic`; each child agent-ready  │
 │   - Dep `Depends on` edges if sequential           │
 └────────────────┬───────────────────────────────────┘
                  │
                  ▼
        dispatch-ready (unchanged, v1)
                  │
                  ▼
        claude-ready (unchanged, v1)
                  │
                  ▼
        review.yml v8 (unchanged — STEP 1.5 auto-resolve)
                  │
                  │ auto-merge
                  ▼
 ┌─────────── preview-verify.yml ──────────────────────┐
 │  Fires on pull_request.closed where merged=true.    │
 │  Waits for Railway to deploy main (up to 5 min).    │
 │  Claude Haiku 4.5 visits new pages inferred from    │
 │  the PR's diff, screenshots + checks basic health.  │
 │  Findings → comment on merged PR + #257.            │
 └────────────────┬────────────────────────────────────┘
                  │
                  ▼ (parallel)
 ┌─────────── main-healer.yml ─────────────────────────┐
 │  Fires on push to main (after merge).               │
 │  Watches CI. If `bun test` or lint fails:           │
 │   - Open issue `fix/main-healer-<sha>`              │
 │   - Label `agent-ready` + `priority:critical`       │
 │   - Body: "Main CI red at <sha>. Logs: <excerpt>."  │
 │  Builder naturally picks it up via throttle.        │
 └─────────────────────────────────────────────────────┘

 ┌─────────── weekly-retro.yml ────────────────────────┐
 │  Cron: '0 19 * * 0' (Sunday 21h Paris).             │
 │  Opus 4.7 + superpowers:brainstorming:              │
 │   - Read last 7 days of merged PRs + agent-blocked  │
 │     issues + Sentry issues still open               │
 │   - Identify: recurring bug patterns, test gaps,    │
 │     CLAUDE.md drift, tech debt hotspots             │
 │   - Open 1-3 `refactor` or `docs` PRs,              │
 │     priority:low, tagged `source:retro`             │
 └─────────────────────────────────────────────────────┘
```

Plus two cross-cutting improvements applied to ALL claude-code-action uses:

- **Prompt cache keep-alive** (Task 7): verify `claude-code-action@v1` marks long prompt sections as `cache_control` / `ephemeral`. If not, patch the wrapper or switch to `@v2` when available. As a stopgap, enable `1h` cache explicitly (check action's input).
- **Per-PR cost comment** (Task 8): post-run step parses `claude-code-action` usage output, writes one-line cost summary to the PR comment: `💰 This run: $X.YY (input=A cached=B output=C)`.

---

## 3. Features — detailed spec

### 3.1 `issue-triage.yml` — auto-labeling on new issues

**Trigger**: `issues.opened`

**Skip if**: issue has `stop-autonomy`, `agent-blocked`, `no-triage`, or is a PR (PRs route through the builder's existing flow).

**Process**:
1. Fetch issue title + body.
2. Sonnet 4.6 classifies:
   - **Type**: `bug` / `feature` / `refactor` / `docs` / `chore`
   - **Area**: `server` / `web` / `agents` / `hear` / `infra` / `docs`
   - **Size**: `XS` (< 50 LOC) / `S` (< 200) / `M` (< 500) / `L` (< 1500) / `XL` (> 1500)
   - **Routing hint**: `use-haiku` (XS + docs/chore), `use-sonnet` (S + bug/refactor/chore), else default (Opus)
3. Apply labels atomically.
4. If `size:XL` → also apply `needs-split`.

**Output format** (structured JSON via Sonnet):
```json
{"type": "bug", "area": "server", "size": "M", "model_hint": "use-sonnet",
 "rationale": "Touches auth middleware, medium scope, logic bug — Sonnet 4.6 sufficient."}
```

**Budget**: 15 turns, ~800 input tokens, ~200 output tokens per issue. Cost: ~$0.005/issue.

**Failure mode**: if LLM classification fails → apply default `use-sonnet` label + escalate comment.

### 3.2 `issue-splitter.yml` — ROMA-style decomposition

**Trigger**: `issues.labeled` where label == `needs-split` OR manual `workflow_dispatch`.

**Skip if**: issue has `stop-autonomy`, `agent-blocked`, `split-done`.

**Process**:
1. Read issue body + linked code context (grep paths referenced).
2. Sonnet 4.6 + `superpowers:brainstorming` + `superpowers:writing-plans` decomposes:
   - Identifies natural cleave points (per-file, per-endpoint, per-component)
   - Emits 2-6 **child issues** with:
     - Atomic scope (single PR each)
     - Dep graph: `Depends on: #N` between siblings if order matters
     - Labels: `agent-ready` + inherited `source:*` + size hint
   - Uses GitHub native sub-issues API (REST `/issues/:n/sub_issues`)
3. Parent issue:
   - Labeled `epic`
   - `needs-split` removed, `split-done` added
   - Body appended with child list
4. Summary posted to #257.

**Budget**: 30 turns, ~3k input / 1k output. Cost: ~$0.05/split.

**Safety**: if decomposition cannot produce > 1 atomic child → don't split, remove `needs-split`, comment "scope not decomposable — proceed as single PR".

### 3.3 `sentry-triage.yml` — runtime errors → agent-ready issues

**Prerequisite**: Sentry project set up with `SENTRY_WEBHOOK_SECRET` stored in GitHub secrets. (If Sentry not yet configured, the workflow is inert but ready.)

**Trigger**: `repository_dispatch` event_type = `sentry.issue` (Sentry sends webhook → GitHub API with custom event).

**Dedup**: Sentry provides `fingerprint` per error. We map fingerprint → existing `source:sentry` issue. If exists + open → add comment "+1 occurrence". If closed → reopen.

**Process**:
1. Receive webhook payload: error title, stack trace, culprit, count, user context (anonymized).
2. Search existing issues with `label:source:sentry` + `in:body <fingerprint>`.
3. If match → comment "+1 occurrence at <timestamp>, total=N".
4. If no match → create new issue:
   - Title: `[Sentry] <culprit>: <error message>`
   - Body: stack trace, URL where error occurred, frequency, suggested file (from culprit path).
   - Labels: `agent-ready`, `source:sentry`, `priority:high` (or `critical` if count > 50)
   - Trigger issue-triage to classify.

**Anthropic Seer integration (optional)**: if `SENTRY_SEER_ENABLED=true`, ask Sentry Seer for root cause guess, include in issue body.

**Budget**: zero LLM cost for dedup path; triage path reuses issue-triage budget.

### 3.4 `main-healer.yml` — self-healing main CI

**Trigger**:
- `workflow_run` on `CI` workflow, `completed`, where `head_branch == 'main'` and `conclusion == 'failure'`
- `workflow_dispatch` (manual)

**Skip if**: an issue labeled `source:main-healer` is already open for the current HEAD sha.

**Process**:
1. Fetch CI failure logs.
2. Extract failing test names + error lines.
3. Open issue:
   - Title: `[Main CI red] <first failing test>`
   - Body: failing tests, last commit info, log excerpt (~50 lines).
   - Labels: `agent-ready`, `priority:critical`, `source:main-healer`, `use-sonnet`.
4. issue-triage fires → classifies area. dispatch-ready picks it up (priority:critical could be given slot priority in throttle — see future work).
5. Builder fixes. Review auto-merges. Main heals.

**Anti-recursion**: skip if last 3 main-healer issues opened within 30 min (prevents loop if the healer itself introduces the break).

### 3.5 `preview-verify.yml` — post-merge UX verification

**Prerequisite**: Railway auto-deploys `main` on every push. Production URL = `https://hive-web-production.up.railway.app`.

**Trigger**: `pull_request.closed` where `merged == true` AND `head.ref startsWith 'claude/'`.

**Skip if**: diff touched only `docs/**`, `scripts/**`, `.github/**`, or `*.md`.

**Process**:
1. Wait 3 min for Railway deploy (or poll `/health` until 200 with fresh build hash).
2. Haiku 4.5 + playwright MCP:
   - Infer URLs to check from diff (files matching `web/src/app/<route>/page.tsx` → test `/<route>`)
   - Visit each, screenshot, check for:
     - HTTP 2xx (not 500)
     - No console errors in browser logs
     - Page text contains expected keyword (from issue title)
3. Post result to original PR:
   - ✅ All N routes healthy → one-line comment
   - ❌ Regression detected → detailed comment + auto-open `[Preview regression]` issue linked to the PR

**Budget**: 25 turns Haiku, ~$0.02/PR.

**Limitation**: cannot catch all visual bugs, but catches 500s, crashes, missing routes.

### 3.6 `weekly-retro.yml` — self-improvement loop

**Trigger**: cron `0 19 * * 0` (Sunday 21h Paris) + `workflow_dispatch`.

**Process**:
1. Gather last 7 days:
   - Merged PRs (count, areas, cycle time)
   - agent-blocked issues (reasons)
   - open Sentry-source issues
   - CI failure rate on main
   - quota hits
2. Opus 4.7 + `superpowers:brainstorming`:
   - Patterns in bugs (same file edited 3+ times? → refactor candidate)
   - CLAUDE.md drift (instruction violated? → doc fix)
   - Test coverage gaps (bug classes without test coverage? → add tests)
3. Output: 0-3 `refactor` or `docs` issues/PRs:
   - Priority: `priority:low`
   - Labels: `source:retro`, `agent-ready`
   - Will flow through normal pipeline

**Cost**: ~$0.50/week.

### 3.7 Prompt cache keep-alive verification

**Investigation**:
1. Check `claude-code-action@v1` source/docs for `cache_control` / `ephemeral` support.
2. Check if action already marks system prompt as cacheable.
3. If YES: verify 1h cache is used (not 5min regressed default) by examining a completed run's usage metrics.
4. If NO: submit a follow-up issue upstream OR add wrapper.

**Stopgap**: `claude-code-action` accepts `anthropic_extra_headers` input — we can add `anthropic-beta: prompt-caching-2024-07-31` + structure our prompts to put long/stable context (CLAUDE.md content) at the START (cached) and the specific issue details at the END (non-cached).

**Fix path**: rewrite the "Builder prompt" in `claude-ready.yml` to:
1. Put CLAUDE.md + superpowers preamble in FIRST 2000 tokens (cache-stable).
2. Put issue-specific context (issue body, diff, etc.) LATER.
3. Action may or may not apply cache_control markers — investigate.

**Deliverable**: Either a confirmed "cache is working" note OR a concrete fix commit.

### 3.8 Per-PR cost comment

**Trigger**: added as a post-step in `claude-ready.yml` and `review.yml`.

**Process**:
1. After `claude-code-action` completes, read its `costs_by_model` output (if exposed) OR parse the action's log for `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`.
2. Compute cost (Opus 4.7 published prices: `$15/M input, $75/M output, $1.50/M cache_read, $18.75/M cache_write`).
3. Post on PR (once per run): `💰 Run cost: $X.YY · input=A (cached=B) · output=C · model=opus-4-7`
4. Also log to #257 weekly sum.

**Budget**: zero LLM cost. Pure accounting.

---

## 4. Non-goals (explicit)

- **Two-reviewer for risky paths** — conflicts with "Claude merges TOUT" philosophy.
- **Auto-rollback on bad main merge** — main-healer auto-fixes forward; rollback is more dangerous than fix-forward for a solo-dev project.
- **Self-hosted LLM / fine-tuning** — the ROI is not there at current volume.
- **GitHub Agentic Workflows migration** — their model forbids auto-merge, which we rely on. Not compatible.
- **Kubernetes / external orchestrator** — GH Actions is sufficient.
- **Multi-agent debate** — Anthropic research suggests marginal ROI for coding tasks < high-stakes research.

---

## 5. Error handling + invariants

| Failure | Detection | Recovery |
|---|---|---|
| issue-triage LLM fails | non-zero exit | apply default `use-sonnet` + comment |
| issue-splitter cannot decompose | budget hit, no child issues | remove `needs-split` + proceed as single PR |
| sentry webhook replay | fingerprint match | dedup comment, no new issue |
| main-healer infinite loop | 3+ healer issues in 30min | pause healer, label `agent-blocked` on last |
| preview-verify false-negative | Haiku misreads screenshot | human reviews on QA digest; not a merge blocker anyway (merge already happened) |
| weekly-retro produces noise | issues marked priority:low | dispatch-ready dequeues them last; manual close if garbage |
| prompt cache not honored | cost blows up | observed via per-PR cost comment; fix follow-up |
| cost comment parse fails | log parse error | skip, log warning, no user-facing failure |

## 6. Rollout

**Phase 1 — immediate value (this session)**:
1. issue-triage.yml
2. issue-splitter.yml
3. main-healer.yml
4. weekly-retro.yml (cron set, but first fire Sunday)
5. Prompt cache verification (investigation + docstring)
6. Per-PR cost comment (in claude-ready + review)

**Phase 2 — require external config (after user wires up)**:
7. sentry-triage.yml — **needs Sentry project + webhook + `SENTRY_WEBHOOK_SECRET`**. Workflow ships ready, inert until secret present.
8. preview-verify.yml — **needs Railway deploy URL confirmed**. Workflow ships with env default, user can override.

**Phase 3 — observation, 1 week**:
9. Decide if two-reviewer is needed based on merged-PR regression rate.

---

## 7. Testing strategy

- **Dry-run each workflow** via `workflow_dispatch` before removing kill-switch.
- **issue-triage**: test on 3 real old issues (different sizes/types), assert labels applied correctly.
- **issue-splitter**: test on an artificially-large issue, assert 2-6 children opened with correct deps.
- **main-healer**: simulate by intentionally breaking main (local) then reverting — assert issue opens.
- **preview-verify**: test on the next real merge; assert comment appears with either ✅ or a detailed regression note.
- **weekly-retro**: manual dispatch; assert at most 3 issues opened, all `priority:low`.

---

## 8. Seamlessness review

Every feature added:
- ✅ Zero new UI
- ✅ Zero approval gates (preserves "Claude merges TOUT")
- ✅ Runs in GH Actions (no new infra)
- ✅ Issues/PRs visible via existing GitHub UI + QA digest
- ✅ Reversible via `stop-autonomy` label + workflow disable
- ✅ Observable via #257 automation log

**No item requires you to learn a new tool, configure a dashboard, or respond to alerts.** Everything either self-heals or surfaces in the morning digest.

---

**End of spec.**
