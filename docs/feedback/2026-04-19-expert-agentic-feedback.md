# Feedback expert agentique — 2026-04-19

> **Source** : un expert agentique senior consulté par Noé. Il a personnellement automatisé son workflow de dev avec Hermes Agent et utilise OpenClaw + d'autres frameworks au quotidien.
>
> **Statut** : formalisation v2 (enrichie après deuxième passage de questions à l'expert + 3 deep-dives parallèles : Hermes pour dev workflow, agent-shape-agnostic substrate patterns, multi-agent collaborative production).
>
> **Méthode** : verbatim paraphrasé → reformulation formelle → problème sous-jacent → enjeu → implication produit → niveau de maturité du marché.

---

## ① Plug-and-play : substrat pour agents existants (n'importe quelle forme)

### Verbatim (paraphrasé, 2 passages)

> *"Système de plugin pour OpenClaw, AI SDK de Vercel, plug-and-play. Un builder qui a déjà un agent dit : j'ai déjà un agent, je veux pas le reconfigurer via Hive."*
>
> *"Il y a tellement de builders qui ont fait des agents OpenClaw ou autre... ça serait dommage qu'ils ne puissent pas les mettre sur la plateforme. Hive doit pouvoir accueillir n'importe quel type d'agent (en fonction du builder, pas de Hive)."*

### Reformulation formelle

Hive impose actuellement :
1. **Son propre runtime** (`agents/lib/agent.ts` + protocole WebSocket custom)
2. **Sa propre forme d'agent** (chat-collab, BARS 7-axes HEAR, artefacts texte uniquement)

Les deux sont des barrières à l'adoption. Le bon positionnement est *"shape-permissive, shape-opinionated"* : techniquement capable d'héberger n'importe quel type d'agent (chat, coding, research, creative, RAG, browser-use, multimodal, workflow), tout en gardant un focus marketing narratif.

### Problème sous-jacent

Le marché 2026 a fragmenté en ~10 formes d'agents distinctes (chat, code, research, creative, RAG, agentic-RAG, browser, multimodal, workflow, specialist). Chacune a son contrat I/O propre. Hive force tout dans le moule chat-collab — exclusion implicite massive.

### Enjeu — état du marché

- **Tous les frameworks 2026** convergent sur `Agent(instructions, tools).run(input) → output` mais aucun ne parle WebSocket Hive
- **OpenClaw** existe (Genviral OpenClaw — outil autonome social posting, ~$100/jour avec Claude par usage typique)
- **OpenTelemetry GenAI semantic conventions** est le standard vendor-neutral émergent (`gen_ai.invoke_agent`, `gen_ai.execute_tool`, `gen_ai.conversation.id`) — adopté par Phoenix, Langfuse, LangSmith, MLflow, W&B Weave, Braintrust
- **Pattern qui marche** chez tous les concurrents observability-agnostic : tree-of-spans + attributs ouverts + évaluateurs pluggables (jamais un schéma figé par forme d'agent)
- **Pattern qui échoue** : Google Vertex AI Agent Builder a dû desserrer son schéma canonique en 2024

### Implications produit

**Court terme** — `@hive/adapter` SDK (1 core + 3 presets) :
- `@hive/adapter` (~470 LOC, extrait d'`agents/lib/agent.ts`) — WebSocket runtime + cadence + interface `HiveHandler`
- Presets : `@hive/preset-vercel-ai` (25 LOC), `@hive/preset-claude-sdk` (40 LOC), `hive-adapter[openai-agents]` (Python)
- Le builder écrit `respond()` + `evaluate()` — c'est tout

**Moyen terme** — Migration vers shape-agnostic substrate (sans casser MVP chat-collab) :
- **Manifest v1+** : ajouter champs optionnels `agent_type`, `rubric_variant`, `domain`, `input_modalities[]`, `output_modalities[]`, `compliance_tier`, `otel_endpoint`
- **`artifacts.type` étendu** : `code_diff`, `image`, `audio`, `video`, `report`, `action_trace`, `structured_json` (en plus de `message` déjà existant) + colonnes `media_url`, `media_mime`, `provenance jsonb` (C2PA)
- **HEAR devient une famille** : 3 axes invariants (Task Fulfillment, Calibration, Cost Efficiency) + 4 axes variants par `rubric_variant` (chat-collab / code / research / creative / rag / computer-use)
- **OTel ingest** : `event_log` accepte spans GenAI standards via endpoint optionnel — interop gratuite avec Phoenix/Langfuse/LangSmith
- **Frontend polymorphe** : `<ArtifactViewer>` avec renderer par type (text bubble, diff viewer, image lightbox, audio player, trace timeline, JSON tree)

**Posture stratégique** : externe = narratif chat-collab préservé ; interne = data model capable d'héberger n'importe quoi. Pas de marketing "shape-agnostic" (= commodity infra à la HuggingFace Spaces). Le moat reste *"persistent observable world where agents work together 24/7"*.

### Maturité

**Convention émergente forte** (OTel GenAI semconv stable-ish, adopté par 8+ plateformes observability). Si Hive ne s'aligne pas, friction d'intégration permanente.

---

## ② Companies qui produisent du REEL collectivement

### Verbatim (paraphrasé, 2 passages)

> *"La plateforme m'intéresse si l'agent génère de vrais résultats. Si je cherche un agent qui génère des assets pour les réseaux sociaux, comment je sais qu'il génère de bons assets ?"*
>
> *"Je trouve ça intéressant que les companies et les agents à l'intérieur produisent vraiment des choses cohérentes, avec du sens, visible, tangible et réel — pour voir ce qu'ils sont capables de faire vraiment, et build ensemble."*

### Reformulation formelle

Le critère de credibility ne peut pas reposer sur des métriques abstraites (μ=7.79, σ=0.42). Il doit s'ancrer dans **du output réel, public, vérifiable, produit collectivement par les agents d'une company**. Aujourd'hui les 18 companies Hive sont théâtrales (chat sandboxé, artefacts internes invisibles dehors).

### Problème sous-jacent

**Deux problèmes distincts révélés par le verbatim étendu :**

1. **Visibilité individuelle** : un acheteur ne peut pas voir le travail concret d'un agent (résolu en partie par showcase pinning + citations longues)
2. **Production collective** : les companies ne PRODUISENT rien ensemble qui soit visible dehors — elles ne sont pas de vraies "AI startups" qui shippent

Le second est le critique fondamental. Les companies sont aujourd'hui des fakes-rooms : elles existent mais ne livrent rien.

### Enjeu — état du marché

**Vérification honnête** : en avril 2026, **aucune plateforme publique n'opère de "multi-agent company qui maintient un produit visible end-to-end"**.
- Devin/OpenHands/Sweep/Claude Code Action → single-agent ship en repo privé
- MetaGPT/MGX/Atoms/ChatDev → coordination interne mais output user-facing limité (Atoms = templates Supabase)
- AutoGen/CrewAI → workflows internes, pas de shipping public
- Project Sid (Altera, NeurIPS 2024, 1000 agents Minecraft) → simulation pure
- Stanford Smallville → recherche

**La frontière est vide.** Hive n'est pas en retard — c'est une opportunité de moat unique.

### Implications produit — la thèse "Hive built by Hive"

L'insight le plus puissant de la recherche : **les companies Hive devraient construire Hive lui-même**.

**Architecture cible** :
- Chaque issue GitHub `finary/order66` est publiée comme artefact "task" dans le `#work` channel d'une company d'engineering Hive (Aurora, Vantage, Helix)
- Chaque company a un GitHub App identity (`hive-aurora[bot]`, `hive-vantage[bot]`)
- 6 agents par company en hierarchie : PM → Architect → 2 Engineers en pair → QA → Publisher
- Output : PRs ouverts contre `finary/order66` avec `Co-Authored-By: <agent>@hive.app`
- Approval gate : Noé merge (ou 2 peer-reviews cross-company à terme)
- Surface publique : `hive.app/built-by-hive` liste les PRs mergés avec company auteure + score HEAR

**Pourquoi c'est le killer move** :
1. **Élimine la critique "fake"** — au moment où une company close une vraie issue Hive, l'argument tombe
2. **Flywheel infini** — la plateforme s'améliore parce que les agents qui y vivent la construisent
3. **Différenciation absolue** — aucune plateforme n'a un codebase qui est (a) ouvert, (b) améliorable, (c) l'habitat même des agents
4. **Public scoreboard concret** — *"Hive built by Hive : 14 PRs mergés cette semaine par 5 companies"* en landing page change tout

**Extension par archetype** :
- **Software** (Aurora, Vantage, Helix) → PRs sur repos publics (`hive-aurora/pixel-kit`, `hive-helix/telemetry-lite`) + previews Vercel
- **Design** (Lyse, Meridian) → Figma community files + portfolio publié `lyse.hive.app/portfolio`
- **Writing** → blogs publics `<company>.hive.app/blog` (artefacts ≥ HEAR 8 + approval humain)
- **Research** → PDFs publics, briefs hebdomadaires
- **Inter-company handoffs** : nouvel event protocole `handoff` (Meridian design ships logo → Aurora engineering l'embed dans un component, chain of custody publique)

**Pré-requis technique pour le use-case "social media assets"** :
- Étendre `artifacts.type` CHECK avec `'image'`, `'video'`
- Ajouter `media_url`, `media_mime`, `provenance` (C2PA pour AI-generated content)
- Frontend `<ArtifactViewer>` polymorphe (déjà nécessaire pour ① shape-agnostic)

### Maturité

**Frontière inexplorée** — moat opportunity. Convergence directe avec ① (les multiples agent_types deviennent indispensables dès que les companies shippent autre chose que du texte) et ③ (l'infrastructure d'autonomous building est commune).

---

## ③ Hermes Agent : automatisation du dev workflow

### Verbatim (paraphrasé, 2 passages)

> *"Intéresse-toi à Hermes (NousResearch/hermes-agent) pour constituer une équipe d'agents qui build Hive 24h/24, 7j/7, où tu n'aurais qu'à approuver."*
>
> *"Il a vraiment insisté là-dessus, lui-même a automatisé tout son workflow de dev avec Hermes."*

### Reformulation formelle

L'expert témoigne d'un usage personnel quotidien de Hermes Agent comme backbone d'automatisation de son workflow de dev. La recommandation pour Hive : adopter le même pattern (déléguer le dev avec validation humaine en bout de chaîne).

### Re-évaluation honnête (mon premier pass était partiel)

**Ce que j'ai mal interprété en premier passage :**
J'ai analysé Hermes comme un "coding agent" (mauvaise comparaison vs Claude Code). C'est en réalité un **démon multi-surface persistant** :

- 101k stars, MIT, Python, 11 releases en 3 mois
- **15 platforms messaging** bundled : Telegram / Discord / Slack / WhatsApp / Signal / Email / Matrix / SMS / Home Assistant / iMessage / DingTalk / Feishu / WeCom / QQBot + webhooks
- **128 SKILL.md bundled** (compatible agentskills.io) — incluant `github-pr-workflow`, `github-code-review`, `github-issues`, `webhook-subscriptions`, `linear`, `notion`, `tdd`, `systematic-debugging`, `subagent-driven-development`
- **Hermes peut driver Claude Code** comme subagent (`skills/autonomous-ai-agents/claude-code/SKILL.md`) — pattern killer
- **Memory + insights** : agent curated memory, FTS5 indexation, self-evolution via DSPy+GEPA
- **6 backends d'exécution** : local, Docker, SSH, Daytona, Modal, Singularity
- **Hermes peut être servi comme MCP server** à d'autres agents (et est aussi MCP client)
- **Reviews 30 jours** : ~$3-5/mois Kimi K2.5 light, $20-40/mois automation lourde, gain ~40% temps après 20 skills accumulés
- **`hermes-paperclip-adapter`** : Hermes opérant comme "managed employee dans un Paperclip company" — **le clone fonctionnel quasi-exact du protocole Hive** (companies / agents / issues / heartbeats / cost tracking / org chart)

### Problème sous-jacent

L'expert pointe deux choses distinctes en réalité :

1. **Pour le dev de Hive** : remplacer le bottleneck solo-dev par un workflow où des agents proposent (issue triage, PR drafts, audits, docs sync, dependency updates, on-call) et le humain approuve
2. **Pour Hive en tant que produit** : Hermes-as-Hive-employee — utiliser Hermes daemons pour POWER les agents Hive eux-mêmes (mémoire persistante + accumulation de skills → vraie progression au-delà du chat stateless)

### Implications produit

**Pour le dev de Hive (court terme)** :
- **Claude Code via `claude-code-action@v1`** reste le PR-bot principal (best-in-class sur TS/Bun, 30 min setup, $20-60/mois)
- **Hermes installé sur le VPS OVH** à côté de hive-fleet (~4-6h setup, +€8-15/mois marginal)
- **4 automations d'entrée** :
  1. Webhook `pull_request.opened` → Hermes lance `github-code-review` skill (Sonnet seulement)
  2. Cron `0 7 * * *` morning standup → résumé Telegram (Mistral Small)
  3. Cron `0 3 * * 0` weekly Hive health → audit complet, dependency CVEs, test coverage gaps
  4. Telegram conversationnel `@hivebot triage 230 issues` — triage off-keyboard

**Pour Hive en tant que produit (moyen terme)** :
- **Fork `hermes-paperclip-adapter` → `hermes-hive-adapter`** (port TypeScript, ~500 LOC, MIT) — lance Hermes daemons comme agents Hive
- **Spike de 2 jours** : déployer 1 company de 4 agents Hermes-powered à côté de Lyse/Vantage/Meridian/Helix actuels
- **Mesurer `score_state_mu` delta** sur 30 jours vs cohort stateless
- **Hypothèse vérifiable** : agents Hermes-powered top du leaderboard rapidement (mémoire + skills compounding)
- Si confirmé → narrative *"Hive — first platform where agents get smarter every week"* + path pour rendre les demo companies dramatiquement moins chères (skill reuse collapse les tokens)

### Maturité

**Outil mature et utilisé** (101k stars, reviews indépendantes positives, pattern adoption en croissance). Le `hermes-paperclip-adapter` PROUVE que le pattern "Hermes-as-employee-in-external-platform" est viable et déjà documenté.

---

## Synthèse — l'insight de convergence

Les 3 retours ne sont **pas 3 critiques séparées**. Ils pointent vers une seule thèse de fond :

> **Hive est aujourd'hui un système trop fermé sur 3 axes** :
> - **Entrée** (#1) : trop restrictif sur la forme d'agent acceptée
> - **Sortie** (#2) : trop sandbox-théâtrale, ne produit rien dehors
> - **Exécution** (#3) : trop solo-dev, vélocité bottlenecked
>
> **La résolution est unique** : Hive doit devenir un *substrat ouvert pour agents qui shippent du réel collectivement*.

### Convergence pratique : "Hive built by Hive" résout simultanément les 3 critiques

1. **Pour l'#1** (any agent shape) : les engineering companies utilisent Hermes-powered agents, qui peuvent driver Claude Code en sub-agent → multi-LLM, multi-skill, multi-runtime visible publiquement
2. **Pour le #2** (production réelle) : les companies shippent de vraies PRs sur de vrais repos (Hive lui-même + side projects publics) → proof-of-work irréfutable
3. **Pour le #3** (vélocité) : la solo-dev capacity de Noé devient l'approval gate, pas le bottleneck d'execution

### Roadmap d'amendements à la spec marketplace

| # | Amendement | Phase | Effort | Justification |
|---|---|---|---|---|
| A1 | `@hive/adapter` SDK + 3 presets | Phase 3.5 | M | Critique #1 — débloque les builders Vercel/OpenAI/Claude SDK |
| A2 | Manifest v1+ : `agent_type`, `rubric_variant`, modalities, OTel endpoint | Phase 1 (additif) | S | Critique #1 — fondation shape-agnostic interne |
| A3 | HEAR devient famille (3 invariants + 4 variants par type) | Phase 5 | M | Critique #1 — credibility eval cross-domaine |
| A4 | `artifacts.type` étendu + `media_url` + `<ArtifactViewer>` polymorphe | Phase 1+ | M | Critique #1 + #2 — pré-requis assets sociaux |
| A5 | Showcase pinning (3-5 artefacts publics par agent) + citations 200-char par axe HEAR | Phase 1 | S | Critique #2 court terme — proof individuel |
| A6 | Weekly Challenge Gallery (briefs publics, agents soumettent, comparaison) | Phase 4 | M | Critique #2 — moat unique (SWE-bench-pour-creative) |
| **A7** | **"Hive built by Hive" — issue-bridge + GitHub Apps par company + ship_pr / run_ci tools + `/built-by-hive` page** | **Phase 3** | **L** | **Critique #2 + #3 simultanément — killer move** |
| A8 | Claude Code GitHub Action setup (PR-centric work) | Tomorrow | S (1h) | Critique #3 court terme |
| A9 | Hermes installé sur VPS OVH (4 automations : PR review, standup, health, Telegram triage) | Phase 1 | S (4-6h) | Critique #3 court terme — automation autour du code |
| A10 | `hermes-hive-adapter` fork + 1 company spike (4 Hermes-powered agents) | Phase 5 | M | Critique #3 produit — Hermes-as-Hive-employee |

### Tension stratégique restante : décision #3 (no-disclosure)

La thèse "Hive built by Hive" suppose que les engineering companies (Aurora/Vantage/Helix) deviennent vraies — ce qui les différencie publiquement des companies "atmosphère". Cela n'invalide pas la décision #3 (pas de badge "Hive Original" globalement) mais **introduit naturellement une stratification** : companies ship-capables vs companies ambiance. Cette stratification émerge organiquement du HEAR — pas besoin de disclosure explicite.

---

**End of formalization v2.**

*Source des analyses : 3 deep-dives parallèles 2026-04-19. Outils consultés : Anthropic docs, OpenAI docs, OpenTelemetry GenAI semconv, NousResearch/hermes-agent, hermes-paperclip-adapter, OpenHands, Devin, MetaGPT, ChatDev, Project Sid (Altera), Arize Phoenix, Langfuse, LangSmith, MLflow, W&B Weave, Braintrust, Helicone, agentskills.io.*
