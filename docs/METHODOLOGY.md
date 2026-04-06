# Hive -- Development Methodology (Solo Dev + Claude Code)

> From working prototype to v1.0 launch. Concrete steps, real time estimates, zero hand-waving.

---

## 1. Resolve Spec Conflicts: The Canon File (Day 1, 3 hours)

Do NOT rewrite 13 documents. Create one new file: `HIVE-CANON.md`. It contains ONLY decisions where specs disagree, formatted as:

```
### Topic: [e.g., "NPC pathfinding library"]
- SPEC.md says: PathFinding.js
- BEHAVIOR-SPEC says: A* on collision layer
- DECISION: Use PathFinding.js on the collision layer extracted from Tiled. 
- Applies to: M2 NPC movement
```

Twenty to thirty entries maximum. Each conflict gets a one-line ruling. When a future Claude Code session encounters ambiguity, CLAUDE.md says "check HIVE-CANON.md first." This takes 2-3 hours because you already know where the conflicts are. Do not update the original specs -- they are historical context, not living contracts.

Going forward, new features get specced directly in their milestone implementation file (see below), not in a separate spec document. The 13 existing specs are frozen reference material.

---

## 2. The Milestone Implementation File Pattern

For each milestone, create one file: `M3-IMPL.md`, `M4-IMPL.md`, etc. Structure:

```
## Tasks (ordered)
1. [ ] Task name -- 1-sentence description -- estimated sessions (1 session = 4h)
2. [ ] ...

## Decisions made during implementation
- (filled in as you go)

## Test checklist
- [ ] (filled in as tasks complete)
```

This is the ONLY planning artifact that gets updated during development. It is both the plan and the changelog. A Claude Code session reads this file at the start and updates it at the end.

---

## 3. Build Order and Critical Path

The remaining 14 Must Have features, sequenced by dependency. Each line shows what it unblocks.

**Phase A -- Finish M2, start M3 (Weeks 1-2, ~8 sessions)**

1. NPC state machine + pathfinding (2 sessions) -- unblocks "living office" feel
2. Agent behavioral state machine: walking, meeting, idle micro-behaviors (2 sessions) -- unblocks the entire visual value proposition
3. Mobile responsive canvas (1 session) -- unblocks shareability
4. Multi-company DB + seed data + auto-placement engine (2 sessions) -- unblocks M3
5. Company card grid page + hero dot canvas (1 session) -- completes M3 navigation

**Phase B -- M4 core loop (Weeks 3-4, ~8 sessions)**

6. Artifact tables + protocol events + server handlers (2 sessions) -- unblocks all work features
7. Observer SQL cron + reputation scoring (2 sessions) -- unblocks leaderboard and profiles
8. Leaderboard page + agent profile page with spider chart (2 sessions) -- unblocks competitive loop
9. Entropy engine: YAML templates + hourly cron + broadcast (2 sessions) -- unblocks world dynamism

**Phase C -- Onboarding + polish (Weeks 5-6, ~8 sessions)**

10. Builder registration flow + agent creation pages (1 session)
11. TypeScript SDK: single-file WebSocket wrapper (1 session)
12. Python SDK: single-file WebSocket wrapper (1 session)
13. Demo team: 5 Haiku agents with personalities, always-on (2 sessions)
14. Landing page + Slow TV mode + quickstart guide (2 sessions)
15. Integration test pass + bug fixes (1 session)

**Parallelization:** Steps 6 and 9 are independent (artifacts vs entropy). Steps 11 and 12 are independent (TS vs Python SDK). Steps 10 and 13 are independent. In a session where you are blocked on one, switch to the other.

**Total: ~24 sessions at 4 hours each = 6 weeks of calendar time at 4h/day.**

---

## 4. Structuring Claude Code Sessions

Each session follows this exact pattern:

**Minute 0-5: Read.** The session brief is in CLAUDE.md under a `## Current Sprint` section. It says: "Read M3-IMPL.md. Next task: #4. Key files: server/src/engine/placement.ts, web/src/app/world/page.tsx." Claude Code reads the impl file, understands what was done last session, and picks up the next task.

**Minute 5-210: Build.** One task per session. Never two. If a task finishes early, write tests for it -- do not start the next task. Context windows degrade; a fresh session with a fresh brief will do the next task better.

**Minute 210-240: Close.** Update M3-IMPL.md: mark the task done, note any decisions made, note any surprises. Update CLAUDE.md if architecture changed. Commit.

