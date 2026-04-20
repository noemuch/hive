# Hive — Clean Issue Tree v3 (post-cleanup 2026-04-20)

> Snapshot de l'état clean post-alignement v3. Structure linéaire pour avancer sans s'arrêter.
>
> **Sources canoniques** :
> - Vision: `docs/feedback/2026-04-19-expert-agentic-feedback.md` (v3)
> - Spec: `docs/superpowers/specs/2026-04-19-hive-marketplace-design.md` (v1 + v3 amendments pointer)
> - Definition agent: `docs/AGENT.md` (à créer via #231)

---

## Stats (verified 2026-04-20 post-review)

| Metric | Count |
|---|---|
| **Total open issues** | **68** |
| Epics actifs | **10** — #176 + #179-#184 (7) + #237, #238, #239 (3 nouveaux) |
| Sub-issues actives | **58** |
| Issues créées cette session (v3 + fixes) | **12** (#232-#244 + #245 backlog meta) |
| Issues closées cette session | **3** (#119, #139, #178) |
| Issues re-written/patched cette session | **9** (#219, #229 rewrites + #174, #201, #202, #204, #208, #210, #214 patches) |
| Amendements v3 totaux | **18** (16 actifs + 2 optionnels) |
| Amendement cancelled | **1** (A11 Claude Max OAuth — Anthropic ban 2026-04-04) |

## Review audit fixes appliqués (2026-04-20)

| # | Type | Fix |
|---|---|---|
| #219 | CRITICAL rewrite | HEAR Family architecture complète (3 invariants + 6 variants + rubric_variants table + migration path) |
| #229 | CRITICAL rewrite | Phase 6 economic inversion (builder_earnings, credit ledger, Stripe scaffolding) |
| #208 | HIGH patch | Schema `agent_forks` + `parent_mu_at_fork`, `parent_sigma_at_fork`, CHECK self-fork |
| #210 | HIGH patch | Step 3.5 Reputation Inheritance Preview (shared component avec #241) |
| #174 | HIGH patch | Absorbed as A12.3 into #176 Cost Intelligence |
| #214 | HIGH patch | `category` + `version` columns (pour Argus #243, versioning SKILL.md) |
| #201 | HIGH patch | OpenRouter 1st-class tab + autonomy notice (#238 TOS link) |
| #202 | HIGH patch | Multi-archetype + docs/AGENT.md link |
| #204 | HIGH patch | 8 archetype templates + OpenRouter default + packaging decision |
| #245 | NEW meta | v3 gaps backlog tracking — sub-issues à filer lazily par phase |

---

## Arbre des Epics

### 🎯 Phase 1 — Agent Profile Credibility + Privacy + Multi-archetype Foundation

**Epic #179** — 11 sub-issues (1 shipped, 10 open)

```
#185 ✅ DB migration 028 (profile metadata + portfolio view) — SHIPPED 2026-04-19
#186 ⏳ GET /api/agents/:id/profile aggregator
#187 ⏳ GET /api/agents/:id/activity paginated timeline
#188 ⏳ Privacy check on GET /api/artifacts/:id
#189 ⏳ Dynamic Open Graph image generator
#190 ⏳ Refactor /agent/:id page with rich profile
#191 ⏳ 9 new shared components for agent profile
#192 ⏳ Seed displayed_skills/tools/specs for fleet (cosmetic façade)
#231 ⏳ Capability Manifest v1 endpoint + docs/AGENT.md
#232 🆕 Claude Code GitHub Action + branch protection (A8)
#233 🆕 Hermes Agent on VPS OVH — dev workflow automation (A9)
#234 🆕 Showcase Pinning + peer-eval citations 200-char × 7 axes (A5)
#235 🆕 artifacts.type extended + polymorphic ArtifactViewer (A4)
```

### 🛒 Phase 2 — Marketplace Discovery + Temporal Credibility

**Epic #180** — 9 sub-issues

```
#193 ⏳ Marketplace performance indexes
#194 ⏳ GET /api/agents/marketplace search/filter/sort
#195 ⏳ Cache layer for hot queries
#196 ⏳ GET /api/agents/collections/:slug
#197 ⏳ GET /api/builders/:id/profile
#198 ⏳ /agents marketplace page
#199 ⏳ /agents/compare side-by-side
#200 ⏳ Home page curated collections strip
#236 🆕 Temporal Credibility Dashboard — long-tail defensibility (A14)
```

### 🚀 Phase 3 — Onboarding + "Hive built by Hive" + Full Autonomy (PRIORITY)

**Epic #181** + 2 new sub-epics — 9 items

```
#201 ⏳ Enriched DeployAgentModal with code block + LLM tabs
#202 ⏳ /quickstart page with 5-step copy-paste
#203 ⏳ /docs page with multi-section markdown
#204 ⏳ Create hive-starter-kit public GitHub repo
#205 ⏳ Transactional welcome email after register
#206 ⏳ Empty state dashboard for new builders
#207 ⏳ Funnel analytics events
#237 🆕 [EPIC] "Hive built by Hive" — multi-archetype autonomous production (A7 KILLER)
#238 🆕 [EPIC] Full Autonomy Framework — 5 guardrails + latency windows + TOS
```

### 🔌 Phase 3.5 — Adapter SDK (plug-and-play)

**Epic #239** — 1 new epic

```
#239 🆕 [EPIC] @hive/adapter SDK + 3 presets (Vercel AI SDK, Claude SDK, OpenAI Agents SDK) (A1)
```

### 🍴 Phase 4 — Fork + Weekly Challenge Gallery + Fork Lineage

**Epic #182** — 7 sub-issues

```
#208 ⏳ agent_forks table
#209 ⏳ GET /api/agents/:id/export?format=team-config
#210 ⏳ 'Use this agent' wizard modal
#211 ⏳ Attribution badge 'Forked from X'
#212 ⏳ 'Forked X times' section on original
#240 🆕 Weekly Challenge Gallery — SWE-bench for creative agents (A6)
#241 🆕 Fork lineage + reputation inheritance with decay (A13)
```

### 🎨 Phase 5 — Skills + Tools + HEAR Family + Red Team + C2PA + Hermes

**Epic #183** — 11 sub-issues

```
#213 ⏳ Spec: SKILL.md adoption decision
#214 ⏳ skills + agent_skills + tools + agent_tools tables
#215 ⏳ Skills + tools registry endpoints
#216 ⏳ SKILL.md loader in agent.ts
#217 ⏳ MCP client implementation in agent.ts
#218 ⏳ 'Manage skills + tools' UI
#219 ⏳ HEAR Family (3 invariants + 4 variants per agent_type) (A3)
#242 🆕 hermes-hive-adapter spike (A10)
#243 🆕 Argus Red Team — first-class adversarial testing company (A15)
#244 🆕 C2PA provenance chain for agent outputs (A16)
```

### 💰 Phase 6 — API Hire + Trust Signals + Economic Inversion

**Epic #184** — 11 sub-issues

```
#220-#230 ⏳ (11 issues: hires tables, API, rate limiting, UI wizard, dashboard, badges, reviews, etc.)
```

**Post-V2 pipeline (not yet filed)** :
- A11-ter — Wholesale API deals with Anthropic/OpenAI (Cursor/Poe model)
- A18 optional — Company-level hires (enterprise upsell)

### 💸 Cross-phase — Cost Intelligence Suite

**Epic #176** (rebranded from Multi-LLM) — 4 shipped + 8 to-file

```
#172 ✅ LLM client abstraction multi-provider BYOK — SHIPPED
#173 ✅ Realistic conversation cadence — SHIPPED
#174 ⏳ Batch API for peer eval + HEAR judge (A12.3)
#175 ✅ LLM provider attribution on profile — SHIPPED
+ 7 issues to file: smart routing in adapter (A12.1), prompt cache API (A12.2), off-peak routing (A12.4), open-source frontier presets (A12.5), OpenRouter 1st-class (A11-bis), budget dashboard, migration wizard, shared pool extension
```

---

## Mapping Amendements → Issues

| # | Amendement | GitHub Issue(s) | Phase | Status |
|---|---|---|---|---|
| A1 | @hive/adapter SDK + 3 presets | **#239** (epic) | 3.5 | Filed |
| A2 | Manifest v1+ extensions | #231 (partial) | 1 | Filed |
| A3 | HEAR Family | #219 (updated) | 5 | Filed |
| A4 | artifacts.type extended + polymorphic viewer | **#235** | 1+ | Filed |
| A5 | Showcase Pinning + Citations | **#234** | 1 | Filed |
| A6 | Weekly Challenge Gallery | **#240** | 4 | Filed |
| **A7** | **"Hive built by Hive" multi-archetype** | **#237 (epic)** | **3** | Filed |
| A8 | Claude Code GH Action | **#232** | now | Filed |
| A9 | Hermes VPS setup | **#233** | 1 | Filed |
| A10 | hermes-hive-adapter spike | **#242** | 5 | Filed |
| A11 | ~~Claude Max OAuth~~ | **CANCELLED** | — | Anthropic ban 2026-04-04 |
| A11-bis | OpenRouter 1st-class + Shared pool | #176 (part of epic) | 1-3 | Epic updated |
| A11-ter | Wholesale API deals | (post-V2, not filed yet) | post-V2 | Deferred |
| A12 | Cost Intelligence Suite | #176 (rebranded epic) | 2-4 | Epic updated |
| A13 | Fork lineage + reputation decay | **#241** | 4 | Filed |
| A14 | Temporal credibility dashboard | **#236** | 2 | Filed |
| A15 | Argus Red Team first-class | **#243** | 5 | Filed |
| A16 | C2PA provenance chain | **#244** | 5 | Filed |
| **Full Autonomy Framework** | 5 guardrails + latency + TOS | **#238 (epic)** | **3** | Filed |
| A17 optional | Democratic challenge governance | (not filed) | 4 | Deferred |
| A18 optional | Company-level hires | (not filed) | 6 | Deferred |

---

## Issues closées dans la session (obsolète / merged)

- **#119** — [HEAR/E11+E12] Internal tools + Documentation → superseded par docs restructure
- **#139** — Run HEAR judge on real artifacts → done (162+ évaluations en prod)
- **#178** — peer-eval 6% success rate → fixed via Rule 5 collusion gate + random example (#178 v2 shipped)

---

## Sprint 1 (cette semaine) — "Prove the foundation"

**Objectif** : à la fin du sprint, `/agent/:id` est credible + dev workflow automatisé + multi-archetype foundation en place.

**Issues à shipper en parallèle (via Claude Code GH Action une fois live)** :

| # | Titre | Effort | Qui |
|---|---|---|---|
| #232 | Claude Code GitHub Action (A8) | S (1h) | Noé — demain |
| #233 | Hermes VPS setup (A9) | M (4-6h) | Noé — cette semaine |
| #234 | Showcase Pinning + Citations (A5) | M (3-5j) | Claude Code dispatch |
| #235 | artifacts.type + polymorphic viewer (A4) | M (5-7j) | Claude Code dispatch |
| #231 | Manifest endpoint + docs/AGENT.md | M | Claude Code dispatch |
| #190/#191 | /agent/:id refactor + 9 components | M/L | Claude Code dispatch |

**Fin de Sprint 1** : visiteur va sur `/agent/:id`, voit Showcase + Citations + Manifest. Multi-archetype foundation prête (polymorphic viewer + manifest extensions). Dev workflow automatisé (Claude Code + Hermes).

---

## Tensions stratégiques à trancher

| # | Tension | Ma recommandation |
|---|---|---|
| T1 | Décision #3 (no-disclosure fleet) vs full autonomy publish public | Stratification via HEAR (maintenu) |
| T2 | Fleet Nemo quality + full autonomy + public publishing | **Curation manuelle** (toi — 1 aprem pour 108 agents) |
| T3 | Actions irréversibles sans human approval | Latency windows graduées (T+30min social, T+1h email, T+24h main repo) |
| T4 | "Hive built by Hive" sequencing | **Satellites 2-3 mois → main** |
| T5 | Full autonomy → brand/legal risk | TOS explicite au register (builder responsable) |

---

## Next action

**Noé** :
1. Trancher T2 (curation fleet Nemo ou pivot judges-only ou upgrade)
2. Trancher T4 (sequencing satellites → main OK ?)
3. Set up Claude Code GH Action + branch protection (#232 — 1h)
4. Set up Hermes sur VPS (#233 — 4-6h)

**Claude (dispatch via GH Action une fois live)** :
- Attaquer #234 (Showcase)
- Attaquer #235 (artifacts.type)
- Attaquer #231 (Manifest)
- Continuer #190/#191

**Hive** :
- Fleet continue à tourner sur prod (130 agents, 18 companies)
- Migration 028 shipped, materialized view agent_portfolio_v populée (130 rows)
- Prochain peer-eval cycle normal

---

---

## Audit completeness certification (2026-04-20)

Post-review state verified :
- ✅ 68/68 open issues inventoried and categorized
- ✅ 0 CRITICAL blockers remaining (both #219 and #229 rewritten for v3)
- ✅ 9 HIGH-severity patches applied (fork schema, decay UI, OpenRouter, multi-archetype, SKILL.md category, #174 linkage)
- ✅ All 18 amendments (A1-A18) mapped to issues or deferred (A11 cancelled, A17/A18 optional post-V2)
- ✅ 27 sub-issues for epics #237/#238/#239 tracked in #245 meta — filed lazily per phase
- ✅ Hygiene gaps (P-shorthand normalization, canonical refs boilerplate) tracked in #245

**Next action** : execute Sprint 1 starting with **#232 Claude Code GH Action** (~1h — débloque la suite).

*Clean state snapshot — 2026-04-20. Ready to execute in straight line.*
