# Yuumi + Teemo — Hive's autonomous dev duo

> Hive is built by a 2-bot team running 24/7 as GitHub Apps on the `noemuch/hive` repo.
> This doc is the **canonical spec** for their roles, workflows, and decision rules.
>
> **Quick links**
> - Yuumi workflow: [`.github/workflows/yuumi.yml`](../.github/workflows/yuumi.yml)
> - Teemo workflow: [`.github/workflows/teemo-review.yml`](../.github/workflows/teemo-review.yml)
> - Rules & allowlist: [`CLAUDE.md`](../CLAUDE.md#yuumi--teemo--hives-autonomous-dev-duo)

## The duo

### 🐱🎧 Yuumi — Builder

- **Avatar**: sleeping corgi with headphones, mouth open chilling in flowers
- **GitHub App name**: `Yuumi` (installed on `noemuch/hive`)
- **Role**: picks up `agent-ready` issues, writes code, opens PRs
- **LLM**: Claude Sonnet 4.6 by default (smart routing: Opus 4.7 / Haiku 4.5 by label)
- **Skills loaded**: superpowers plugin (writing-plans, executing-plans, TDD, systematic-debugging, code-reviewer, brainstorming, subagent-driven-development)
- **Persona**: lazy on the surface, does all the actual work underneath — classic Yuumi irony

### 🍄🚀 Teemo — Reviewer

- **Avatar**: astronaut Teemo floating in space, golden helmet reflecting stars
- **GitHub App name**: `Teemo` (installed on `noemuch/hive`)
- **Role**: reviews every PR Yuumi opens, approves + auto-merges safe ones
- **LLM**: Claude Opus 4.7 (review = complex reasoning, always premium)
- **Skills loaded**: superpowers plugin (primarily code-reviewer)
- **Persona**: *"Captain Teemo on duty!"* — watchful, rigorous, occasional troll

## Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  ISSUE labeled `agent-ready` (human or auto-triage)         │
│     ↓                                                        │
│  Yuumi's workflow fires on `issues.labeled`                 │
│     ↓                                                        │
│  Smart routing: picks model (Opus/Sonnet/Haiku)             │
│     ↓                                                        │
│  Yuumi reads issue + CLAUDE.md + relevant files             │
│     ↓                                                        │
│  Writes code, commits on `claude/issue-<N>-<date>` branch   │
│     ↓                                                        │
│  Pushes branch + opens PR                                   │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
              ┌───────────────┐
              │  PR opened    │
              └───────┬───────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│  Teemo's workflow fires on `pull_request.opened`            │
│  (only if PR opened by yuumi[bot] or claude[bot])           │
│     ↓                                                        │
│  Teemo checks out PR head, reads:                           │
│    • PR diff (`gh pr diff`)                                 │
│    • Linked issue (acceptance criteria)                     │
│    • CLAUDE.md (rules + allowlist)                          │
│    • This file (`docs/roles.md`)                            │
│     ↓                                                        │
│  Applies 7-axis review:                                     │
│    1. Correctness vs acceptance criteria                    │
│    2. CLAUDE.md compliance (Bun, raw SQL, TS strict…)       │
│    3. Scope discipline (no creep)                           │
│    4. Code quality (naming, idiomatic)                      │
│    5. Security (SQLi, XSS, secrets, auth bypass)            │
│    6. Tests (new coverage + existing pass)                  │
│    7. Yuumi's self-review quality                           │
│     ↓                                                        │
│  Classifies paths touched                                   │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
          ┌───────────┴───────────┐
          ↓                       ↓
   SAFE PATHS ONLY          CRITICAL PATHS
   (docs/, web/,            (auth, migrations,
    scripts/, tests)         peer-eval, etc.)
          ↓                       ↓
   Review clean?           Review clean?
   ┌──┴──┐                ┌──┴──┐
  yes   no               yes   no
   ↓    ↓                 ↓    ↓
  AUTO  request           approve  request
  MERGE changes           + tag    changes
   ↓    (Yuumi            @noemuch (Yuumi
  🎉   iterates)          (manual  iterates)
        ↓                  merge)  ↓
       max 3               ↓        max 3
       rounds              🎉       rounds
```

## Decision tree (Teemo)

| Scenario | Action |
|---|---|
| ✅ Clean review + all paths in safe allowlist | `gh pr review --approve` + `gh pr merge --auto --squash --delete-branch` |
| ✅ Clean review + ≥1 critical path touched | `gh pr review --approve` + tag `@noemuch` in body ("Ready for manual merge") |
| ❌ Issues found on any review axis | `gh pr review --request-changes` + inline comments + tag `@yuumi` |
| ❓ Uncertain / need clarification | `gh pr review --comment` with questions (non-blocking) |

## Safe paths (auto-merge eligible)

Teemo auto-merges ONLY when every file in the PR is in one of:
- `docs/**`
- `web/**`
- `scripts/**`
- `**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts`
- `package.json` dev-deps only

## Critical paths (always human merge)

Teemo approves but never auto-merges if any file is in:
- `server/src/auth/**`
- `server/migrations/**`
- `server/src/engine/peer-evaluation.ts`
- `server/src/db/agent-score-state.ts`
- `agents/lib/agent.ts`
- `server/src/protocol/**`
- `CLAUDE.md`
- `.github/workflows/**`

## Iteration loop

Max **3 rounds** before escalation:

1. Yuumi opens PR
2. Teemo `request_changes` with specific feedback, mentions `@yuumi`
3. Yuumi re-triggers (via review mention), reads feedback, pushes fix commits to same branch
4. Teemo re-reviews on `pull_request.synchronize`
5. If still issues after round 3 → Yuumi applies `agent-blocked` label + tags `@noemuch`

## Smart model routing (Yuumi)

| Label | Model | Max turns | Cost/call avg |
|---|---|---|---|
| `use-opus` | Opus 4.7 | 50 | €0 (Max plan) or ~$2 API |
| *(none)* | Sonnet 4.6 | 35 | €0 or ~$0.40 |
| `use-haiku` | Haiku 4.5 | 15 | €0 or ~$0.10 |
| `priority:critical` | Opus 4.7 (auto) | 50 | €0 or ~$2 |

## Kill-switch

Add label `stop-autonomy` to any issue or PR → both bots immediately skip it. Useful when:
- You want to take over a PR manually
- An issue is in flux and you need to clarify first
- Emergency brake during unexpected automation behavior

To resume: remove the label + optionally re-label `agent-ready` or push new commits.

## Security model

### Identity separation

Yuumi and Teemo are **two distinct GitHub Apps** with independent installations. Why it matters:
- GitHub prevents a PR author from approving their own PR
- If both bots shared one App identity, Teemo couldn't approve Yuumi's PRs
- Having separate Apps (and thus distinct bot identities: `yuumi[bot]`, `teemo[bot]`) enables the review loop

### Permissions (minimum required)

**Yuumi App**:
- Contents: write (push branches)
- Pull requests: write (open PRs)
- Issues: write (comment on issues, apply labels)
- Workflows: write (required for branch creation — GitHub security quirk)
- Metadata: read
- Actions: read
- Checks: write

**Teemo App**:
- Contents: read (read PR diff)
- Pull requests: write (approve, request changes, auto-merge)
- Issues: write (comment on PRs)
- Workflows: write (not typically needed but safer)
- Metadata: read
- Actions: read
- Checks: write

### Secret management

Four secrets on the repo (settings → Secrets and variables → Actions):
- `YUUMI_APP_ID` — App ID (numeric)
- `YUUMI_PRIVATE_KEY` — full `.pem` contents
- `TEEMO_APP_ID`
- `TEEMO_PRIVATE_KEY`

Rotate private keys every 90 days. If an App is compromised: uninstall it, regenerate keys, re-install.

### LLM auth

Both bots share one `CLAUDE_CODE_OAUTH_TOKEN` secret (from user's Claude Max plan). This provides free LLM access via the user's subscription quota. Fallback: `ANTHROPIC_API_KEY` for paid API usage.

## Troubleshooting

### Yuumi doesn't pick up an issue
- Check label is `agent-ready` (exact spelling, case-sensitive)
- Check workflow run: https://github.com/noemuch/hive/actions
- Verify `stop-autonomy` label is NOT applied
- Verify issue author has OWNER/MEMBER/COLLABORATOR association

### Teemo doesn't review a PR
- Check PR author is `yuumi[bot]` or `claude[bot]` (legacy)
- Check `stop-autonomy` label not applied
- Check workflow run

### Auto-merge doesn't fire despite approval
- Check all touched files are in safe paths allowlist
- Check CI is green (required by branch protection)
- Check `.github/` directory is NOT touched (critical path)

### Iteration loop stuck
- Look at Teemo's latest review comments — they should mention specific issues
- If Yuumi can't address them: remove `agent-ready`, take over manually, or comment `@yuumi please try a different approach`

## Operational metrics (target SLOs)

| Metric | Target |
|---|---|
| Yuumi time-to-first-commit | < 2 min from label |
| Teemo time-to-review | < 3 min from PR open |
| Auto-merge success rate (safe paths) | > 80% |
| False-positive approvals (bug slipped past Teemo) | < 5% |
| Iteration rounds average | ≤ 1.5 per PR |

Review this doc quarterly or after 50+ PRs to calibrate.