**What goes in CLAUDE.md (and stays there):**
- Project structure (current, not aspirational)
- Key rules (the 10 existing rules are good)
- Current sprint: which impl file, which task number, which files to read
- Known gotchas discovered during implementation

**What does NOT go in CLAUDE.md:** Feature descriptions, spec content, aspirational architecture. Those live in the impl files or the frozen specs.

---

## 5. Testing Strategy: Minimal Viable Tests

Write tests AFTER each task, not before. The project has zero tests and a working prototype -- adding tests retroactively to M1/M2 is waste. Write tests forward.

**Three test layers, in priority order:**

1. **Protocol conformance tests (highest value).** 10-15 tests using `bun test` that connect a mock agent via WebSocket, send events, and assert responses. These catch regressions in the core routing, auth, and message flow. Write these once during Phase A and they protect everything downstream. Estimated: 2 sessions total across the project.

2. **Observer correctness tests.** 5-8 SQL-level tests that seed specific message/artifact patterns and assert the reputation scores come out right. The Observer is the most subtle system -- a wrong query silently produces wrong scores. Write these when building the Observer in Phase B. Estimated: 1 session.

3. **Visual smoke tests.** Not automated. After each visual change, open the browser, verify with eyes, capture a screenshot. This is faster and more effective than snapshot testing for a solo dev on a pixel art project.

**Do not write:** Unit tests for utility functions, React component tests, or E2E tests. The ratio of effort to regression-prevention is wrong for a solo developer pre-launch.

**Target: ~25 tests total by launch.** They cover the protocol (the contract with builders) and the Observer (the integrity of the game mechanic). Everything else is caught by manual testing during development.

---

## 6. Spec vs Code Drift: Kill the Problem

The drift exists because specs describe a finished product and code implements what is ready now. The fix is structural:

- **Freeze the 13 spec docs.** They are reference material, not living documents. Stop updating them.
- **CLAUDE.md describes what EXISTS.** Update it every session to match reality.
- **M(n)-IMPL.md describes what is BEING BUILT.** It contains only the current milestone's tasks.
- **HIVE-CANON.md resolves ambiguity.** It is the tiebreaker when two specs disagree.

Three files that stay current. Thirteen files that are frozen context. Drift eliminated.

---

## 7. Git Strategy

Switch to feature branches now. Not per-feature -- per-milestone.

- `main` is always deployable (or at least, not broken).
- `m3-world` branch for all M3 work. Merge to main when M3 criteria pass.
- `m4-work` branch for M4, and so on.
- Tag `v0.3.0` when M3 merges, `v0.4.0` for M4, `v1.0.0` for launch.
- No PR process (solo dev). Just branch, work, merge when criteria pass.

This gives you rollback points and a clean history without overhead.

---

## 8. Contributor Readiness: Do Not Block v1.0

Current score 3/10 is fine. Contributor readiness is an M6 task (the "Ouverture" milestone). Before launch:

- Clean README with setup instructions and a GIF (M6 task, 1 session)
- CONTRIBUTING.md with "how to add an entropy template" and "how to add a tilemap" (M6 task, 0.5 session)
- 3 good-first-issues tagged in GitHub (M6 task, 10 minutes)

That gets you to 6/10, which is enough for launch. Do not spend time on contributor docs before M5 is done.

---

## 9. Deployment: Set Up in Phase B, Not Before

- **Now through Phase A:** localhost only. No deployment overhead.
- **Phase B start (Week 3):** Set up the Hetzner VPS. Deploy server + PostgreSQL. Point `hive.dev` at it. This takes 1 session and you need it because the demo team agents need a persistent server to run against.
- **CI/CD:** A single GitHub Action that runs `bun test` on push and deploys to Hetzner on merge to main. Set this up in the same session as the VPS. Keep it simple: `ssh + rsync + systemctl restart`.
- **Vercel for web:** Already free tier. Connect the repo, auto-deploy on push to main. Zero config.

---

## The First 5 Days (Concrete)

| Day | Time | Deliverable |
|-----|------|-------------|
| 1 | 3h | HIVE-CANON.md with all conflict resolutions |
| 1 | 1h | M2-IMPL.md and M3-IMPL.md with ordered task lists |
| 2 | 4h | NPC state machine + PathFinding.js integration |
| 3 | 4h | Agent behavioral state machine (walk_to, meeting, idle) |
| 4 | 4h | Agent behavior continued + 5 protocol conformance tests |
| 5 | 4h | Mobile responsive + M2 criteria verification |

After day 5, M2 is complete. M3 starts day 6.

---

*Ship the loop. Test the contract. Freeze the specs. One task per session.*
