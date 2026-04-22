---
name: Tier 1 Investigation Roadmap
purpose: The 30 Tier-1 questions with priority + dependency graph
updated: 2026-04-22
---

# Tier 1 — 30 investigations blocking the Hive pivot

## Ordering rationale

Priority = `urgency × dependency-depth` (root questions first). A question that blocks many others is investigated before its dependents. Quick wins (< 4h) are slotted opportunistically to show progress.

## Dependency graph (ASCII)

```
Phase 1 — Prerequisites (no deps, parallel)
├── Q022 — PG partition audit (2h, CRITICAL, first)
├── Q017 — Landing page UX audit
├── Q018 — Onboarding flow audit
├── Q019 — Mobile experience audit
├── Q020 — Empty/Loading/Error states audit
├── Q021 — Accessibility audit
├── Q025 — ToS + Privacy Policy draft
└── Q026 — EU AI Act Art. 50 compliance plan

Phase 2 — Protocol (unlocks tool layer)
├── Q028 — A2A adapter POC (LangGraph inbound + outbound)
└── Q029 — WS vs A2A boundary benchmark

Phase 3 — Tool integration (depends Phase 2)
├── Q001 — Figma MCP feasibility (highest demand design agent)
├── Q002 — Notion MCP
├── Q003 — Slack MCP
├── Q004 — GitHub MCP (canonical for code agents)
├── Q005 — Linear MCP
├── Q006 — Composio as sub-provider for long-tail 250+ tools
├── Q007 — Playwright/Browser MCP for tools without API
├── Q008 — Credential vaulting (AES-GCM, rotation, scope enforcement)
├── Q009 — Tool quota sharing across agents per builder
└── Q010 — Custom MCP server by builder (discovery + authorization)

Phase 4 — Agent import (depends Phase 2)
├── Q011 — Claude Code CLI local → Hive (wrapper pattern)
├── Q012 — Cursor background agents (scrape or skip?)
├── Q013 — Devin import (feasible at all? defer?)
├── Q014 — LangChain / CrewAI wrap to Hive
├── Q015 — Custom GPT migration path
└── Q016 — Agent behind firewall (tunnel patterns)

Phase 5 — Architecture validation (depends Phase 2-4)
├── Q023 — PM orchestrator model choice (Opus vs Sonnet for PM role)
├── Q024 — PM failover mechanism (lease, election, consensus)
└── Q030 — Satellite repo + GitHub App + publish_artifact POC (first real Aurora PR)

Phase 6 — Safety POC (depends Q026)
└── Q027 — Moderation pipeline POC (Presidio + LlamaGuard + C2PA end-to-end)
```

## Execution order

### Batch A — "Cheap wins first" (Day 1, ~4-6h)

| # | Question | Type | Duration | Can parallel? |
|---|---|---|---|---|
| Q022 | PG partition audit | 2h bash + PG inspect | **first, blocking** | No — must run on live DB |
| Q025 | ToS + Privacy Policy draft | 2h legal research + draft | 2h | Yes with others |
| Q026 | EU AI Act Art. 50 plan | 2h regulatory dive + checklist | 2h | Yes |

### Batch B — UX audit (Days 1-2, ~8-12h in parallel)

| # | Question | Type | Duration |
|---|---|---|---|
| Q017 | Landing page UX | Live audit + screenshots + spec | 3h |
| Q018 | Onboarding flow | Walk register → first agent | 2h |
| Q019 | Mobile experience | iOS + Android Safari/Chrome | 3h |
| Q020 | Empty/Loading/Error states | Inventory all screens | 2h |
| Q021 | Accessibility WCAG 2.2 AA | Lighthouse + screen reader | 3h |

### Batch C — Protocol (Days 3-4, ~12-16h)

| # | Question | Type | Duration |
|---|---|---|---|
| Q028 | A2A adapter POC | Spec read + TypeScript impl + LangGraph test | 8-10h |
| Q029 | WS vs A2A benchmark | Latency + throughput test | 3-4h |

### Batch D — Tool MCPs (Days 5-7, ~20h)

| # | Question | Type | Duration |
|---|---|---|---|
| Q001 | Figma MCP | POC agent creates real frame | 4-6h |
| Q004 | GitHub MCP | POC agent opens real PR | 2h (we know this path already via workflows) |
| Q002 | Notion MCP | POC agent writes to DB | 3h |
| Q003 | Slack MCP | POC agent posts message | 2h |
| Q005 | Linear MCP | POC agent creates issue | 2h |
| Q008 | Credential vaulting | AES-GCM schema + rotation flow | 3h |
| Q006 | Composio sub-provider | Signup + integration test | 3h |
| Q007 | Playwright MCP | Test on one tool without API | 3h |
| Q009 | Quota sharing | Token bucket design | 2h |
| Q010 | Custom MCP by builder | Registration flow | 2h |

### Batch E — Agent import (Days 8-9, ~12-16h)

| # | Question | Type | Duration |
|---|---|---|---|
| Q011 | Claude Code CLI | Wrapper + daemon POC | 4h |
| Q014 | LangChain wrap | Real pipeline connect to Hive | 4h |
| Q012 | Cursor bg agents | Research only (likely defer) | 2h |
| Q013 | Devin | Research only (likely skip) | 1h |
| Q015 | Custom GPT | Research + legal path | 2h |
| Q016 | Firewall agent | Tunnel options | 2h |

### Batch F — Architecture POC (Days 10-11, ~12-16h)

| # | Question | Type | Duration |
|---|---|---|---|
| Q023 | PM model choice | Sonnet vs Opus bench on real task | 4h |
| Q024 | PM failover | Lease design + PG impl + test | 6h |
| Q030 | Satellite repo POC | Aurora ships FAKE first PR | 6-8h |

### Batch G — Safety POC (Days 12-13, ~8-12h)

| # | Question | Type | Duration |
|---|---|---|---|
| Q027 | Moderation pipeline | Presidio + LlamaGuard + C2PA e2e | 8-12h |

## Estimated total

- ~90-120h of focused research over 2-3 weeks calendar.
- Parallelizable ~40% via sub-agents.
- Cost LLM estimate: $200-400 in deep research agents.

## Completion criteria

Tier 1 done when:
- [ ] All 30 `QXXX-*.md` files exist with status `DECIDED`
- [ ] POC code runs end-to-end for questions that promised POCs
- [ ] `STATUS.md` shows 30/30 green
- [ ] No unresolved cross-doc contradictions
- [ ] A consolidated "Architecture Decision Record" drawing from all 30 can be auto-generated

After Tier 1, the Hive pivot (Chantier 1 + Chantier 2) can be coded with confidence.
