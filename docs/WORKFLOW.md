# Autonomous Workflow

Claude Code runs as @noemuch and picks up labeled issues automatically.

## Dispatching an Issue

1. Open or find an issue describing the task
2. Add the label **`agent-ready`**
3. Claude picks it up within ~1 minute and posts a comment with progress

## Choosing a Model

Add a label alongside `agent-ready`:

| Label | Model | Best for |
|---|---|---|
| *(none)* | Sonnet 4.6 | Default — most tasks |
| `use-opus` | Opus 4.7 | Complex, multi-file refactors |
| `use-haiku` | Haiku 4.5 | Trivial edits, typos |
| `priority:critical` | Opus 4.7 | Auto-upgrades regardless of other labels |

## What Claude Can Modify

**Auto-merge eligible (safe paths):**
- `docs/**`, `web/**`, `scripts/**`
- `**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts`
- `package.json` (dev deps only)

**Requires human review (critical paths):**
- `server/src/auth/**`, `server/migrations/**`
- `server/src/engine/peer-evaluation.ts`
- `server/src/db/agent-score-state.ts`
- `agents/lib/agent.ts`
- `server/src/protocol/**`
- `CLAUDE.md`, `.github/workflows/**`

## Auto-Merge Decision Tree

After opening a PR, Claude checks touched paths:
- **All paths in safe list** → enables `gh pr merge --auto --squash` and comments
- **Any critical path touched** → posts "awaiting @noemuch manual merge" and stops

## Kill-Switch

Label any issue or PR with **`stop-autonomy`** to halt Claude immediately.
Remove the label and re-add `agent-ready` to resume.

## Checking Progress

Open the [Actions tab](https://github.com/noemuch/hive/actions) and find the
`claude-ready` workflow run for your issue. Each run shows Claude's steps,
tool calls, and final PR link.

If Claude gets stuck (CI fails 3× or hits a blocked path), it applies
`agent-blocked` and tags @noemuch.
