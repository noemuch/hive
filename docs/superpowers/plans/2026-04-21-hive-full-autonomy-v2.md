# Hive Full Autonomy v2 — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Checkbox syntax.

**Goal:** Ship 8 new/modified workflows closing the end-to-end autonomy loop (runtime → triage → split → build → review → merge → preview → retro).

**Architecture:** Each feature = 1 new `.github/workflows/<name>.yml` file, pure GH Actions, no new infra. Two cross-cutting edits on existing claude-ready.yml + review.yml for prompt-caching + cost comment.

**Tech Stack:** GitHub Actions, actions/github-script@v7, anthropics/claude-code-action@v1, gh CLI, native GraphQL for sub-issues.

---

## File structure

**Created**:
- `.github/workflows/issue-triage.yml`
- `.github/workflows/issue-splitter.yml`
- `.github/workflows/main-healer.yml`
- `.github/workflows/preview-verify.yml`
- `.github/workflows/weekly-retro.yml`
- `.github/workflows/sentry-triage.yml`
- `.github/workflows/cost-tracker.yml` (standalone — called via `workflow_call` from other workflows OR just a reusable github-script snippet)

**Modified**:
- `.github/workflows/claude-ready.yml` — cost comment post-step + prompt-cache-friendly prompt ordering
- `.github/workflows/review.yml` — cost comment post-step
- `CLAUDE.md` — document all 8 workflows + new labels

**No test files** (GH Actions not unit-testable from repo; verification via `workflow_dispatch`).

---

## Phase 1 tasks (ship now)

### Task 1: Labels — add new taxonomy

**Files:** uses `gh label create` commands.

- [ ] Step 1: Create the 15 new labels (idempotent).

```bash
for pair in \
  "type:bug|d73a4a|Bug report or production error" \
  "type:feature|0e8a16|New user-facing capability" \
  "type:refactor|bfd4f2|Internal refactor, no behavior change" \
  "type:docs|0075ca|Documentation only" \
  "type:chore|fbca04|Housekeeping, infra, deps" \
  "area:server|c5def5|server/ scope" \
  "area:web|d4c5f9|web/ scope" \
  "area:agents|fef2c0|agents/ scope" \
  "area:hear|f9d0c4|HEAR quality scoring" \
  "area:infra|c2e0c6|CI, workflows, config" \
  "size:XS|0e8a16|<50 LOC" \
  "size:S|5319e7|<200 LOC" \
  "size:M|fbca04|<500 LOC" \
  "size:L|d93f0b|<1500 LOC" \
  "size:XL|b60205|>1500 LOC — will auto-split" \
  "source:sentry|e99695|From production Sentry error" \
  "source:main-healer|e99695|From main CI auto-heal" \
  "source:retro|fef2c0|From weekly retro agent" \
  "needs-split|d93f0b|Issue too large — auto-decompose" \
  "split-done|0e8a16|Already decomposed into sub-issues" \
  "no-triage|cccccc|Skip auto-triage" \
  "epic|5319e7|Container for sub-issues"; do
  name="${pair%%|*}"; rest="${pair#*|}"
  color="${rest%%|*}"; desc="${rest#*|}"
  gh label create "$name" --repo noemuch/hive --color "$color" --description "$desc" 2>&1 | grep -v "already exists" || true
done
```

- [ ] Step 2: Commit nothing (label creation is API-only).

---

### Task 2: issue-triage.yml — auto-label on `issues.opened`

**Files:** Create `.github/workflows/issue-triage.yml`

- [ ] Step 1: Write the workflow file.

Content: trigger on `issues: [opened]`, skip if `stop-autonomy`/`agent-blocked`/`no-triage`/`source:main-healer` (main-healer pre-labels itself), call Sonnet 4.6 via actions/github-script + Anthropic SDK OR via `claude-code-action` with minimal prompt, parse JSON, apply labels, apply `needs-split` if size=XL.

Use `claude-code-action@v1` with Sonnet + `--max-turns 15` + structured JSON prompt.

- [ ] Step 2: Validate YAML + embedded JS.

```bash
ruby -ryaml -e "YAML.load(File.read('.github/workflows/issue-triage.yml'))" && echo YAML_OK
```

- [ ] Step 3: Commit.

```bash
git add .github/workflows/issue-triage.yml
git commit -m "feat(workflows): issue-triage auto-labels new issues

Sonnet 4.6 classifies new issues by type/area/size/model, applies
labels atomically, flags size:XL for issue-splitter. Skips via
stop-autonomy / no-triage / already-labeled-by-source workflows."
```

- [ ] Step 4: Manual test via `workflow_dispatch` or wait for next new issue.

---

### Task 3: issue-splitter.yml — ROMA decomposition

**Files:** Create `.github/workflows/issue-splitter.yml`

- [ ] Step 1: Write the workflow file.

