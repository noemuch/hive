---
description: Turn a raw idea into a GitHub Initiative (parent epic + native sub-issues, fully-scoped and agent-ready). Chains superpowers:brainstorming + superpowers:writing-plans + gh issue create. Single entry point for autonomous dev loop.
---

# /new-initiative — seamless idea → shipped feature

You are orchestrating the full brainstorm-to-issues pipeline for a new initiative. The user's intent follows this line — treat it as the raw idea to structure.

## STEP 1 — Scope check (anti-hallucination)

Before brainstorming, ground yourself in the actual codebase:

```bash
cat CLAUDE.md | head -200
gh issue list --repo noemuch/hive --state open --limit 50 --json number,title
```

Identify:
- What subsystem the idea touches (`server` / `web` / `agents` / `hear` / `infra`)
- Whether similar work is already in progress (dedup signal)
- Which CLAUDE.md rules are load-bearing for this scope

If the idea references files/components that do NOT exist in the repo, STOP and ask: "I don't see `<file>` in the repo — did you mean `<closest match>`?". Do not hallucinate.

## STEP 2 — Brainstorming (invoke superpowers:brainstorming)

Invoke `superpowers:brainstorming`. Ask 3-10 clarifying questions in ONE ROUND. Cover:
- **Metric**: how will we know this worked? (user behavior change, test passing, visual diff)
- **Audience**: who benefits? (builder / hiring / observer / internal)
- **Scope**: what is IN vs OUT? (list 2-3 exclusions explicitly)
- **Constraints**: any performance / legal / privacy gates?
- **Deadline**: is there one? (affects size budget)
- **Prior art**: are there existing components / endpoints / patterns to reuse?

Present all questions at once. Accept `skip N-M` from the user to short-circuit boring questions. Accept `use your judgment` as a global skip.

## STEP 3 — UX intent bullets (only if `area:web` touched)

If the initiative touches `web/`, produce a **3-bullet UX intent spec**:

```
## UX intent
- Header: <what user sees above fold>
- Body: <core content + primary interaction>
- Footer: <secondary actions + CTA>
```

Wait for user 👍 (or correction like "change header → spider chart lower"). This catches UX disagreements BEFORE the builder writes a single LOC. Skip this step entirely for server-only / infra-only initiatives.

## STEP 4 — Plan (invoke superpowers:writing-plans)

Invoke `superpowers:writing-plans`. Decompose the initiative into 2-6 atomic steps. For each step, keep a JSON-shaped node in memory with:

```typescript
{
  id: "db-migration" | "api-endpoint" | "ui-component" | "test" | ...,  // short slug
  title: "[N/M] <conventional commit prefix>: <short description>",
  body: string,           // issue body (see template below)
  labels: string[],       // inherit from parent taxonomy + "agent-ready"
  dependsOn: string[],    // IDs of SIBLING steps (NEVER parent — causes deadlock)
  size: "XS" | "S" | "M" | "L" | "XL",
}
```

### Child issue body template

```markdown
## Intent
<1-2 lines, inherited from UX bullets if area:web>

## Acceptance criteria (testable)
- [ ] <criterion 1 — must be automatable or reviewable>
- [ ] <criterion 2>
- [ ] <criterion 3>

## Entry points (1-2 stable anchors — NOT a full files-to-touch list)
- `<file>` — why it's the starting point

## Scope boundaries
**IN:** <what this PR ships>
**OUT:** <what this PR does NOT touch — explicit non-goals>

## Methodology expectation
Builder: invoke `superpowers:writing-plans` (post the plan on the PR), `superpowers:test-driven-development` if tests exist.

Related to: #<parent-initiative-number> (non-blocking, for navigation only)
```

**HARD RULES (Gap D + Gap 3.2 fixed earlier today):**
- NEVER write `Depends on: #<parent>` — causes deadlock (parent is epic, stays open until children close).
- `Related to: #<parent>` is allowed (non-blocking, discoverability only).
- `Depends on: #<sibling>` is allowed ONLY if the sibling's output is a hard prerequisite (DB migration before API query).
- Max 6 children per initiative (aligned with issue-splitter cap).

### Cycle check (Gap D)

After drafting the plan as a JSON array, run:

```bash
bun run scripts/new-initiative.ts detect-cycle '<the-json-array>'
```

Expected: `acyclic`. If a cycle is reported, redraw the dep graph (break one sibling dep into a "Related to:" link) before proceeding.

## STEP 5 — Dedup check (Gap B)

```bash
bun run scripts/new-initiative.ts dedup "<parent initiative title>"
```

If matches come back, show the user: "Found similar open issues: #X, #Y. Continue anyway, close them as duplicates, or abort?". Respect user's choice.

## STEP 6 — Create issues (idempotent, with retry — Gap C)

Order of creation:

1. **Parent** `[INITIATIVE] <name>` issue with labels `epic`, `type:<primary>`, `area:<primary>`, `priority:<chosen>`. Save its number as `PARENT_NUM`.

2. **Each child** via `gh issue create`. Since Gap C retry lives inside `scripts/new-initiative.ts`, prefer calling through it when feasible; otherwise use `gh issue create --repo noemuch/hive` directly with the labels computed above.

3. **Link children to parent** via GraphQL `addSubIssue` mutation — this creates the native sub-issue relationship that GitHub renders as a tree view and that `dispatch-ready.yml` / `weekly-retro.yml` walk via `subIssues { nodes }`. Also makes the parent auto-close when all children close.

   Resolve node IDs then link:

   ```bash
   PARENT_ID=$(gh api graphql -F num=$PARENT_NUM -f query='query($num: Int!) { repository(owner:"noemuch",name:"hive") { issue(number:$num){ id } } }' --jq '.data.repository.issue.id')

   for CHILD_NUM in "${CHILDREN_NUMS[@]}"; do
     CHILD_ID=$(gh api graphql -F num=$CHILD_NUM -f query='query($num: Int!) { repository(owner:"noemuch",name:"hive") { issue(number:$num){ id } } }' --jq '.data.repository.issue.id')
     gh api graphql -F parentId="$PARENT_ID" -F childId="$CHILD_ID" -f query='
       mutation($parentId: ID!, $childId: ID!) {
         addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
           subIssue { number title }
         }
       }'
   done
   ```

4. **Apply `agent-ready`** to each child that has no open sibling blocker. `dispatch-ready` will handle the `waiting-deps` labeling on its next cron tick for the rest.

**Rollback on partial failure:** if parent created but children creation fails irrecoverably after retries, post a comment on the parent: "⚠️ Partial creation: children #X, #Y created; #Z failed. Please investigate or manually re-run /new-initiative." Do NOT leave silent orphans.

## STEP 7 — Done: summary comment on parent

```markdown
🚀 **Initiative created** — N children filed.

## Execution plan
1. [1/N] #<N1> — <title>, size:<X>, agent-ready ✓
2. [2/N] #<N2> — <title>, size:<X>, waiting-deps (Depends on: #<N1>)
3. ...

## UX intent (if area:web)
- Header: ...
- Body: ...
- Footer: ...

## Next
Dispatch-ready cron fires in ≤15 min; first builder run will pick up #<N1>. You'll see 👀 Preview URLs on this issue as each sub-merge ships. Tomorrow's QA digest will include this initiative's progress.
```

Exit. Do not wait for the builds — the GitHub pipeline takes over from here.
