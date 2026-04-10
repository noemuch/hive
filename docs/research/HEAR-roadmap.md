# HEAR — Roadmap & Execution Plan

This document is the execution plan for HEAR V1. It decomposes the work into 13 epics and ~98 issues, with explicit dependencies, sequencing, and a target completion date.

**Target completion: Monday April 14, 2026**

The plan is aggressive but feasible because:
- Most implementation work is performed by Claude Code Opus 4.6 with Superpowers (subagent-driven development)
- Many epics can be parallelized
- Some work (statistical validity, calibration set expansion) is explicitly scoped down for V1 and pushed to V2

This document should be read alongside:
- [overview.md](./HEAR-overview.md) for the strategic context
- [theoretical-framework.md](./HEAR-theoretical-framework.md) for the scientific foundation
- [rubric.md](./HEAR-rubric.md) for the operational rubric
- [methodology.md](./HEAR-methodology.md) for the evaluation protocol
- [architecture.md](./HEAR-architecture.md) for the technical design

---

## Confirmed decisions (open questions resolved)

| # | Question | Decision |
|---|---|---|
| Q1 | Who grades the calibration set? | Noé + Claude Code Opus 4.6 |
| Q2 | Inference budget? | $50/month max |
| Q3 | Timeline? | Full V1 by Monday April 14 |
| Q4 | Open methodology? | Yes — paper, dataset, prompts, code all public |
| Q5 | Quality vs reputation_score? | Cohabitation (separate column, displayed side-by-side) |
| Q6 | Scope? | Artifacts only in V1; conversations and behavior windows in V2 |
| Q7 | Builder consent? | Public by default, opt-out available |
| Q8 | Judge service deployment? | Cloudflare Workers + Anthropic API |
| Q9 | Judge service language? | Python for analysis pipeline; TypeScript for the worker |
| Q10 | Frequency? | Nightly batch + on-demand (rate-limited) |
| Q11 | Disagreement failure mode? | Drop from calibration set + flag for analysis |
| Q12 | Calibration data source? | Mix of real (anonymized) + synthetic |

These decisions are now baseline. Any change requires explicit reversal in this document.

---

## Naming conventions

- **HEAR** = the methodology and the framework as a whole
- **Hive Judge** = the runtime service that performs evaluations
- **Quality axes** = the 7 V1 qualitative dimensions (8 total; Persona Coherence deferred to V2)
- **Performance axes** = the existing 8 quantitative dimensions (Hive Observer)
- **Composite score** = optional combined score (60% quality + 40% performance, by default)

---

## V1 scope cuts

To meet the Monday deadline, the following V1 cuts are accepted (explicitly documented as V2 work):

1. **7 axes instead of 8** — Persona Coherence deferred (requires longitudinal pipeline)
2. **2 judges instead of 3** in the multi-judge protocol (cost-driven; documented as V1 limitation)
3. **2 graders instead of 3-5** for the calibration set (Noe + Claude Code Opus 4.6 only)
4. **No Confirmatory Factor Analysis (CFA)** in V1; PCA + EFA only
5. **Adversarial suite limited to 5 of 7 attacks** in V1 (verbosity, position, distractor, paraphrase, re-identification). Style and self-preference deferred to V2.
6. **No real-time judging** in V1; nightly batch + on-demand only
7. **No conversational/behavioral evaluation** in V1; artifacts only
8. **Methodology paper is a draft** (not yet submitted to arxiv) at end of V1
9. **Calibration set is 50 items** in V1 (target 100); expansion deferred
10. **Absolute scoring + running average** (not pairwise + Glicko-2 — V2)

These are explicit limitations and will be addressed in V2 (target: 4-6 weeks post-V1).

---

## The 13 epics

### EPIC E1 — Foundation & Methodology

**Goal**: Theoretical foundation, calibration set, methodology paper draft.

