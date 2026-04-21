# Zero-Intervention Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the three remaining human-intervention points (merge conflicts, thundering-herd parallelism, cron drift) in Hive's autonomous GitHub Actions workflow.

**Architecture:** Three coordinated changes to `.github/workflows/`:
1. Review.yml gains a STEP 1.5 that auto-rebases DIRTY PRs using superpowers:systematic-debugging with a hard budget (3 files / 3 hunks / 3 iters) before falling back to `agent-blocked`.
2. Dispatch-ready.yml gains a concurrency throttle (max 5 open claude/* PRs) so only N slots are dispatched per cron tick; the rest stay `agent-ready` and wait.
3. New workflow `proactive-rebase.yml` (10-min cron) calls `gh pr update-branch --rebase` on any BEHIND claude/* PR so they never drift to DIRTY.
Plus a one-line cron fix on daily-qa-digest.yml (`0 8` → `0 7`).

**Tech Stack:** GitHub Actions (YAML), actions/github-script@v7, gh CLI, anthropics/claude-code-action@v1 (already wired for Opus 4.7 + superpowers plugin pinned to `bb77301`).

---

## File Structure

**Files modified:**
- `.github/workflows/review.yml` — add STEP 1.5 (conflict auto-resolution) between existing STEP 1 (rebase BEHIND) and STEP 2 (CI check); bump `--max-turns` to 95.
- `.github/workflows/dispatch-ready.yml` — add throttle check in `compute-ready` script before the ready-to-ship application loop.
- `.github/workflows/daily-qa-digest.yml` — change cron from `0 8 * * *` to `0 7 * * *`; update adjacent comment.
- `CLAUDE.md` — document the new behaviors under existing `## Autonomous Workflow` and `## Merge Authority` sections.

**Files created:**
- `.github/workflows/proactive-rebase.yml` — new workflow, single job, ~60 lines.

**No test files** — GitHub Actions workflows aren't unit-testable from this repo; verification is via `workflow_dispatch` + observation on real PRs (documented in each task).

**No new secrets, no new labels, no schema changes.** The `MAX_PARALLEL_PRS = 5` constant lives at the top of `dispatch-ready.yml` as a JS const for easy tuning.

---

## Task 1: Fix daily QA digest cron timing

**Files:**
- Modify: `.github/workflows/daily-qa-digest.yml:12-14`

- [ ] **Step 1: Read current cron line**

Run:
```bash
grep -n "cron:" .github/workflows/daily-qa-digest.yml
```
Expected output:
```
13:    - cron: '0 8 * * *'  # 08:00 UTC daily
```

- [ ] **Step 2: Replace cron + comment**

Apply edit to `.github/workflows/daily-qa-digest.yml`:

Old:
```yaml
# Every morning at 08:00 UTC (~9h Paris in winter, 10h in summer during DST).
# Claude Sonnet 4.6 reads yesterday's merged PRs and writes a pedagogical
# French digest as a GitHub issue, so Noé can sip coffee and know exactly
# what to visually QA without touching git or terminal.
```
New:
```yaml
# Every morning at 07:00 UTC → 09h Paris CEST (summer) / 08h Paris CET (winter).
# Trade-off: user currently lives in CEST and wakes at 7h Paris; digest ready
# within 2h of wake-up year-round. Don't split into two schedules — simpler
# to keep one cron that's close-enough in both zones.
# Claude Sonnet 4.6 reads yesterday's merged PRs and writes a pedagogical
# French digest as a GitHub issue, so Noé can sip coffee and know exactly
# what to visually QA without touching git or terminal.
```

And change `- cron: '0 8 * * *'  # 08:00 UTC daily` to `- cron: '0 7 * * *'  # 07:00 UTC daily (09h Paris summer)`.

- [ ] **Step 3: Validate YAML parses**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/daily-qa-digest.yml'))" && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/daily-qa-digest.yml
git commit -m "fix(workflows): QA digest cron 08→07 UTC (9h Paris CEST)"
```

---

## Task 2: Add MAX_PARALLEL_PRS throttle to dispatch-ready

**Files:**
- Modify: `.github/workflows/dispatch-ready.yml:50-198`

- [ ] **Step 1: Read current compute-ready script boundaries**

Run:
```bash
grep -n "^            " .github/workflows/dispatch-ready.yml | head -5
grep -n "Compute ready set" .github/workflows/dispatch-ready.yml
```
Expected: script starts around line 49, ends around line 198.

- [ ] **Step 2: Add throttle constant + counter BEFORE the main loop**

Apply edit to `.github/workflows/dispatch-ready.yml`.

Find this block (line ~119):
```javascript
            const ready = [];
            const waiting = [];
            const summary = [];

            for (const issue of issues) {
```

Replace with:
```javascript
            const ready = [];
            const waiting = [];
            const summary = [];

            // Throttle: max N open claude/* PRs at once to prevent thundering
            // herd of mutual conflicts. Raise once auto-rebase proves itself.
            const MAX_PARALLEL_PRS = 5;
            const openPrs = await github.paginate(github.rest.pulls.list, {
              ...context.repo, state: 'open', per_page: 100
            });
            const activeClaudePrs = openPrs.filter(p =>
              p.user && p.user.login === 'noemuch' &&
              p.head && p.head.ref && p.head.ref.startsWith('claude/')
            ).length;
            let availableSlots = Math.max(0, MAX_PARALLEL_PRS - activeClaudePrs);
            core.info(`Throttle: ${activeClaudePrs}/${MAX_PARALLEL_PRS} active claude PRs. ${availableSlots} slots available.`);

            // Collect unblocked candidates first (deterministic FIFO by issue.number)
            const unblockedCandidates = [];
            const blockedEntries = [];

            for (const issue of issues) {
```

- [ ] **Step 3: Split the existing loop into two passes (classify, then apply)**

Find the existing loop body (starts ~line 124 in original file). It currently does blocker evaluation AND label application in a single pass. Split it:

Replace:
```javascript
              if (stillOpen.length === 0) {
                // Unblocked!
                if (!hasReady) {
                  await github.rest.issues.addLabels({
                    ...context.repo, issue_number: issue.number,
                    labels: ['ready-to-ship']
                  });
                  ready.push(`#${issue.number}`);
                }
                if (hasWaiting) {
                  await github.rest.issues.removeLabel({
                    ...context.repo, issue_number: issue.number,
                    name: 'waiting-deps'
                  });
                }
              } else {
                // Still blocked
                if (!hasWaiting) {
                  await github.rest.issues.addLabels({
                    ...context.repo, issue_number: issue.number,
                    labels: ['waiting-deps']
                  });
                  waiting.push(`#${issue.number} (by: ${stillOpen.map(n => '#' + n).join(', ')})`);
                }
                if (hasReady) {
                  await github.rest.issues.removeLabel({
                    ...context.repo, issue_number: issue.number,
                    name: 'ready-to-ship'
                  });
                }
              }
            }
```

With:
```javascript
              if (stillOpen.length === 0) {
                unblockedCandidates.push({ number: issue.number, hasReady, hasWaiting });
              } else {
                blockedEntries.push({ number: issue.number, hasReady, hasWaiting, stillOpen });
              }
            }

            // Sort unblocked by number ASC (FIFO) for deterministic throttle selection
            unblockedCandidates.sort((a, b) => a.number - b.number);

            const throttled = [];
            for (const c of unblockedCandidates) {
              if (availableSlots > 0) {
                // Promote to ready-to-ship
                if (!c.hasReady) {
                  await github.rest.issues.addLabels({
                    ...context.repo, issue_number: c.number,
                    labels: ['ready-to-ship']
                  });
                  ready.push(`#${c.number}`);
                }
                if (c.hasWaiting) {
                  await github.rest.issues.removeLabel({
                    ...context.repo, issue_number: c.number,
                    name: 'waiting-deps'
                  });
                }
                availableSlots -= 1;
              } else {
                // Throttled: ensure ready-to-ship is NOT applied (wait next tick)
                if (c.hasReady) {
                  await github.rest.issues.removeLabel({
                    ...context.repo, issue_number: c.number,
                    name: 'ready-to-ship'
                  });
                }
                throttled.push(`#${c.number}`);
              }
            }

            // Apply blocked labels (unchanged logic)
            for (const b of blockedEntries) {
              if (!b.hasWaiting) {
                await github.rest.issues.addLabels({
                  ...context.repo, issue_number: b.number,
                  labels: ['waiting-deps']
                });
                waiting.push(`#${b.number} (by: ${b.stillOpen.map(n => '#' + n).join(', ')})`);
              }
              if (b.hasReady) {
                await github.rest.issues.removeLabel({
                  ...context.repo, issue_number: b.number,
                  name: 'ready-to-ship'
                });
              }
            }
```

- [ ] **Step 4: Update the summary comment to include throttle state**

Find:
```javascript
            if (ready.length || waiting.length) {
              const body = [
                `🔀 **Dispatch cron run** — [${new Date().toISOString()}]`,
                ready.length ? `✅ Newly ready-to-ship: ${ready.join(', ')}` : null,
                waiting.length ? `⏸ Newly waiting-deps: ${waiting.join('; ')}` : null,
                `[run](https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})`
              ].filter(Boolean).join('\n\n');
```

Replace with:
```javascript
            if (ready.length || waiting.length || throttled.length) {
              const body = [
                `🔀 **Dispatch cron run** — [${new Date().toISOString()}]`,
                `Slots: ${activeClaudePrs}/${MAX_PARALLEL_PRS} active claude PRs`,
                ready.length ? `✅ Newly ready-to-ship: ${ready.join(', ')}` : null,
                waiting.length ? `⏸ Newly waiting-deps: ${waiting.join('; ')}` : null,
                throttled.length ? `🚦 Throttled (queued for next tick): ${throttled.join(', ')}` : null,
                `[run](https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})`
              ].filter(Boolean).join('\n\n');
```

- [ ] **Step 5: Validate YAML + JS syntax**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/dispatch-ready.yml'))" && echo YAML_OK
```
Expected: `YAML_OK`

Extract and lint the inline script:
```bash
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/dispatch-ready.yml'))
script = d['jobs']['compute-ready']['steps'][0]['with']['script']
print(script)
" > /tmp/extracted-dispatch.js
node --check /tmp/extracted-dispatch.js && echo JS_OK
```
Expected: `JS_OK`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/dispatch-ready.yml
git commit -m "feat(workflows): throttle dispatch to MAX_PARALLEL_PRS=5

Prevents thundering-herd of parallel PRs that collide on merge.
FIFO by issue number. Throttled issues stay agent-ready and
re-evaluate next cron tick."
```

---

## Task 3: Create proactive-rebase workflow

**Files:**
- Create: `.github/workflows/proactive-rebase.yml`

- [ ] **Step 1: Verify file does not already exist**

Run:
```bash
ls .github/workflows/proactive-rebase.yml 2>&1
```
Expected: `ls: cannot access '.github/workflows/proactive-rebase.yml': No such file or directory`

- [ ] **Step 2: Create the workflow file**

Write the following content to `.github/workflows/proactive-rebase.yml`:

```yaml
name: Proactive Rebase — Keep claude/* PRs current with main

# Scheduled every 10 min. For each open PR authored by @noemuch on a
# `claude/` branch whose mergeStateStatus is BEHIND, call GitHub's native
# `update-branch --rebase` API to replay the PR commits on top of main.
#
# Why: the reviewer only fires on pull_request events (open, synchronize,
# reopened, ready_for_review). When OTHER PRs merge to main, existing
# PRs silently drift from CLEAN → BEHIND → eventually DIRTY (merge conflict).
# Proactive rebase keeps everyone CLEAN or BEHIND, never DIRTY.
#
# Skip conditions:
#   - PR has autofix-iter-* label (don't race with in-flight fix push)
#   - PR last commit within 5 min (don't race with active builder)
#   - PR has stop-autonomy or agent-blocked label
#
# Conflict handling: `update-branch --rebase` is ATOMIC on GitHub's side.
# If it would produce a conflict, it fails gracefully (no partial state)
# and the PR stays BEHIND → next reviewer run handles it via STEP 1.5
# (autonomous conflict resolution).

on:
  schedule:
    - cron: '*/10 * * * *'  # every 10 min
  workflow_dispatch:

concurrency:
  group: proactive-rebase
  cancel-in-progress: false

jobs:
  rebase:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write

    steps:
      - name: Rebase BEHIND claude/* PRs
        uses: actions/github-script@v7
        env:
          GH_TOKEN: ${{ secrets.NOEMUCH_PAT }}
        with:
          github-token: ${{ secrets.NOEMUCH_PAT }}
          script: |
            const { execSync } = require('child_process');
            const openPrs = await github.paginate(github.rest.pulls.list, {
              ...context.repo, state: 'open', per_page: 100
            });

            const candidates = openPrs.filter(p =>
              p.user && p.user.login === 'noemuch' &&
              p.head && p.head.ref && p.head.ref.startsWith('claude/')
            );

            const fiveMinAgo = Date.now() - 5 * 60 * 1000;
            const rebased = [];
            const skipped = [];
            const failed = [];

            for (const pr of candidates) {
              // Skip kill-switched or blocked
              const labels = (pr.labels || []).map(l => l.name);
              if (labels.includes('stop-autonomy') || labels.includes('agent-blocked')) {
                skipped.push(`#${pr.number} (labeled)`);
                continue;
              }
              // Skip if in autofix iteration (race with builder)
              if (labels.some(n => n.startsWith('autofix-iter-'))) {
                skipped.push(`#${pr.number} (autofix in flight)`);
                continue;
              }
              // Skip if HEAD updated within last 5 min
              const headSha = pr.head.sha;
              try {
                const { data: commit } = await github.rest.git.getCommit({
                  ...context.repo, commit_sha: headSha
                });
                const committedAt = new Date(commit.committer.date).getTime();
                if (committedAt > fiveMinAgo) {
                  skipped.push(`#${pr.number} (HEAD <5min old)`);
                  continue;
                }
              } catch (e) {
                core.warning(`Could not read HEAD commit for #${pr.number}: ${e.message}`);
              }

              // Fetch mergeStateStatus via GraphQL (REST doesn't expose it reliably)
              let mergeState;
              try {
                const gql = await github.graphql(`
                  query($o:String!, $r:String!, $n:Int!) {
                    repository(owner:$o, name:$r) {
                      pullRequest(number:$n) { mergeStateStatus }
                    }
                  }
                `, { o: context.repo.owner, r: context.repo.repo, n: pr.number });
                mergeState = gql.repository.pullRequest.mergeStateStatus;
              } catch (e) {
                core.warning(`Could not read mergeStateStatus for #${pr.number}: ${e.message}`);
                continue;
              }

              // Only rebase BEHIND. DIRTY is handled by reviewer STEP 1.5.
              if (mergeState !== 'BEHIND') {
                skipped.push(`#${pr.number} (${mergeState})`);
                continue;
              }

              // Call update-branch --rebase via gh CLI (REST has the API but
              // gh handles the auth + retry cleanly)
              try {
                execSync(`gh pr update-branch ${pr.number} --repo ${context.repo.owner}/${context.repo.repo} --rebase`, {
                  encoding: 'utf8', env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN }
                });
                rebased.push(`#${pr.number}`);
              } catch (e) {
                failed.push(`#${pr.number}: ${String(e.stderr || e.message).slice(0, 120)}`);
              }
            }

            core.info(`Rebased: ${rebased.length} — ${rebased.join(', ') || 'none'}`);
            core.info(`Skipped: ${skipped.length}`);
            core.info(`Failed: ${failed.length} — ${failed.join(' | ') || 'none'}`);

            core.setOutput('rebased_count', rebased.length);
            core.setOutput('failed_count', failed.length);

            if (rebased.length || failed.length) {
              const body = [
                `🔄 **Proactive rebase** — [${new Date().toISOString()}]`,
                rebased.length ? `✅ Rebased: ${rebased.join(', ')}` : null,
                failed.length ? `⚠️ Failed (will retry): ${failed.join(' · ')}` : null,
                `[run](https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})`
              ].filter(Boolean).join('\n\n');
              await github.rest.issues.createComment({
                ...context.repo, issue_number: 257, body
              });
            }
```

- [ ] **Step 3: Validate YAML + embedded JS**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/proactive-rebase.yml'))" && echo YAML_OK
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/proactive-rebase.yml'))
print(d['jobs']['rebase']['steps'][0]['with']['script'])
" > /tmp/extracted-proactive.js
node --check /tmp/extracted-proactive.js && echo JS_OK
```
Expected both: `YAML_OK` then `JS_OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/proactive-rebase.yml
git commit -m "feat(workflows): proactive-rebase.yml — auto-rebase BEHIND claude/* PRs

Cron every 10 min. Calls gh pr update-branch --rebase on any open
claude/ PR whose mergeStateStatus is BEHIND. Prevents drift into
DIRTY (merge conflict) state between reviewer runs.

Skips autofix-in-flight, <5min-old HEAD, stop-autonomy/agent-blocked."
```

---

## Task 4: Add conflict auto-resolution (STEP 1.5) to review.yml

**Files:**
- Modify: `.github/workflows/review.yml:110-206` (primary prompt + claude_args)
- Modify: `.github/workflows/review.yml:230-239` (failover prompt note + claude_args)

- [ ] **Step 1: Locate the primary prompt block**

Run:
```bash
grep -n "STEP 1 — Rebase if BEHIND" .github/workflows/review.yml
grep -n "STEP 2 — CI status" .github/workflows/review.yml
```
Expected: STEP 1 around line 130, STEP 2 around line 142.

- [ ] **Step 2: Replace STEP 1 block with STEP 1 + STEP 1.5**

Apply edit to `.github/workflows/review.yml`.

Old (lines ~130-140):
```yaml
            ## STEP 1 — Rebase if BEHIND main

            If `mergeStateStatus = BEHIND`:
            ```bash
            git config user.name "Noé Chagué"
            git config user.email "noe@finary.com"
            git fetch origin main
            git rebase origin/main
            ```
            - Clean rebase → `git push --force-with-lease origin HEAD` + comment "🔀 Rebased on main"
            - Conflict → `git rebase --abort` + apply `agent-blocked` + comment "Conflict — @noemuch needs manual resolve" + EXIT.
```

New:
```yaml
            ## STEP 1 — Rebase if BEHIND main

            If `mergeStateStatus = BEHIND`:
            ```bash
            git config user.name "Noé Chagué"
            git config user.email "noe@finary.com"
            git fetch origin main
            git rebase origin/main
            ```
            - Clean rebase → `git push --force-with-lease origin HEAD` + comment "🔀 Rebased on main" → continue to STEP 2.
            - Conflict → proceed to STEP 1.5 (autonomous conflict resolution) BEFORE aborting.

            ## STEP 1.5 — Autonomous conflict resolution (when rebase produces conflicts)

            This step activates if `git rebase origin/main` (STEP 1) or `mergeStateStatus = DIRTY` (from `gh pr view`). You are authorized to resolve conflicts autonomously — Noé trusts your judgment.

            **HARD BUDGET — abort + escalate if ANY guard trips:**
            - More than 3 unmerged files in a single `git status`
            - More than 3 conflict hunks in a single file (count `<<<<<<<` markers)
            - More than 3 `git rebase --continue` iterations across the whole rebase
            - Any hunk requires semantic judgment (logic overlap, incompatible APIs, changed method signatures)

            **Process:**

            If not already attempted in STEP 1:
            ```bash
            git fetch origin main
            git rebase origin/main || true   # allow conflict
            ```

            Then, while `git status --porcelain | grep -E "^UU|^AA"` shows unmerged files:

            1. **Count the budget:**
               ```bash
               UNMERGED=$(git status --porcelain | grep -E "^UU|^AA" | wc -l)
               if [ "$UNMERGED" -gt 3 ]; then
                 git rebase --abort
                 # → go to ESCALATE block below
               fi
               ```

            2. **For each unmerged file**, apply `superpowers:systematic-debugging` Phase 1 (root cause) and Phase 3 (hypothesis):
               - `git diff <file>` — read the conflict markers
               - Ask yourself: what was the PR's intent (`<<<<<<< HEAD` side)? What changed on main (`>>>>>>>` side)?
               - Count hunks: `grep -c '^<<<<<<<' <file>`. If > 3 → abort + escalate.
               - Can you preserve BOTH intents cleanly (e.g. imports merge, adjacent migrations keep order, non-overlapping test cases coexist)? → resolve mechanically with Edit/Write tool → `git add <file>`.
               - Does resolution require semantic judgment (signature change, behavioral divergence, incompatible APIs)? → `git rebase --abort` + ESCALATE.

            3. **After all files resolved:** `git rebase --continue`. If a second conflict surfaces in the next commit of the stack, repeat from step 1 (budget re-check).

            4. **After max 3 `--continue` iterations total**, regardless of state: `git rebase --abort` + ESCALATE.

            5. **On success:**
               ```bash
               git push --force-with-lease origin HEAD
               gh pr comment ${{ github.event.pull_request.number }} --body "🔀 **Auto-rebase resolved N conflicts**:
               - \`path/to/file.ts\`: <1-line summary of how it was merged>
               - (...)

               Applied superpowers:systematic-debugging per file. CI re-running."
               ```
               Then continue to STEP 2.

            **ESCALATE block** (used by any budget trip in this step):
            ```bash
            git rebase --abort 2>/dev/null || true
            gh pr edit ${{ github.event.pull_request.number }} --repo noemuch/hive --add-label agent-blocked
            gh pr comment ${{ github.event.pull_request.number }} --body "🔴 **Conflict auto-resolve aborted** — <precise reason: e.g. 'file server/src/engine/handlers.ts has 5 conflict hunks (budget: 3)' or 'method signature divergence in auth.ts: HEAD adds verifyJwt(token, audience), main adds verifyJwt(token, {aud})'>. @noemuch needs manual resolve. \`agent-blocked\` applied."
            exit 0
            ```
            Do NOT proceed to STEP 2 after ESCALATE.
```

- [ ] **Step 3: Bump max-turns in primary claude_args from 75 to 95**

Find (around line 205):
```yaml
          claude_args: |
            --model claude-opus-4-7
            --max-turns 75
            --dangerously-skip-permissions
```
(inside the primary `Run reviewer (primary = Lyse)` step)

Replace with:
```yaml
          claude_args: |
            --model claude-opus-4-7
            --max-turns 95
            --dangerously-skip-permissions
```

**Note:** do NOT touch the failover step's max-turns — the failover prompt references CLAUDE.md for full spec, so leave it at 75 (it will handle the common case; conflict resolution is rare enough that failover rarely needs the full budget).

- [ ] **Step 4: Update failover prompt to mention STEP 1.5**

Find (around line 231-235):
```yaml
          prompt: |
            [FAILOVER] Same reviewer role as primary prompt above.
            Iteration: ${{ needs.preflight.outputs.iter }}/3 for PR #${{ github.event.pull_request.number }}.
            Re-execute STEP 0 → STEP 4 from the reviewer spec in CLAUDE.md.
            GO. Max 75 turns.
```

Replace with:
```yaml
          prompt: |
            [FAILOVER] Same reviewer role as primary prompt above.
            Iteration: ${{ needs.preflight.outputs.iter }}/3 for PR #${{ github.event.pull_request.number }}.
            Re-execute STEP 0 → STEP 1 → STEP 1.5 (if DIRTY/BEHIND) → STEP 2 → STEP 3 → STEP 4 from the reviewer spec in CLAUDE.md.
            Conflict auto-resolution budget: 3 files / 3 hunks / 3 iter, else agent-blocked.
            GO. Max 75 turns.
```

- [ ] **Step 5: Validate YAML**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/review.yml'))" && echo YAML_OK
```
Expected: `YAML_OK`

- [ ] **Step 6: Sanity-check the prompt markdown renders cleanly**

Run:
```bash
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/review.yml'))
prompt = d['jobs']['review']['steps'][1]['with']['prompt']
print('PROMPT_LINES:', len(prompt.split(chr(10))))
print('CHARS:', len(prompt))
print('HAS_STEP_1.5:', 'STEP 1.5' in prompt)
print('HAS_BUDGET:', 'HARD BUDGET' in prompt)
print('HAS_ESCALATE:', 'ESCALATE block' in prompt)
"
```
Expected: all four `HAS_*` print `True`; line count under 300.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/review.yml
git commit -m "feat(workflows): reviewer STEP 1.5 — autonomous conflict resolution

When mergeStateStatus=DIRTY or rebase produces conflicts, reviewer
now attempts resolution via superpowers:systematic-debugging with a
hard budget (3 files / 3 hunks / 3 iter). Falls back to agent-blocked
with precise diagnostic on any budget trip.

Bumps primary max-turns 75→95 to accommodate the extra work."
```

---

## Task 5: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md` (add new subsection under `## Autonomous Workflow`)

- [ ] **Step 1: Locate the section anchor**

Run:
```bash
grep -n "^### Kill-switch" CLAUDE.md
grep -n "^### Secrets required" CLAUDE.md
```
Expected: Kill-switch around line 220, Secrets required after it.

- [ ] **Step 2: Insert new subsections BEFORE Kill-switch**

Apply edit to `CLAUDE.md`.

Find:
```markdown
### Kill-switch
```

Replace with:
```markdown
### Concurrency throttle

`dispatch-ready` caps simultaneous open `claude/*` PRs at **`MAX_PARALLEL_PRS = 5`** (constant at top of workflow script). When more issues are unblocked than slots available:

- First `N` by issue number ascending (FIFO) get `ready-to-ship`
- Remaining stay `agent-ready`, re-evaluated every cron tick (15 min)
- Throttled count is logged to #257 on each run

Rationale: prevents thundering herd of mutually-conflicting PRs. Conservative 5 initially; raise once conflict auto-resolver proves itself with zero regressions for a week.

### Proactive rebase

`.github/workflows/proactive-rebase.yml` runs every 10 min. For each open `claude/*` PR with `mergeStateStatus = BEHIND`, calls `gh pr update-branch --rebase` so the PR replays on top of the latest `main`. Prevents silent drift from BEHIND → DIRTY between reviewer runs.

Skips PRs that are: labelled `stop-autonomy` / `agent-blocked` / `autofix-iter-*`, or whose HEAD was committed in the last 5 min (avoids racing active builders).

### Autonomous conflict resolution (reviewer STEP 1.5)

When reviewer sees `mergeStateStatus = DIRTY` (or a rebase in STEP 1 produces conflicts), it enters STEP 1.5:

1. Applies `superpowers:systematic-debugging` per unmerged file
2. Resolves **only** mechanical conflicts (imports, adjacent migrations, non-overlapping tests, non-semantic hunks)
3. **Hard budget**: 3 files max, 3 hunks per file max, 3 `rebase --continue` iterations max
4. Beyond any guard → `git rebase --abort` + `agent-blocked` with precise diagnostic (which file, which hunk, why)

Success path: `git push --force-with-lease` + summary comment on PR + continue to STEP 2 (CI check).

Primary reviewer `--max-turns` is 95 (was 75) to accommodate the extra work. Failover stays at 75 (conflict resolution is rare; failover rarely hits it).

### Kill-switch
```

- [ ] **Step 3: Update the Labels workflow table (add note on throttle behavior)**

Find the `### Labels workflow` section. Find line:
```markdown
- `waiting-deps` — dep-cron applies when blockers still open (auto)
```

Add immediately after:
```markdown
- `ready-to-ship` — dep-cron applies when deps closed AND throttle slot available (auto); removed if throttle is full
```

Wait — `ready-to-ship` is already listed a few lines below. Find and keep it but update its description to match throttle behavior:

Find:
```markdown
- `ready-to-ship` — dep-cron applies when all deps closed (auto)
```

Replace with:
```markdown
- `ready-to-ship` — dep-cron applies when deps closed AND throttle slot available (auto)
```

- [ ] **Step 4: Verify CLAUDE.md still parses (no broken markdown)**

Run:
```bash
# Sanity: header hierarchy intact
grep -c "^# " CLAUDE.md
grep -c "^## " CLAUDE.md
grep -c "^### " CLAUDE.md
echo "LINES:"; wc -l CLAUDE.md
```
Expected: counts change only by the new sections (3 new `###` entries added).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): document throttle, proactive-rebase, STEP 1.5

Adds three subsections under Autonomous Workflow:
- Concurrency throttle (MAX_PARALLEL_PRS=5, FIFO)
- Proactive rebase (10min cron, BEHIND → rebased)
- Autonomous conflict resolution (STEP 1.5, 3/3/3 budget)

Updates ready-to-ship label description to mention throttle gate."
```

---

## Task 6: Integration verification on existing stuck PRs

Objective: before declaring success, prove the system fixes the 5 currently-stuck PRs (#286, #293, #294, #295, #296).

**Files:** none modified. Uses `gh` CLI + real PRs.

- [ ] **Step 1: Push all commits + verify workflows are present on main**

```bash
git push origin main
sleep 15
gh workflow list --repo noemuch/hive | grep -iE "proactive|dispatch|review|digest"
```
Expected: 4 workflows listed, all `active`.

- [ ] **Step 2: Trigger proactive-rebase once manually to wake it up**

```bash
gh workflow run proactive-rebase.yml --repo noemuch/hive
sleep 30
gh run list --repo noemuch/hive --workflow="Proactive Rebase — Keep claude/* PRs current with main" --limit 1 --json conclusion,status,url
```
Expected: first run appears with `status: in_progress` or `completed`. Wait up to 2 min, then verify `conclusion: success`.

- [ ] **Step 3: Check that BEHIND PRs were rebased (or were already DIRTY → left for reviewer)**

```bash
gh pr list --repo noemuch/hive --state open --json number,title,mergeStateStatus --jq '.[] | "#\(.number) \(.mergeStateStatus) \(.title)"'
```

Expected after proactive-rebase run:
- Any PR previously `BEHIND` → now `CLEAN`
- PRs already `DIRTY` at spec-write time (#286 etc) → still `DIRTY` (reviewer handles them)

- [ ] **Step 4: Trigger reviewer on one stuck DIRTY PR to test STEP 1.5**

Pick #286 (smallest diff, cleanest candidate):

```bash
gh pr comment 286 --repo noemuch/hive --body "@claude-reviewer test STEP 1.5 conflict resolution"
# OR force-fire the workflow by pushing an empty commit to the PR branch:
BRANCH=$(gh pr view 286 --repo noemuch/hive --json headRefName --jq .headRefName)
git fetch origin "$BRANCH":"$BRANCH"
git checkout "$BRANCH"
git commit --allow-empty -m "chore: trigger reviewer re-run (STEP 1.5 test)"
git push origin "$BRANCH"
git checkout main
```

- [ ] **Step 5: Watch reviewer run on #286**

```bash
sleep 60
gh run list --repo noemuch/hive --workflow="Claude Code — Autonomous Reviewer" --limit 3 --json conclusion,status,url,displayTitle
```
Expected within 10 min: either
- (A) Success: reviewer auto-resolved + pushed + merged → PR #286 is `MERGED`. Go to Step 6.
- (B) Escalation: reviewer applied `agent-blocked` with precise diagnostic → that's still a success for STEP 1.5 logic; means the conflict genuinely needed human judgment. Read the comment to confirm the diagnostic is precise. Go to Step 6.
- (C) Workflow failure → investigate logs, fix regression in a follow-up.

- [ ] **Step 6: Verify #257 received throttle + rebase summary comments**

```bash
gh issue view 257 --repo noemuch/hive --comments --json comments --jq '.comments | sort_by(.createdAt) | reverse | .[0:5] | .[] | .body' | head -40
```
Expected: recent comments include "Proactive rebase", "Dispatch cron run" (with "Slots: X/5") or "Throttled".

- [ ] **Step 7: If Steps 5-6 pass, let the system run autonomously; if not, diagnose + patch**

No commit needed for this task; it's validation. If a regression is found, open a follow-up task with the exact diagnostic.

---

## Self-Review Results

**1. Spec coverage:**
- § 4.1 conflict auto-resolution → Task 4 ✅
- § 4.2 throttle → Task 2 ✅
- § 4.3 proactive rebase → Task 3 ✅
- § 4.4 cron fix → Task 1 ✅
- § 5 data flow → inherent in the workflow wiring ✅
- § 6 error handling → baked into STEP 1.5 budget (Task 4) and proactive-rebase skip rules (Task 3) ✅
- § 7 testing strategy → Task 6 (integration on real stuck PRs) ✅
- § 8 rollout → Task 6 Steps 1-3 (push, manual kick, observe) ✅
- § 9 out of scope → deliberately not in plan ✅
- § 10 open questions A & B resolved in code (autofix-iter skip in Task 3; simple count in Task 2) ✅; C (long-term MAX_PARALLEL_PRS value) is future-tuning, out of this plan ✅

**2. Placeholder scan:** no "TBD" / "TODO" / "implement later" — every step has exact paths, exact code, exact commands, exact expected output.

**3. Type consistency:** `MAX_PARALLEL_PRS`, `availableSlots`, `unblockedCandidates`, `blockedEntries`, `throttled` all introduced in Task 2 and not renamed in Task 3. Label names (`autofix-iter-*`, `agent-blocked`, `stop-autonomy`, `ready-to-ship`, `waiting-deps`) match across tasks 2, 3, 4, 5 and existing workflows.

---

**End of plan.**
