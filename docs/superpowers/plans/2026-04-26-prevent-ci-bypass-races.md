# Prevent CI-Bypass Races Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the soft prompt-level "Reviewer CI wait" guarantee into a hard GitHub-side merge gate so the reviewer can never merge a PR while required checks are not green, even if the LLM ever skips its `gh pr checks --watch --fail-fast` line.

**Architecture:** Two-layer change: (1) one-shot `gh api -X PUT` to flip `enforce_admins: true` on the `main` branch protection rule (the load-bearing change — turns the GitHub admin bypass off so the existing required-status check (`Tests`) becomes a hard gate even for admin-scoped PATs); (2) documentation + a small dedup tweak in the post-merge incident guard so a single race no longer opens two issues.

**Tech Stack:** GitHub REST API (branch protection), markdown (CLAUDE.md), GitHub Actions inline JS (`actions/github-script@v7`).

---

## Context

Four `[CI-bypass incident]` issues fired on 2026-04-21 in 75 min (#322, #323, #324, #326). All flagged PRs shipped clean code on `main` — no rollback was needed — so the failure mode is purely automation-reliability, not broken merges. The post-merge guard catches the race after the fact, but does not prevent it. The current branch protection has `enforce_admins: false`, which lets admin-scoped PATs (`NOEMUCH_PAT`) bypass the required `Tests` check even when it has not finished. Setting `enforce_admins: true` removes the bypass — the GitHub merge endpoint itself rejects the merge until `Tests` is green. The reviewer's existing `gh pr checks --required --watch --fail-fast` becomes a redundant safety net rather than the load-bearing check.

Issues #322 and #323 share the same merge SHA (`7ce099c` on PR #314) — two reviewer runs both hit the post-merge guard and each opened a separate issue. Adding a dedup search by PR number turns the second hit into a comment on the first issue.

## File Structure

- **Modify:** `CLAUDE.md` lines 564–578 (Hardening guarantees section): move "Reviewer CI wait" out of "Prompt-level guarantees" and into "Workflow-level hard guarantees", and add a new bullet explaining the `enforce_admins: true` GitHub-side gate.
- **Modify:** `.github/workflows/review.yml` lines 608–692 (CI-bypass incident guard step): add a search-issues call before `issues.create` to dedup on PR number.
- **External one-shot:** `gh api -X PUT /repos/noemuch/hive/branches/main/protection` to flip `enforce_admins: true` while preserving every other field.

## Tasks

### Task 1: Flip `enforce_admins: true` on `main` branch protection

**Files:** None — external API call only.

- [ ] **Step 1: Capture current branch protection state for rollback**

```bash
gh api repos/noemuch/hive/branches/main/protection > /tmp/branch-protection-before.json
cat /tmp/branch-protection-before.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('enforce_admins:', d['enforce_admins']['enabled']); print('required_status_checks.contexts:', d['required_status_checks']['contexts']); print('required_linear_history:', d['required_linear_history']['enabled'])"
```

Expected output:
```
enforce_admins: False
required_status_checks.contexts: ['Tests']
required_linear_history: True
```

- [ ] **Step 2: PUT updated branch protection (preserves all other fields)**

```bash
gh api -X PUT repos/noemuch/hive/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=Tests" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews=null" \
  -F "restrictions=null" \
  -F "required_linear_history=true" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"
```

Expected: HTTP 200 with the updated protection JSON.

- [ ] **Step 3: Verify the change took effect**

```bash
gh api repos/noemuch/hive/branches/main/protection \
  --jq '{enforce_admins: .enforce_admins.enabled, contexts: .required_status_checks.contexts, linear: .required_linear_history.enabled, force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled}'
```

Expected output:
```json
{"enforce_admins":true,"contexts":["Tests"],"linear":true,"force_push":false,"deletions":false}
```

If `enforce_admins` is anything other than `true`, **STOP** — restore from `/tmp/branch-protection-before.json` and re-investigate.

### Task 2: Update CLAUDE.md hardening guarantees

**Files:**
- Modify: `CLAUDE.md:564-578`

- [ ] **Step 1: Add new workflow-level bullet for `enforce_admins`**

Insert a new bullet at the END of the "Workflow-level hard guarantees" list (after the "Builder/reviewer max-turns" bullet on line 573), before the blank line on 574:

```markdown
- **Branch protection `enforce_admins: true`**: the `main` branch has `enforce_admins: true`, so even an admin-scoped PAT (`NOEMUCH_PAT`) cannot merge while a required check (`Tests`) is failing or pending. GitHub itself rejects the `gh pr merge` request — this is now the load-bearing gate. The reviewer's `gh pr checks --watch --fail-fast` line (below) is a redundant safety net, no longer the primary defense.
```

- [ ] **Step 2: Move the "Reviewer CI wait" bullet into workflow-level + reword**

Currently (line 576):
```markdown
- **Reviewer CI wait**: the reviewer runs `gh pr checks --required --watch --fail-fast` before `gh pr merge`. With an admin-scoped PAT `gh pr merge --auto` alone would race; the `--watch --fail-fast` prefix blocks the merge command until checks pass. If the LLM ever skipped this line, the post-merge incident guard above would flag it.
```

Move into the "Workflow-level hard guarantees" list (right after the new `enforce_admins` bullet from Step 1), and reword to reflect that the GitHub-side enforcement is now load-bearing:

```markdown
- **Reviewer CI wait (defense-in-depth)**: the reviewer prompt still runs `gh pr checks --required --watch --fail-fast` before `gh pr merge`. With `enforce_admins: true` (above) the merge endpoint already blocks bad merges at the GitHub level; this prompt step is kept as a redundant client-side wait so the reviewer fails fast with a clear log line instead of hitting an opaque GitHub 405. If the LLM ever skipped the line, the post-merge incident guard would flag it.
```

- [ ] **Step 3: Verify CLAUDE.md still parses (no orphan headers / unbalanced markdown)**

```bash
grep -c "Workflow-level hard guarantees" CLAUDE.md   # expect: 1
grep -c "Prompt-level guarantees" CLAUDE.md          # expect: 1
grep -c "Reviewer CI wait" CLAUDE.md                 # expect: 1 (moved, not duplicated)
grep -c "enforce_admins: true" CLAUDE.md             # expect: 2 (the existing future-setup mention + the new bullet)
```

### Task 3: Dedup the CI-bypass incident guard in `review.yml`

**Files:**
- Modify: `.github/workflows/review.yml:608-692`

- [ ] **Step 1: Insert a dedup search before `issues.create`**

In the `CI-bypass incident guard (post-merge)` step, just before the `await github.rest.issues.create({` call (around line 684), insert a search-by-title call. If an open issue with the same `[CI-bypass incident] PR #${pr}` title already exists, post a comment on it noting the additional reviewer run and return early.

The dedup logic:

```javascript
            // Dedup: a concurrent reviewer run on the same merge would otherwise
            // open a duplicate incident issue (#322 + #323 on 2026-04-21 were
            // duplicates of the same incident). Search open issues by exact title
            // prefix and append a comment instead of opening a second issue.
            const titlePrefix = `[CI-bypass incident] PR #${pr}`;
            const existing = await github.rest.search.issuesAndPullRequests({
              q: `repo:${context.repo.owner}/${context.repo.repo} is:issue is:open in:title "${titlePrefix}"`
            });
            const dup = existing.data.items.find(i => i.title.startsWith(titlePrefix));
            if (dup) {
              await github.rest.issues.createComment({
                ...context.repo,
                issue_number: dup.number,
                body: [
                  `Additional reviewer run on the same merge — opening a duplicate incident was suppressed.`,
                  ``,
                  `**Merge commit**: \`${mergeSha.slice(0,7)}\``,
                  `**Reviewer run**: https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
                ].join('\n')
              });
              core.info(`CI-bypass incident #${dup.number} already open for PR #${pr}; appended comment, skipped duplicate create.`);
              return;
            }
```

- [ ] **Step 2: Verify the YAML still parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/review.yml')); print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Verify the inline JavaScript is syntactically valid**

Extract the inline script and run a Node parse check:

```bash
python3 - <<'PY'
import yaml
y = yaml.safe_load(open('.github/workflows/review.yml'))
review = y['jobs']['review']['steps']
guard = next(s for s in review if s.get('name') == 'CI-bypass incident guard (post-merge)')
script = guard['with']['script']
open('/tmp/guard-script.js', 'w').write(script)
print(f"wrote {len(script)} chars to /tmp/guard-script.js")
PY
node --check /tmp/guard-script.js && echo "JS syntax OK"
```

Expected: `JS syntax OK`.

### Task 4: Commit, push, open PR

- [ ] **Step 1: Stage and commit**

```bash
git add CLAUDE.md .github/workflows/review.yml docs/superpowers/plans/2026-04-26-prevent-ci-bypass-races.md
git commit -m "infra: enforce_admins on main + dedup CI-bypass guard"
```

- [ ] **Step 2: Push and open PR**

```bash
git push origin claude/issue-348-20260426-1953
gh pr create --title "infra: enforce_admins on main + dedup CI-bypass guard" --body "<body with Methodology block, Closes #348>"
```

- [ ] **Step 3: Inherit parent issue's taxonomy labels onto the PR**

```bash
PARENT_LABELS=$(gh issue view 348 --repo noemuch/hive --json labels --jq '[.labels[].name | select(test("^(type:|area:|size:|priority:|source:)"))] | join(",")')
[ -n "$PARENT_LABELS" ] && gh pr edit "$(gh pr view --json number --jq .number)" --repo noemuch/hive --add-label "$PARENT_LABELS"
```

## Self-review checklist

- Spec coverage: Task 1 covers issue point 1 (flip flag); Task 2 covers issue point 2 (CLAUDE.md doc move); Task 3 covers issue point 3 (optional dedup). Three for three.
- Placeholder scan: no TBDs, all bash commands and inline JS shown verbatim.
- Type consistency: title prefix `[CI-bypass incident] PR #${pr}` is identical between the existing `issues.create` call and the new search query. PR variable name `pr` is consistent throughout the JS block.
- Risk: Task 1 affects shared infra (branch protection). The PUT call is reversible by re-running with `enforce_admins=false`, and Step 1 captures the prior state to `/tmp` for rollback. Task 3 is purely defensive — if the dedup search fails, the worst case is the prior behavior (duplicate issue opens). Task 2 is doc-only.