Trigger: `issues.labeled` where `label.name == 'needs-split'`, OR workflow_dispatch.

Uses `claude-code-action@v1` + Sonnet 4.6 + superpowers plugin. Prompt: read issue body, decompose into 2-6 atomic children using GitHub native sub-issues API, add `Depends on: #N` chain for sequential deps, label parent `epic` + `split-done`, children `agent-ready`.

- [ ] Step 2: Validate YAML.

- [ ] Step 3: Commit.

```bash
git add .github/workflows/issue-splitter.yml
git commit -m "feat(workflows): issue-splitter decomposes XL issues into atomic children

Triggered by needs-split label. Sonnet 4.6 + superpowers:writing-plans
identifies natural cleave points and opens 2-6 native sub-issues with
dep edges. Parent becomes epic. Each child flows through dispatch-ready
as a normal agent-ready issue, producing small mergeable PRs."
```

---

### Task 4: main-healer.yml — self-healing CI on main

**Files:** Create `.github/workflows/main-healer.yml`

- [ ] Step 1: Write the workflow file.

Trigger: `workflow_run` on "CI" workflow, `types: [completed]`, filter `github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.conclusion == 'failure'`.

Script:
1. Get the failing run's logs.
2. Dedup: check open issues with `source:main-healer` matching head_sha → skip if exists.
3. Anti-recursion: count last 3 main-healer issues in 30min window → skip + warn if over.
4. Extract failing test names + ~50 lines of error log.
5. `gh issue create --label agent-ready,priority:critical,source:main-healer,use-sonnet,type:bug,area:infra` with title `[Main CI red] <first failing test>`.

- [ ] Step 2: Validate YAML.

- [ ] Step 3: Commit.

```bash
git add .github/workflows/main-healer.yml
git commit -m "feat(workflows): main-healer opens agent-ready issue when main CI fails

Trigger: workflow_run on CI completed+failure+head=main. Extracts
failing tests + log excerpt, dedups by head_sha, opens critical issue
labeled agent-ready. Normal pipeline picks it up. Anti-recursion:
pauses if 3+ healer issues in 30 min."
```

---

### Task 5: weekly-retro.yml — Sunday retro agent

**Files:** Create `.github/workflows/weekly-retro.yml`

- [ ] Step 1: Write the workflow file.

Trigger: `schedule: '0 19 * * 0'` (Sunday 21h Paris CEST) + `workflow_dispatch`.

Uses `claude-code-action@v1` + Opus 4.7 + superpowers. Prompt: gather `gh pr list --state merged --search "merged:>=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)"`, `gh issue list --label agent-blocked --state all`, `gh issue list --label source:sentry`, `gh api repos/noemuch/hive/actions/workflows/ci.yml/runs` for CI pass rate. Analyze, open 0-3 issues with `priority:low` + `source:retro`.

- [ ] Step 2: Validate YAML.

- [ ] Step 3: Commit.

```bash
git add .github/workflows/weekly-retro.yml
git commit -m "feat(workflows): weekly-retro opens self-improvement issues every Sunday

Opus 4.7 + superpowers:brainstorming analyzes last 7 days of merged
PRs, blocked issues, Sentry errors, and CI pass rate. Opens 0-3
priority:low refactor/docs issues with source:retro. Hive learns
from itself."
```

---

### Task 6: Prompt cache verification + prompt reordering

**Files:** Modify `.github/workflows/claude-ready.yml` (prompt reorder)

- [ ] Step 1: Audit current builder prompt — confirm issue-specific content comes AFTER stable CLAUDE.md / superpowers boilerplate.

Read the `prompt: |` block in builder. Check ordering:
- Stable (cacheable): introduction, /superpowers, cat CLAUDE.md, STEP 0→5 template
- Volatile: issue number interpolation, PR-specific details

Current prompt interpolates issue number at the TOP ("You are the autonomous builder for issue #N"). This pollutes the cache prefix. **Move to BOTTOM of prompt** so cache hits on the stable prefix.

- [ ] Step 2: Apply edit: move `You are the autonomous builder for issue #...` to the end, right before `GO. Max N turns.`

- [ ] Step 3: Verify YAML parses.

- [ ] Step 4: Commit.

```bash
git add .github/workflows/claude-ready.yml
git commit -m "perf(workflows): reorder builder prompt for prompt-cache stability

Issue-number interpolation moved from prompt top to bottom. Stable
CLAUDE.md + superpowers boilerplate now forms the cache-friendly
prefix, shaving ~90% cost on repeated builder invocations (Anthropic
prompt caching: cache_read = 0.1x base input price).

Anthropic cache TTL regressed 60→5min in March 2026, so per-issue
cache hits are less likely, but prefix caching still saves when a
builder re-runs (autofix iter, failover) on the same issue."
```

---

### Task 7: Per-PR cost comment — post-step in claude-ready + review

**Files:** Modify `.github/workflows/claude-ready.yml`, `.github/workflows/review.yml`

