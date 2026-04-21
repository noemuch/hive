# Zero-Intervention Autonomy — Design Spec

**Date**: 2026-04-21
**Author**: Claude Opus 4.7 (sparring with Noé)
**Goal**: Eliminate the three remaining human-intervention points in the Hive autonomous workflow so Noé never has to touch git or the Actions UI — the system degrades gracefully under every known failure mode and recovers by itself.

---

## 1. Problem Statement

Current autonomy pipeline (claude-ready → review → dispatch-ready → quota-monitor → daily-qa-digest) reached ~90% hands-off. The last 10% causing intervention:

| # | Failure mode | Frequency observed | Current behavior |
|---|---|---|---|
| 1 | **Merge conflicts between parallel PRs** (`mergeStateStatus = DIRTY`) | 5/16 PRs last batch | Reviewer runs `git rebase --abort` → applies `agent-blocked` → waits for @noemuch |
| 2 | **Thundering-herd parallelism** (15+ builders triggered simultaneously when batch of `agent-ready` resolves) | Every large batch | Each PR lands on fresh `main` but siblings touching shared files collide on merge |
| 3 | **QA digest cron drift** (fires at 10h Paris in summer instead of 9h) | Every day during DST | No user-facing failure but user waits 1h longer than expected |

## 2. Goals

- **Zero human intervention** under non-ambiguous failures. Only escalate for genuine architectural decisions (two valid approaches) or novel security red flags.
- **No technical debt**. All state persisted in git (auditable, replayable). No external DB, no new secrets, no Lambda.
- **Scalable**. Works identically for 5 or 500 parallel PRs — back-pressure is explicit, not emergent.
- **Observable**. Every auto-action posts a one-line summary to automation log #257.
- **Reversible**. The `stop-autonomy` kill-switch still halts everything instantly.

## 3. Non-goals

- **Semantic conflict detection** — we don't pre-analyze which PRs "will probably conflict". Too clever, wrong outcomes. We resolve conflicts when they happen.
- **Cross-repo orchestration** — single-repo system.
- **Replacing the Quality Gate** — the 10 blocking checks in CLAUDE.md are unchanged.
- **Eliminating CI** — Tests workflow remains a required check.

## 4. Architecture — three coordinated changes

```
┌──────────────────────────────────────────────────────────────────┐
│                     HIVE AUTONOMY LOOP v2                        │
│                                                                  │
│  agent-ready ──► dispatch-ready (cron 15m)                       │
│                     │                                            │
│                     ├─► [NEW] concurrency_throttle               │
│                     │      active_prs = count(open claude/ PRs)  │
│                     │      if active_prs < MAX_PARALLEL (5)      │
│                     │        → apply ready-to-ship (N slots)     │
│                     │      else                                  │
│                     │        → keep agent-ready, re-eval next cron
│                     │                                            │
│                     └─► unblocks by dep graph                    │
│                                                                  │
│  ready-to-ship ──► builder → opens PR on claude/issue-N-*        │
│                                                                  │
│  PR open ──► reviewer                                            │
│              │                                                   │
│              ├─► mergeStateStatus == BEHIND                      │
│              │      → git rebase origin/main (unchanged)         │
│              │                                                   │
│              ├─► [NEW] mergeStateStatus == DIRTY                 │
│              │      → STEP 1.5: attempt autonomous rebase        │
│              │        - git rebase origin/main                   │
│              │        - on conflict: call superpowers:systematic-│
│              │          debugging prompt, resolve each hunk,     │
│              │          `git rebase --continue`                  │
│              │        - max 3 hunks or abort                     │
│              │        - on success: force-push + "🔀 Auto-rebase │
│              │          resolved" comment                        │
│              │        - on abort: fallback to current behavior   │
│              │          (agent-blocked + escalate)               │
│              │                                                   │
│              ├─► Quality Gate 0/10 + Methodology + CI green      │
│              │      → squash-merge + delete-branch (unchanged)   │
│              │                                                   │
│              └─► else → auto-fix mode (unchanged)                │
│                                                                  │
│  [NEW] proactive_rebase (cron 10m)                               │
│     for each open claude/* PR with mergeStateStatus == BEHIND    │
│     and no recent reviewer run (last 5m):                        │
│       gh pr update-branch --rebase                               │
│     → prevents BEHIND from becoming DIRTY                        │
│                                                                  │
│  [FIX] daily-qa-digest: cron '0 7 * * *' (was '0 8 * * *')       │
│     → fires at 09h Paris year-round (8h UTC winter, 7h UTC summer)
│       9h CET winter / 9h CEST summer both hit from 7h UTC.       │
│     Wait — 9h CET = 8h UTC, 9h CEST = 7h UTC. Single cron        │
│     can't target both. We pick 9h CEST (user's current reality). │
│     Cron '0 7 * * *' → 9h Paris in summer, 8h Paris in winter.   │
│     Acceptable trade — user wakes at 7h Paris; digest ready ≤2h. │
└──────────────────────────────────────────────────────────────────┘
```