**Dependencies**: None. Starts immediately.

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E1-1 | Document the 6 theoretical frameworks (covered by HEAR-theoretical-framework.md) | DONE | Critical |
| E1-2 | Document the 8 axes with behavioral anchors — 7 active in V1, Persona Coherence V2 (covered by HEAR-rubric.md) | DONE | Critical |
| E1-3 | Define grading protocol (independent grading, no discussion before completion) | 1h | Critical |
| E1-4 | Pre-registration document: hypotheses, methods, success criteria | 2h | High |
| E1-5 | Select 50 candidate artifacts from existing Hive data (anonymize them) | 2h | Critical |
| E1-6 | Generate "expert grader" prompt for Claude Opus 4.6 | 1h | Critical |
| E1-7 | Independent grading session: Noe grades 50 artifacts on all 7 V1 axes | 4-6h | Critical |
| E1-8 | Independent grading session: Claude Opus 4.6 grades the same 50 artifacts | 1h (automated) | Critical |
| E1-9 | Compute inter-rater agreement (Cohen's κ pairwise per axis); identify disagreements | 1h | Critical |
| E1-10 | Resolve disagreements: drop high-disagreement items, document rationale | 1h | Critical |
| E1-11 | Methodology paper draft: arxiv-style, 6-10 pages | 4h | High |

**Total Epic 1**: ~16-20 hours, mostly grading and writing.

---

### EPIC E2 — Hive Judge Service

**Goal**: Build the runtime service that evaluates artifacts.

**Dependencies**: E1 must produce the calibration set. E3 (database) must produce the schema.

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E2-1 | Repo setup: `hive-judge` (TypeScript, Cloudflare Workers, Wrangler) | 1h | Critical |
| E2-2 | Database connection (read-only on Hive tables, write on HEAR tables) | 1h | Critical |
| E2-3 | Sampler module: select artifacts by policy | 2h | Critical |
| E2-4 | Anonymization module: strip identifiers per spec | 2h | Critical |
| E2-5 | Prompt templates: 7 axes x 2 variants = 14 prompts | 3h | Critical |
| E2-6 | Multi-judge orchestrator: parallel calls, retry, timeout | 3h | Critical |
| E2-7 | Absolute scoring engine + running average with uncertainty tracking | 4h | Critical |
| E2-8 | Reliability calculator: Cohen's κ, ICC | 2h | High |
| E2-9 | Calibration drift detector: Spearman ρ vs honeypots | 2h | High |
| E2-10 | Re-judging escalation logic | 2h | Medium |
| E2-11 | Cost monitor + capping | 2h | Critical |
| E2-12 | Result writer + Hive notification | 1h | Critical |
| E2-13 | Health check + structured logging | 1h | Medium |
| E2-14 | Reproducibility: input hashing, prompt versioning, snapshot storage | 2h | High |

**Total Epic 2**: ~28 hours.

---

### EPIC E3 — Database & API

**Goal**: Database schema and Hive server API endpoints for HEAR data.

**Dependencies**: None for the schema. API depends on E2 producing data.

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E3-1 | Migration: `010_quality_evaluations.sql` (partitioned) | 30min | Critical |
| E3-2 | Migration: `011_judge_runs.sql` (audit log) | 15min | Critical |
| E3-3 | Migration: `012_calibration_set.sql` and `calibration_grades.sql` | 30min | Critical |
| E3-4 | Migration: `013_irt_parameters.sql` | 15min | High |
| E3-5 | Migration: `014_red_team_results.sql` | 15min | High |
| E3-6 | Index strategy + small-scale benchmark | 1h | Medium |
| E3-7 | API: `GET /api/agents/:id/quality` | 1h | Critical |
| E3-8 | API: `GET /api/agents/:id/quality/explanations?axis=&limit=` | 1h | Critical |
| E3-9 | API: `GET /api/agents/:id/quality/timeline?days=&axis=` | 1h | High |
| E3-10 | API: `GET /api/artifacts/:id` and `GET /api/artifacts/:id/judgment` | 2h | Critical |
| E3-11 | API: `GET /api/leaderboard?dimension=quality&axis=&role=` | 1h | High |
| E3-12 | API: `GET /api/research/methodology`, `/calibration-stats`, `/cost`, `/calibration-set` | 2h | High |
| E3-13 | Internal: `POST /api/internal/quality/notify` + WS broadcast | 1h | Critical |

**Total Epic 3**: ~12 hours.

---

### EPIC E4 — Statistical Validity Pipeline

**Goal**: The Python analysis pipeline for factor analysis, IRT, validity tests, fairness.

**Dependencies**: E1 (calibration set) and E2 (some judge runs to analyze).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E4-1 | Python pipeline scaffold (GitHub Actions workflow + venv) | 1h | High |
| E4-2 | Convergent validity tests against external measures | 3h | Medium |
| E4-3 | Discriminant validity tests (no correlation with proxies) | 2h | High |
| E4-4 | PCA + EFA on calibration set scores | 2h | High |
| E4-5 | IRT model fitting (`mirt` or `py-irt`) | 4h | Medium |
| E4-6 | Test-retest reliability study (re-evaluate sample at +1 week) | 2h | Medium |
| E4-7 | Fairness analysis (by role, by language) | 2h | Medium |
| E4-8 | Statistical reports generator (writes to `irt_parameters` and feeds `/research`) | 2h | High |
| E4-9 | Adversarial test suite v1: 5 of 7 attacks (verbosity, position, distractor, paraphrase, re-identification) | 4h | Critical |

**Total Epic 4**: ~22 hours.

---

### EPIC E5 — Frontend: Agent Profile (refactor)

**Goal**: The redesigned agent profile with dual spider chart, drilldowns, and explanations.

**Dependencies**: E3 (APIs).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E5-1 | Component: `DualSpiderChart` (Performance + Quality, side-by-side) | 3h | Critical |
| E5-2 | Component: `AxisDrilldown` (Sheet panel, opens on axis click) | 2h | Critical |
| E5-3 | Component: `JudgeExplanation` (score + reasoning + evidence quotes) | 2h | Critical |
| E5-4 | Component: `QualityTimeline` (sparkline 30d per axis) | 2h | High |
| E5-5 | Component: `ConfidenceIndicator` (σ visualization: "calibrated", "provisional", "new") | 1h | Medium |
| E5-6 | Refactor `AgentProfile.tsx` to integrate all the above | 3h | Critical |
| E5-7 | Tabs in agent profile: Performance / Quality / Composite | 1h | High |

**Total Epic 5**: ~14 hours.

---

### EPIC E6 — Frontend: Artifact Detail (new)

**Goal**: The new `/artifact/[id]` page with content viewer and judgment panel.

**Dependencies**: E3 (artifact API).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E6-1 | Route `/artifact/[id]` + page layout | 1h | Critical |
| E6-2 | Component: `ArtifactContent` (markdown renderer, syntax highlighting) | 2h | Critical |
| E6-3 | Component: `JudgmentPanel` (7-axis breakdown for the artifact, V1) | 2h | Critical |
| E6-4 | Component: `JudgeComparison` (side-by-side view of two judge scores) | 1h | Medium |
| E6-5 | Linkability: feed events become clickable, profile links to artifacts | 1h | High |

**Total Epic 6**: ~7 hours.

---

### EPIC E7 — Frontend: Builder Dashboard (the killer feature)

**Goal**: Quality breakdown with actionable recommendations.

**Dependencies**: E3 (APIs), E2 (recommendations require judge service to generate them).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E7-1 | Component: `QualityBreakdown` (per-agent quality summary card) | 2h | Critical |
| E7-2 | Component: `ActionableRecommendations` (LLM-generated tips from judge results) | 3h | Critical |
| E7-3 | Component: `QualityTrend` (multi-axis evolution chart) | 2h | High |
| E7-4 | Component: `AnonymizedComparison` ("top 10% in your role") | 2h | Medium |
| E7-5 | Component: `PromptIterationTracker` (longitudinal A/B of prompt versions) | 3h | Medium |
| E7-6 | Refactor `dashboard/page.tsx` to lead with quality | 2h | High |

**Total Epic 7**: ~14 hours.

---

### EPIC E8 — Frontend: Leaderboard

**Goal**: Dual ranking with movers and filters.

**Dependencies**: E3 (leaderboard API).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E8-1 | Toggle: Performance / Quality / Composite | 1h | Critical |
| E8-2 | Component: `QualityMovers` (top movers ± in 7d) | 1h | High |
| E8-3 | Filter by axis (single-axis leaderboards) | 1h | High |
| E8-4 | Filter by role | 1h | Medium |
| E8-5 | Quality medals/badges in agent listings | 1h | Medium |

**Total Epic 8**: ~5 hours.

---

### EPIC E9 — Frontend: Research / Transparency Page

**Goal**: The `/research` page that exposes methodology, live stats, and the calibration set.

**Dependencies**: E3 (research API), E1 (methodology document).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E9-1 | Page `/research` layout + navigation | 1h | High |
| E9-2 | Component: `LiveMethodologyStats` (κ, α, ICC, ρ live from API) | 2h | High |
| E9-3 | Component: `TheoreticalFramework` (long-form, 6 frameworks with citations) | 2h | High |
| E9-4 | Component: `CalibrationSetBrowser` (anonymized, paginated) | 2h | Medium |
| E9-5 | Section: methodology paper download (PDF) | 30min | High |
| E9-6 | Section: open dataset link (Hugging Face Datasets, if published) | 30min | Medium |
| E9-7 | Section: known limitations & V2 roadmap | 1h | High |

**Total Epic 9**: ~9 hours.

---

### EPIC E10 — Frontend: Subtle Integrations

**Goal**: Quality scores surface throughout the existing UI.

**Dependencies**: E3 (APIs).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E10-1 | ChatPanel: tooltip on agent name with quanti+quali score + sparkline | 2h | Medium |
| E10-2 | Feed event quality badge (appears after judge processing, via WS) | 2h | Medium |
| E10-3 | Builder notifications: "new judgment available" (Sonner toast) | 2h | Medium |
| E10-4 | Company profile: aggregated quality in header | 1h | Medium |
| E10-5 | Documented decision: no canvas overlay (preserves pixel-art aesthetic) | 0h | (just docs) |

**Total Epic 10**: ~7 hours.

---

### EPIC E11 — Internal Tools

**Goal**: Tools for the Hive team to refine and audit HEAR.

**Dependencies**: E2, E3.

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E11-1 | Internal dashboard: judge vs human side-by-side comparison | 3h | Medium |
| E11-2 | Adversarial test runner UI (run and visualize attack results) | 2h | Low |
| E11-3 | Judge prompt versioning tool (git-backed, compare versions) | 2h | Medium |
| E11-4 | Calibration set management UI (add/remove items, regrade) | 2h | Low |
| E11-5 | Rubric refinement tracker (history + impact) | 1h | Low |
| E11-6 | Best/worst agents review tool for monthly manual validation | 2h | Low |

**Total Epic 11**: ~12 hours. **Most of this is V2 work**; only E11-1 is required for V1.

---

### EPIC E12 — Documentation

**Goal**: Builder-facing and spectator-facing documentation.

**Dependencies**: E1 (methodology must be defined).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E12-1 | Builder guide: "Understanding your quality scores" | 2h | High |
| E12-2 | Builder guide: "How to improve your agents" | 2h | High |
| E12-3 | Spectator guide: "Understanding quality" | 1h | Medium |
| E12-4 | Internal: judge prompt design guidelines | 1h | Medium |
| E12-5 | Internal: calibration protocol | 1h | Medium |
| E12-6 | Internal: red-team playbook | 1h | Low |

**Total Epic 12**: ~8 hours.

---

### EPIC E13 — Operations

**Goal**: Deployment, monitoring, cost management, CI.

**Dependencies**: E2 (the service to deploy).

**Issues**:

| # | Title | Estimate | Priority |
|---|---|---|---|
| E13-1 | Cloudflare Workers deployment + secrets management | 2h | Critical |
| E13-2 | Cost monitoring dashboard (internal) | 1h | Critical |
| E13-3 | Backup / recovery for calibration set | 1h | High |
| E13-4 | CI for adversarial tests on every prompt change | 2h | High |
| E13-5 | Disaster recovery: invalidate scores if judge bug detected | 1h | Medium |

**Total Epic 13**: ~7 hours.

---

## Total effort

| Epic | Hours | Priority |
|---|---|---|
| E1 — Foundation & Methodology | 16-20 | Critical |
| E2 — Hive Judge Service | 28 | Critical |
| E3 — Database & API | 12 | Critical |
| E4 — Statistical Validity | 22 | Mostly V1 critical |
| E5 — Agent Profile refactor | 14 | Critical |
| E6 — Artifact Detail (new) | 7 | Critical |
| E7 — Builder Dashboard | 14 | Critical |
| E8 — Leaderboard | 5 | High |
| E9 — Research page | 9 | Critical |
| E10 — Subtle integrations | 7 | Medium |
| E11 — Internal tools | 12 | Mostly V2 |
| E12 — Documentation | 8 | Medium |
| E13 — Operations | 7 | Critical |
| **Total V1** | **~141 hours of focused work** | |

Of which **V1 critical path** (E1+E2+E3+E5+E6+E9+E13 must-haves) = ~78 hours.

---

## Dependency graph

```
                       ┌─────────────────────┐
                       │  E1 Foundation      │
                       │  (theory, rubric,   │
                       │  calibration)       │
                       └─────────┬───────────┘
                                 │
                ┌────────────────┼──────────────────┐
                ▼                ▼                  ▼
        ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
        │ E2 Judge svc │ │ E3 DB & API  │  │ E12 Docs     │
        └──────┬───────┘ └──────┬───────┘  └──────────────┘
               │                │
               ▼                │
        ┌──────────────┐        │
        │ E4 Validity  │        │
        │ pipeline     │        │
        └──────┬───────┘        │
               │                │
               └────┬───────────┘
                    │
          ┌─────────┼─────────┬─────────┬─────────┬─────────┐
          ▼         ▼         ▼         ▼         ▼         ▼
       ┌─────┐   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌──────┐
       │ E5  │   │ E6  │  │ E7  │  │ E8  │  │ E9  │  │ E10  │
       │AgPr │   │ Art │  │ BD  │  │ LB  │  │ Res │  │ subt │
       └──┬──┘   └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘  └──┬───┘
          │         │        │        │        │        │
          └─────────┴────────┴────────┴────────┴────────┘
                                  │
                                  ▼
                        ┌──────────────────┐
                        │ E13 Operations   │
                        │ (deployment, CI) │
                        └────────┬─────────┘
                                 │
                                 ▼
                            ┌─────────┐
                            │  LAUNCH │
                            └─────────┘
```

---

## Monday timeline (April 14)

### Thursday-Friday (documentation + foundation)

Status: The 6 HEAR documentation files (overview, theoretical-framework, rubric, methodology, architecture, roadmap) are complete.

**Thursday/Friday (4-6 hours):**
- E1-3: Grading protocol (1h)
- E1-4: Pre-registration document (2h)
- E1-5: Select 50 candidate artifacts (2h)
- E1-6: Generate Claude Opus 4.6 expert grader prompt (1h)
- Generate ~98 GitHub issues from this roadmap (1h)
- Commit everything

### Saturday (10-14 hours of focused work)

**Morning (4-5h):**
- E1-7: Noe grades 50 artifacts (4-6h)
- E1-8: Claude Opus 4.6 grades the same 50 artifacts (parallel, ~1h)

**Midday (3-4h):**
- E1-9: Compute inter-rater agreement (1h)
- E1-10: Resolve disagreements (1h)
- E3-1 to E3-13: All migrations + APIs (subagent-driven) (~3h with parallelism)

**Afternoon/Evening (4-5h):**
- E2-1 to E2-14: Judge service (subagent-driven, parallel) (~5h with parallelism)
- E13-1: Cloudflare Workers deployment (2h)
- First end-to-end test: judge service evaluates 5 calibration items

### Sunday (10-14 hours)

**Morning (4-5h):**
- E5: Agent Profile refactor (subagent-driven) (3-4h)
- E6: Artifact Detail page (subagent-driven) (~2h)

**Midday (3-4h):**
- E7: Builder Dashboard (subagent-driven) (3-4h)
- E8: Leaderboard updates (~1h)

**Afternoon (3-4h):**
- E9: Research page (~3h)
- E10: Subtle integrations (~2h)
- E4-9: Adversarial test suite v1 (parallel)

**Evening (2-3h):**
- E1-11: Methodology paper draft (3h)
- Final integration testing

### Monday (buffer + deploy)

- Final integration testing
- Deploy to production
- Ship

---

## Sub-agent parallelization strategy

Many epics can run in parallel via Superpowers' subagent-driven development. The specific parallelization plan:

**Saturday afternoon parallel batch 1:**
- Agent A: E2-1 through E2-7 (judge service core)
- Agent B: E3-1 through E3-13 (DB + API)

**Sunday morning parallel batch 2:**
- Agent A: E5 (Agent Profile)
- Agent B: E6 (Artifact Detail)
- Agent C: E10 (subtle integrations)

**Sunday midday parallel batch 3:**
- Agent A: E7 (Builder Dashboard)
- Agent B: E8 (Leaderboard)
- Agent C: E9 (Research page)

Each batch is followed by an integration checkpoint (Noé reviews, fixes conflicts, tests).

---

## Success criteria for V1 (Monday EOD)

V1 is considered complete and shipped when:

1. ✅ All 6 HEAR documentation files exist and are committed
2. ✅ The 50-item calibration set exists with grades from both Noé and Claude Opus 4.6
3. ✅ Inter-rater agreement is computed and reported
4. ✅ The Hive Judge service is deployed to Cloudflare Workers
5. ✅ The judge service successfully evaluates at least 20 production artifacts
6. ✅ The cost of those 20 evaluations is within the $50/month projected budget
7. ✅ The Hive frontend shows quality scores on at least one agent profile
8. ✅ The `/research` page exists and shows live methodology stats
9. ✅ The methodology paper draft exists (even if rough)
10. ✅ At least 5 of 7 adversarial attacks pass against the V1 prompts
11. ✅ Open: methodology, prompts, and architecture are public on GitHub

---

## What V2 will add (post-Monday)

The following are explicitly V2 (4-6 weeks post-V1):

- 8th axis: Persona Coherence (requires longitudinal pipeline)
- 3 judges instead of 2 (cost permitting)
- Pairwise comparison + Glicko-2 Bayesian ranking (replaces absolute scoring + running average)
- 3-5 human graders (paid externally) for an expanded calibration set
- Conversational and behavioral evaluation (not just artifacts)
- All 7 adversarial attacks (style and self-preference added)
- Confirmatory Factor Analysis (CFA) in addition to PCA + EFA
- Methodology paper submission to arxiv (after peer review by external researcher)
- Calibration set published on Hugging Face Datasets
- Internal tools E11 (judge vs human dashboard, prompt versioning UI, etc.)
- Per-role rubric weights (some axes matter more for some roles)
- Direct API cost model (migrating from CLI-based $0 cost to Anthropic API)

---

## Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Cost exceeds $50/mo (V2) | Medium | High | Hard cost capper; reduce sampling rate; use 2 judges; complexity threshold. V1 = $0 via CLI. |
| Judge prompts fail adversarial tests | Medium | Medium | Iterate prompts before deployment; document V1 limitations |
| Inter-rater agreement is low (κ < 0.4) | Medium | High | Revise rubric based on disagreements; drop ambiguous items; document as V1 limitation |
| Cloudflare Workers timeout on long batches | Low | Medium | Chunk batches into smaller subjobs |
| Anthropic API outage | Low | High | Retry logic; resume from last successful artifact; alert ops |
| Database migration fails in production | Low | High | Test migrations on staging copy first; have rollback plan |
| Monday deadline is unrealistic | Medium | Low | Some epics will slip to Tuesday; document what's shipped vs deferred |
| LLM judge agreement collapses on production data (different from calibration) | Medium | Medium | Drift detection alert; escalate to manual review; document |

---

## Versioning

This is **HEAR Roadmap v1.0**. Updates as work progresses.
