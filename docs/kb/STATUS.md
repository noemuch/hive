---
name: Tier 1 Live Progress Tracker
updated: 2026-04-22T10:30:00Z
---

# Tier 1 — Live status

Progress: **1/30 DECIDED** · **0 IN PROGRESS** · **29 OPEN**

| Q | Title | Batch | Status | Confidence | Cost | POC | File |
|---|---|---|---|---|---|---|---|
| Q001 | Figma MCP feasibility | D | OPEN | – | $0 | planned | – |
| Q002 | Notion MCP feasibility | D | OPEN | – | $0 | planned | – |
| Q003 | Slack MCP feasibility | D | OPEN | – | $0 | planned | – |
| Q004 | GitHub MCP feasibility | D | OPEN | – | $0 | planned | – |
| Q005 | Linear MCP feasibility | D | OPEN | – | $0 | planned | – |
| Q006 | Composio sub-provider long-tail | D | OPEN | – | $0 | planned | – |
| Q007 | Playwright/Browser MCP | D | OPEN | – | $0 | planned | – |
| Q008 | Credential vaulting AES-GCM | D | OPEN | – | $0 | planned | – |
| Q009 | Tool quota sharing | D | OPEN | – | $0 | planned | – |
| Q010 | Custom MCP by builder | D | OPEN | – | $0 | planned | – |
| Q011 | Claude Code CLI → Hive | E | OPEN | – | $0 | planned | – |
| Q012 | Cursor bg agents import | E | OPEN | – | $0 | research-only | – |
| Q013 | Devin import feasibility | E | OPEN | – | $0 | research-only | – |
| Q014 | LangChain/CrewAI wrap | E | OPEN | – | $0 | planned | – |
| Q015 | Custom GPT migration | E | OPEN | – | $0 | research-only | – |
| Q016 | Agent behind firewall | E | OPEN | – | $0 | planned | – |
| Q017 | Landing page UX | B | OPEN | – | $0 | audit-only | – |
| Q018 | Onboarding flow UX | B | OPEN | – | $0 | audit-only | – |
| Q019 | Mobile experience | B | OPEN | – | $0 | audit-only | – |
| Q020 | Empty/Loading/Error states | B | OPEN | – | $0 | audit-only | – |
| Q021 | Accessibility WCAG 2.2 AA | B | OPEN | – | $0 | audit-only | – |
| **Q022** | **PG partition audit** | **A** | **DECIDED** | HIGH | $0.5 | audit done, fix spec'd | [Q022](tier1/Q022-pg-partition-audit.md) |
| Q023 | PM orchestrator model choice | F | OPEN | – | $0 | planned | – |
| Q024 | PM failover mechanism | F | OPEN | – | $0 | planned | – |
| Q025 | ToS + Privacy Policy draft | A | OPEN | – | $0 | legal draft | – |
| Q026 | EU AI Act Art. 50 plan | A | OPEN | – | $0 | compliance checklist | – |
| Q027 | Moderation pipeline POC | G | OPEN | – | $0 | e2e POC | – |
| Q028 | A2A adapter POC | C | OPEN | – | $0 | code POC | – |
| Q029 | WS vs A2A benchmark | C | OPEN | – | $0 | benchmark POC | – |
| Q030 | Satellite repo + first PR | F | OPEN | – | $0 | live POC | – |

## Legend

- **Batch**: execution grouping from `_ROADMAP.md`
- **Status**: `OPEN | IN_PROGRESS | DECIDED | BLOCKED | DEFERRED | STALE`
- **Confidence**: `LOW | MEDIUM | HIGH`
- **Cost**: cumulative LLM $ spent on this question
- **POC**: `planned | running | passing | failing | audit-only | research-only | legal draft | compliance checklist`
- **File**: link to `tier1/QXXX-*.md` once created

## Batch progress

- [ ] Batch A — Cheap wins (Q022, Q025, Q026) — 0/3
- [ ] Batch B — UX audit (Q017-Q021) — 0/5
- [ ] Batch C — Protocol (Q028, Q029) — 0/2
- [ ] Batch D — Tool MCPs (Q001-Q010) — 0/10
- [ ] Batch E — Agent import (Q011-Q016) — 0/6
- [ ] Batch F — Architecture POC (Q023, Q024, Q030) — 0/3
- [ ] Batch G — Safety POC (Q027) — 0/1

## Next action

**Q025 + Q026** (Batch A cheap wins, parallel-safe) — ToS + Privacy draft + EU AI Act Art. 50 compliance checklist.

Then **Batch B** (UX audit live — Q017-Q021) in parallel via sub-agents.

## Completed log

- 2026-04-22 — **Q022 DECIDED** (HIGH confidence). Found real time-bomb: partitions declared but no auto-maintenance; ~2 months of runway from last migration run. Fix spec'd (GH scheduled workflow + SQL script), ready to ship. See [Q022-pg-partition-audit.md](tier1/Q022-pg-partition-audit.md).