### 4.1 Conflict auto-resolution (new reviewer step 1.5)

**Trigger**: `mergeStateStatus == DIRTY` after fetching PR state.

**Process** (inside existing reviewer job, before Step 2):

```bash
git config user.name "Noé Chagué"
git config user.email "noe@finary.com"
git fetch origin main
if ! git rebase origin/main; then
  # conflict detected — enter autonomous resolution
  echo "::notice::Conflict detected. Attempting autonomous resolution."
fi
```

If conflict detected, the reviewer prompt adds an explicit **STEP 1.5**:

```
You are in CONFLICT-RESOLUTION mode. `git status` shows N files unmerged.

For each unmerged file:
  1. `git diff <file>` — read the conflict markers
  2. Apply `superpowers:systematic-debugging`:
     - Phase 1 (root cause): which side's change is the PR's intent? What was added on main?
     - Phase 3 (hypothesis): is a clean three-way merge possible preserving BOTH intents?
  3. If the file has <= 3 conflict hunks AND the resolution is mechanical (imports, adjacent
     migrations, non-overlapping tests): resolve, `git add <file>`.
  4. If any hunk requires semantic judgment (logic overlap, incompatible APIs) that isn't
     obvious: `git rebase --abort` and escalate via agent-blocked label.

After all files resolved: `git rebase --continue`. If a second conflict appears in the next
commit of the stack, repeat up to 3 times total. Beyond that, abort + escalate.

On successful rebase:
  git push --force-with-lease origin HEAD
  gh pr comment N --body "🔀 **Auto-rebase resolved N conflicts**: <file list + one-line
  summary per file>. CI re-running."
  Then continue to STEP 2 (CI check).
```

**Budget**:
- Max 3 unmerged files per rebase attempt
- Max 3 conflict iterations (`rebase --continue` steps) per PR
- Additional LLM turns: capped at +20 on top of the existing 75 (total 95)

**Failure fallback**: if any guard trips, `git rebase --abort` → apply `agent-blocked` + comment explaining exactly which file/hunk exceeded the budget. Noé decides. Same UX as today for the hard cases.

**Why this is safe**:
- The resolver is the reviewer itself, so the Quality Gate (10 checks) runs immediately on the resolved state — any hallucinated resolution is caught as a regression.
- CI (Tests) is still a required check — semantic breaks surface there.
- `--force-with-lease` prevents clobbering concurrent pushes.

### 4.2 Concurrency throttle (new dispatch-ready step)

**Trigger**: inside existing `compute-ready` job, before the "apply ready-to-ship" loop.

**Logic**:

```javascript
const MAX_PARALLEL_PRS = 5;  // tunable constant, top of file

// Count currently-open PRs authored by @noemuch on claude/ branches
const { data: openPrs } = await github.rest.pulls.list({
  ...context.repo,
  state: 'open',
  per_page: 100
});
const activeClaudePrs = openPrs.filter(p =>
  p.user.login === 'noemuch' && p.head.ref.startsWith('claude/')
).length;

const availableSlots = Math.max(0, MAX_PARALLEL_PRS - activeClaudePrs);
core.info(`Active claude/ PRs: ${activeClaudePrs}/${MAX_PARALLEL_PRS}. ` +
          `Available slots: ${availableSlots}`);
```