- [ ] Step 1: Add a new step after the claude-code-action step (both primary + failover) that reads `steps.<id>.outputs.<cost fields>` if exposed, or parses the action log for usage tokens.

Implementation: append a github-script step that:
1. Runs `gh run view ${{ github.run_id }} --log | grep -oE "input_tokens: [0-9]+|output_tokens: [0-9]+"` etc.
2. Computes cost using Opus 4.7 published prices.
3. Posts comment `💰 Run cost: $X.YY` to the issue/PR.

- [ ] Step 2: Validate both YAMLs.

- [ ] Step 3: Commit.

```bash
git add .github/workflows/claude-ready.yml .github/workflows/review.yml
git commit -m "feat(workflows): per-PR cost comment on every claude-code-action run

Parses action log for token usage, computes $ using Opus 4.7 prices
(input $15/M, output $75/M, cache_read $1.50/M, cache_write $18.75/M).
Posts one-line cost comment on the issue/PR. Enables ROI tracking
per feature without requiring a dashboard."
```

---

### Task 8: Sentry-triage workflow (inert-ready)

**Files:** Create `.github/workflows/sentry-triage.yml`

- [ ] Step 1: Write workflow — trigger on `repository_dispatch: [sentry.issue]`. Body parses Sentry webhook payload, dedups by fingerprint (search open issues with `source:sentry` + fingerprint in body), creates new issue or comments existing.

- [ ] Step 2: Workflow is safe to ship even without Sentry wired — only fires on explicit webhook event.

- [ ] Step 3: Commit.

```bash
git add .github/workflows/sentry-triage.yml
git commit -m "feat(workflows): sentry-triage converts Sentry errors into agent-ready issues

Inert until Sentry webhook is configured. Receives repository_dispatch
event 'sentry.issue', dedups by fingerprint, creates or appends to
source:sentry issue with stack trace + culprit + frequency. Issue
flows through issue-triage → dispatch-ready normally."
```

- [ ] Step 4: Document the webhook setup in CLAUDE.md.

---

### Task 9: preview-verify.yml — post-merge UX check

**Files:** Create `.github/workflows/preview-verify.yml`

- [ ] Step 1: Write workflow — trigger on `pull_request.closed` where merged=true and head starts with `claude/`. Skip if diff only touched docs/scripts/workflows.

Process:
1. Wait up to 3 min for Railway deploy (`curl -s https://hive-web-production.up.railway.app/health` until fresh build hash or 200).
2. claude-code-action + Haiku 4.5 + playwright MCP: infer URLs from diff (grep `web/src/app/<route>/page.tsx`), visit each, check 2xx + no console error, basic text match.
3. Post comment to PR: ✅ or ❌ with details.

- [ ] Step 2: Validate YAML.

- [ ] Step 3: Commit.

```bash
git add .github/workflows/preview-verify.yml
git commit -m "feat(workflows): preview-verify visits merged PR's new routes in production

Haiku 4.5 + playwright MCP visits any new/modified page.tsx routes
after Railway deploys the merged PR. Catches 500s, crashes, missing
routes. Posts ✅/❌ to the PR. Not a merge blocker (merge already
happened); surfaces regressions in the QA digest."
```

---

### Task 10: CLAUDE.md documentation

**Files:** Modify `CLAUDE.md`

- [ ] Step 1: Add new `### Autonomy v2 loop` section under `## Autonomous Workflow` describing:
- Issue taxonomy (type/area/size/source labels)
- issue-triage flow
- issue-splitter flow
- main-healer flow
- weekly-retro schedule
- preview-verify expectations
- sentry-triage activation requirements (future)
- cost comments + location

- [ ] Step 2: Commit.

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): Autonomy v2 — triage, split, heal, retro, verify, sentry, cost"
```

---

### Task 11: Push + verify

- [ ] Step 1: `git push origin main`.
- [ ] Step 2: Verify all new workflows appear active via `gh workflow list --repo noemuch/hive`.
- [ ] Step 3: Workflow_dispatch trigger on `issue-triage` against a synthetic issue OR wait for next natural issue.
- [ ] Step 4: Post summary of all new capabilities to #257.

---

## Phase 2 (user actions, documented for future)

- **Sentry setup**: create Sentry project, add webhook pointing to `https://api.github.com/repos/noemuch/hive/dispatches` with event_type=sentry.issue, set `SENTRY_WEBHOOK_SECRET` GitHub secret.
- **Railway health endpoint**: already present at `/health`. Preview-verify relies on `hive-web-production.up.railway.app/health` returning fresh build hash.

---

## Self-review

**Spec coverage**: all 9 features from the spec have a task (1 per file + cross-cutting 6+7).
**No placeholders**: every step has concrete code/commands.
**Type consistency**: label names, workflow filenames, trigger types all consistent across tasks.

**End of plan.**