Then the existing loop that applies `ready-to-ship` only does so for the **first N unblocked issues** where N = `availableSlots`. Remaining unblocked issues stay labeled `agent-ready` (no `ready-to-ship`, no `waiting-deps`) and are picked up on the next cron (15 min later).

**Ordering** (when more unblocked issues than slots):
1. Issue number ascending (FIFO, deterministic) — simplest, no surprises.

**Observability**:
- If `activeClaudePrs >= MAX_PARALLEL_PRS` and there are unblocked-but-throttled issues, comment on #257:
  `🚦 Throttle active — 5/5 PRs open, N unblocked issues queued`

**Why 5?**
- Empirically sufficient to keep the pipeline busy (one PR usually reviews + merges in ~5 min)
- Small enough to prevent most conflicts before they occur
- Easy to tune (single constant); can be raised once auto-resolve proves itself

### 4.3 Proactive rebase (new workflow)

**File**: `.github/workflows/proactive-rebase.yml` (new, ~50 lines)

**Triggers**:
- `schedule: '*/10 * * * *'` (every 10 min)
- `workflow_dispatch` (manual)

**Job**: single step using `actions/github-script`:

```javascript
// List open claude/ PRs
// For each:
//   - If mergeStateStatus == BEHIND (not DIRTY, not CLEAN):
//     gh pr update-branch --rebase   (GitHub's native rebase API)
//   - If the PR's last commit is within 5 min OR last reviewer comment within 5 min:
//     skip (avoid racing with active reviewer)
// Post one-line comment to #257 summarizing rebased PRs.
```

**Why this exists**: the reviewer only fires on `pull_request` events (open/synchronize/reopened). A PR can go from CLEAN → BEHIND → DIRTY purely from main merges without any event firing its reviewer. Proactive rebase keeps everyone CLEAN or BEHIND — never DIRTY.

**Why GitHub's native `update-branch` API**: idempotent, atomic on GitHub's side, handles the merge-queue cleanly. No local checkout needed.

### 4.4 QA digest cron fix

Change `.github/workflows/daily-qa-digest.yml`:

```diff
-    - cron: '0 8 * * *'  # 08:00 UTC daily
+    - cron: '0 7 * * *'  # 07:00 UTC → 9h Paris summer / 8h Paris winter
```

Update the comment block accordingly. One-line change.

## 5. Data flow diagram

```
User enrolls issue #N (adds agent-ready)
     │
     ▼
dispatch-ready cron (15m) ─┐
     │                      │ checks:
     │                      │   - deps closed?
     │                      │   - throttle slot available?
     │                      │ if both yes → ready-to-ship
     │                      ▼
     │                 Label applied → claude-ready.yml fires
     │                      │
     │                      ▼
     │                 PR opened on claude/issue-N-*
     │                      │
     ├──────────────────────┼──── proactive-rebase cron (10m)
     │                      │     rebases any BEHIND claude/* PR
     │                      ▼
     │                 review.yml fires
     │                      │
     │                      ▼
     │           mergeStateStatus?
     │              │          │         │
     │         CLEAN│     BEHIND         DIRTY (NEW)
     │              │          │         │
     │              │     rebase     auto-resolve (NEW)
     │              │          │         │
     │              │          │    success│ fail
     │              │          │         │   │
     │              │          └─► ──────┤   └─► agent-blocked
     │              │                    │
     │              └────────────────────┴─► Quality Gate
     │                                           │
     │                                      0/10 │ N/10
     │                                           │   │
     │                                      merge│   auto-fix
     │                                           │   │
     │                                           ▼   ▼
     └──────── on pull_request.closed ─────── back to top
```

## 6. Error handling

| Failure | Detection | Recovery |
|---|---|---|
| Rebase resolver hallucinates | CI Tests fails OR Quality Gate catches regression | `auto-fix` mode kicks in (existing path), bumps `autofix-iter-N`. After 3 iters → escalate. |
| Conflict resolution exceeds budget | Guard (> 3 files OR > 3 hunks OR > 3 iters) | `git rebase --abort` → `agent-blocked` + precise comment. Same UX as today. |
| `pr update-branch --rebase` fails (API) | Non-zero exit | Log, continue with next PR. No retry inside same cron run — next 10m run retries naturally. |
| Concurrency throttle stalls pipeline | More than N unblocked issues waiting > 30 min | Visible on #257. Manual `workflow_dispatch` can raise `MAX_PARALLEL_PRS` via PR. |
| `DIRTY` PR with no possible resolution (fundamental API divergence) | Reviewer aborts after 1 hunk analysis | Normal `agent-blocked` path. |
| Concurrent resolver + proactive rebase race | Both try to push at same commit | `--force-with-lease` on reviewer side; GitHub API idempotent on proactive-rebase side. At worst, one gets 409 → logs → next cron retries. |
| All 5 slots frozen (every PR stuck in review) | `activeClaudePrs = 5` for > 1 hour | Emergent — surfaces in QA digest. Noé intervenes ONLY here (real pathology). |

## 7. Testing strategy

### Unit-ish (local)
- Dry-run the throttle logic on a fixture PR list — assert correct `availableSlots` and issue selection.
- Dry-run the dep-regex on fixture bodies (already covered in existing dispatch-ready tests).

### Integration
- **Conflict drill**: create two claude/issue-X branches that both edit `server/src/index.ts`. Merge one. Verify the reviewer on the second one auto-rebases + force-pushes.
- **Throttle drill**: label 10 issues `agent-ready` simultaneously. Assert at most 5 become `ready-to-ship` per cron.
- **Proactive rebase drill**: open a PR, merge another PR on main, wait 10 min. Assert the first PR's `mergeStateStatus` is `CLEAN` (not `BEHIND`).
- **DST drill**: change system clock to November, verify cron fires at 8h Paris. Change to July, verify 9h Paris. (Actually: just trust `crontab.guru` + a comment in the yaml.)

### Production canary
- Deploy with `MAX_PARALLEL_PRS = 2` (very conservative) for 24h. Monitor #257 for throttle warnings.
- If zero regressions after 24h, bump to 5.

## 8. Rollout

1. Land spec → plan → PR implementing all three changes as **one atomic PR** (workflows are coupled; partial rollout risks confusion).
2. Merge during quiet hours (no PRs in flight) via `stop-autonomy` on all active issues for 10 min.
3. Verify `.github/workflows/proactive-rebase.yml` fires on first cron tick (15 min post-merge).
4. Remove `stop-autonomy`. Observe first live batch. Expect ~2-3 auto-rebases in first hour.
5. Update `CLAUDE.md` to document:
   - Conflict auto-resolution rules + budget
   - Throttle constant + why
   - Proactive rebase existence
   - Cron timing note

## 9. Out of scope (deliberately)

- **AI-powered pre-merge conflict prediction** — would let us sequence PRs by likely file overlap. Too complex; solve the symptom (auto-resolve) first.
- **Work-stealing across accounts** — Lyse could take Finary's queue if Finary hits quota. Current quota-monitor already handles this passively.
- **Multi-repo orchestration** — out of repo; also rare.
- **Human-readable conflict resolution summary in QA digest** — nice-to-have; add in v2 once we see the stats.

## 10. Open questions

- **Q**: Should proactive-rebase skip PRs with `autofix-iter-*` labels (avoid racing with an in-flight fix push)?
  - **A** (proposal): yes — if any `autofix-iter-*` label exists, skip. The next reviewer run after CI re-runs will rebase.
- **Q**: Should the throttle be smarter (e.g., count only PRs in review state, not those waiting on CI)?
  - **A** (proposal): no. Simpler is better. A PR waiting on CI is still consuming the merge queue. `MAX_PARALLEL_PRS = 5` is the overall budget.
- **Q**: What's the right `MAX_PARALLEL_PRS` long-term?
  - **A**: 5 initially. After one week of data, we can raise to 10 if #257 shows zero conflicts from auto-resolver, or lower to 3 if >30% of PRs need resolution.

---

**End of spec.**
