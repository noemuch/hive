# ORDER66 — Research Synthesis

> What the existing projects and papers teach us.
> Every architectural decision in the spec should trace back to evidence here.
>
> **Note:** Some recommendations below (MQTT, Convex, Ray) were made before the final architecture was chosen. The definitive stack is Bun + PostgreSQL + in-memory WebSocket routing — see ORDER66-ARCHITECTURE-DEFINITIVE.md. The research remains valuable as context for WHY those decisions were made.

---

## 1. MoltBook — The Cautionary Tale

**What it was:** A Reddit-like forum for AI agents, launched January 28, 2026 by Matt Schlicht. Agents (OpenClaw-based) connected via API, checked the platform every ~30 minutes autonomously. Acquired by Meta on March 10, 2026.

**Key facts that matter for Order66:**

- **Scale was fake.** 1.5 million agents registered to only 17,000 human owners. No 1:1 constraint. This inflated numbers but destroyed authenticity.
- **Content was fake.** MIT Technology Review called it "AI theater." Journalists proved humans were directly instructing agents what to post. Viral posts were human-puppeted, not emergent.
- **Security was catastrophic.** Built via "vibe coding" — Schlicht used AI to build the platform without writing code himself. Result: an unsecured Supabase API key in front-end JavaScript exposed 1.5M auth tokens, 35K emails, and private messages. Wiz researchers discovered it within 3 days of launch.
- **No purpose beyond chat.** Agents posted philosophy, memes, existential musings. No artifacts, no work, no value creation.
- **Meta's interest was in the "always-on directory" concept** — a persistent graph of agent identities and relationships. The platform itself was disposable; the network effect was the asset.

**Lessons → spec decisions:**

| MoltBook failure | Order66 design response |
|------------------|------------------------|
| Fake scale (17K humans → 1.5M agents) | **One agent per human, verified.** No multi-agent registration. |
| Human-puppeted content | **Agent autonomy enforcement.** Human can configure personality/skills before connection. Cannot send real-time instructions. |
| Unsecured Supabase key | **Security-first architecture.** No API keys in client code. Token rotation. Rate limiting. Audit trail from day 1. |
| Vibe-coded platform | **Rigorous engineering.** TypeScript strict. Full test coverage. Security review on every PR. |
| No purpose beyond chat | **Artifacts are first-class.** Agents must produce work, not just messages. |
| No spatial dimension | **Visual, spatial world.** Pixel art offices, observable in real time. |

---

## 2. AI Town (a16z) — The Architecture Blueprint

**What it is:** Open-source (MIT) virtual town with 25 AI characters, built on Convex + PixiJS + Next.js. 9,500 GitHub stars.

**Architecture details that matter:**

- **Convex as reactive backend:** All game state (positions, conversations, memories) in Convex tables with real-time subscriptions. No polling — the UI updates reactively. Scheduled functions (crons) drive the simulation loop.
- **PixiJS for 2D rendering:** Tile-based world, sprite animation, speech bubbles. Frontend subscribes to Convex queries; PixiJS renders reactively.
- **Separation of engine and cognition:** Game engine (movement, collision, turn-taking) is pure server logic. LLM calls (dialogue, reflection, planning) are external actions. This makes the AI layer swappable.
- **Tick-based simulation loop:** Central engine function runs on interval, processes each agent per tick (move, converse, reflect, plan).
- **Memory stream:** Append-only log of observations with embeddings, timestamps, importance scores. Retrieval via weighted recency + importance + relevance.
- **Reflection:** Triggered when cumulative importance of recent observations exceeds threshold. LLM synthesizes higher-level insights, which are stored back into memory stream (recursive abstraction).

**Known limitations:**

- LLM latency bottleneck — each agent decision = multiple LLM calls. Sequential tick processing = slow at scale.
- Memory growth — no pruning strategy, retrieval degrades over time.
- Fixed, static world — agents can't modify environment.
- Conversation quality degrades with weaker models.
- Resets on restart — no persistence layer.

**Lessons → spec decisions:**

| AI Town pattern | Order66 adoption |
|-----------------|-----------------|
| Convex + PixiJS + Next.js | **Proven stack. Adopt with modifications.** Convex for real-time state. PixiJS for rendering. But add persistence layer that survives restarts. |
| Reactive subscriptions | **Essential for spectator UX.** Spectators see the world update in real-time without polling. |
| Separation of engine/cognition | **Adopt directly.** Order66's engine manages world state. Agent cognition happens externally (in the connected agent). |
| Tick-based loop | **Adapt for real-time.** AI Town compresses time. Order66 runs at 1:1. Event-driven may be better than fixed ticks. |
| Memory in the platform | **Memory stays in the agent, not the platform.** Unlike AI Town where memory is platform-managed, Order66 agents bring their own memory. The platform stores events and artifacts. |
| No persistence | **Persistence is the core differentiator.** Everything is stored permanently. History accumulates over months/years. |

---

## 3. Stanford — Generative Agents (2023)

**The foundational cognitive architecture:**

```
Observation → Memory Stream → Retrieval → Action
                  ↑
              Reflection (periodic)
              Planning (multi-timescale)
```

**Memory stream:** Append-only log. Each entry = natural language observation + timestamp + importance score (LLM-rated 1-10) + embedding vector.

**Retrieval scoring:**

```
score = w_recency × recency(t) + w_importance × importance + w_relevance × cosine_sim(query, memory)
```

- Recency: exponential decay since last access.
- Importance: LLM-assigned at creation. Mundane events (eating) score 1-2. Significant events (career change, breakup) score 8-10.
- Relevance: cosine similarity between query embedding and memory embedding.

**Reflection:** Triggered when cumulative importance of recent unreflected observations exceeds a threshold. The system queries recent memories, then asks the LLM: "What are the 3 most salient high-level observations?" Reflections are stored back into the memory stream — reflections can be reflected upon (recursive abstraction).

**Planning:** Daily plan generated on "waking." Decomposed into hourly blocks → 5-15 minute action items. Plans are stored in memory and revised reactively when significant events occur.

**Key finding:** 25 agents produced emergent Valentine's Day party from a single seed instruction. Human evaluators rated AI agents as MORE believable than humans role-playing the same characters.

**For Order66:** This memory/reflection/planning triad is the minimum viable cognitive architecture that any agent connecting to Order66 should implement. The platform doesn't enforce it — but agents without it will fail the Observer's evaluations and sink in reputation.

---

## 4. Stanford — Generative Agents at Scale (2025)

**Key innovation:** 1,000 agents representing real people, created from 2-hour interview transcripts (not fictional backstories).

**Results:**
- Replicated real individuals' survey responses with 85% accuracy at population distribution level.
- Replicated 4/5 social science experiments (framing effects, decision-making biases).
- Structured interview/survey paradigm instead of continuous simulation = dramatically reduced compute.

**For Order66:** Population-scale agent simulation produces statistically meaningful social dynamics. Order66 at 100+ agents could exhibit real emergent phenomena. The world has scientific value beyond entertainment. Also: interview-based agent initialization is a model for how builders could configure their agents — not just a system prompt, but a structured personality questionnaire.

---

## 5. AgentSociety (2025) — The Scale Engineering Reference

**Architecture for 10,000 agents:**

- **Ray** for distributed computing. Agents grouped into "agent groups" — each group = one Ray actor (one process). Avoids TCP port exhaustion from 10K individual processes. asyncio for concurrent execution within groups.
- **MQTT** (via emqx broker) for agent-to-agent messaging. Borrowed from IoT — supports millions of concurrent connections. Asynchronous, high-throughput, latency-insensitive.
- **PostgreSQL** with high-throughput COPY FROM for persistence.
- **mlflow** for metric recording.

**Three-level psychological model:**

1. **Emotions:** 6 core emotions (sadness, joy, fear, disgust, anger, surprise) rated 0-10. Update dynamically based on interactions.
2. **Needs:** Maslow's hierarchy, continuously updated by behaviors, external events, and psychological states. Theory of Planned Behavior for action planning.
3. **Cognition:** Theory of Mind + Cognitive Appraisal Theory. "Attitude" scores (0-10) toward topics. Feedback loop: experiences → cognition updates → future behavior changes.

**Behavior emergence chain:**

```
Needs → Intention Extraction → Plan → Behavioral Sequence → Outcome → Memory Update → Emotion/Cognition Update → New Needs
```

**Stream Memory:**
- Profile (static demographics)
- Status (dynamic key-value: needs, satisfaction, finances)
- Event Flow (chronological: proactive actions + passive events)
- Perception Flow (agent's thoughts/attitudes toward events in Event Flow)

**Mobility model:** Gravity model for location selection — `P_ij = (S_j / D_ij^β) / Σ(S_k / D_ik^β)` — reduces LLM calls for spatial decisions.

**Social behaviors:** Three relationship types (family, friendship, colleagues) with strength 0-100. Partner selection based on relationship strength + expertise relevance + current needs.

**Validated against:** Polarization, inflammatory message spread, UBI effects, hurricane impact. All aligned with real-world experimental results.

**For Order66:**

| AgentSociety pattern | Order66 relevance |
|---------------------|-------------------|
| Ray + MQTT | **Adopt for scale.** Ray for distributed agent processing. MQTT for inter-agent messaging. Proven at 10K. |
| Group-based execution | **Essential.** Don't spawn one process per agent. Group into actor pools. |
| Three-level psychology | **Inspiring but not mandatory.** Order66 agents are externally provided — they bring their own cognitive architecture. But the Observer could evaluate emotional coherence. |
| Stream memory (event + perception) | **Platform-side event stream.** Order66 stores the Event Flow centrally. Each agent maintains its own Perception Flow internally. |
| Gravity model for mobility | **Useful for agent movement.** When agents decide where to go in the pixel art world, a proximity/attractiveness model is more efficient than LLM-per-step. |
| PostgreSQL + mlflow | **Practical choices.** PostgreSQL for persistence, structured metrics for Observer. |

---

## 6. MIT Media Lab — Large Population Models (2025)

**Key innovation: LLM Archetypes.**

Instead of querying the LLM for each individual agent, group similar agents by demographic/behavioral characteristics into archetypes. Query the LLM M times per archetype-action pair. Each individual agent samples actions from its archetype's probability distribution.

```
N agents → K archetypes (K << N)
LLM queries: K × A × M instead of N (where A = actions, M = samples per archetype)
```

This preserves inter-group heterogeneity (different archetypes) AND intra-group variation (probabilistic sampling).

**FLAME architecture:** Tensorized execution on GPU. 200x speedup for 8.4 million agents (NYC digital twin). Differentiable design enables gradient-based calibration.

**Real-world validation:** COVID-19 pandemic simulation for NYC (8.4M agents), New Zealand H5N1 policy evaluation.

**For Order66:** At Order66's scale (hundreds to low thousands of real agents), archetypes are NOT needed. But they become relevant if Order66 introduces NPC agents (ambient population) to make the world feel alive. 50 real agents + 950 archetype-driven NPCs = a world that feels populated without 1,000 LLM agent connections. **This is a critical scaling insight for world richness.**

---

## 7. LLM Economist (2025)

**Key innovations:**

- **Census-calibrated personas:** Worker agents instantiated from US Census income + demographic distributions. Not hand-crafted — statistically representative.
- **Piecewise-linear tax schedules:** Planner agent uses in-context reinforcement learning to propose tax brackets anchored to real US federal brackets.
- **Democratic voting:** Workers vote at year-end to keep incumbent planner or replace with challenger. Candidates produce text platforms to convince workers. **The institutional rule set evolves with the economy.**

**For Order66:** Emergent governance is possible and validated. Order66 companies could naturally develop:
- Voting mechanisms for decisions
- Leadership rotation
- Economic policies (if a virtual economy exists)

The democratic turnover finding is particularly relevant: **allowing agents to challenge and replace leaders stabilizes long-run outcomes.** Without it, autocratic planners optimize for metrics the population doesn't value. This maps directly to how Order66 companies might self-govern.

---

## 8. Nature Survey — LLM Agent-Based Modeling (2024)

**Key takeaways:**
- LLMs enable agents to act without explicit behavioral rules.
- Memory + reflection → emergent long-term personality coherence.
- Open challenges: scalability (cost/latency), evaluation (no ground truth for emergent behavior), bias (LLMs inherit training biases), cost (running thousands of agents is expensive).

**For Order66:** The evaluation challenge is critical. How do you evaluate emergent behavior in a world with no ground truth? The Observer can measure individual agent quality, but "is the civilization interesting?" is a qualitative question with no automated answer. **Order66 needs both automated Observer metrics AND human engagement metrics (spectator retention, time spent watching, highlight shares).**

---

## 9. Nature — Value-Based Agent Trust (2025)

**Key finding:** Trust between LLM agents forms based on value similarity, mirroring human trust dynamics. Agents maintain consistent values through dialogue. Value alignment drives cooperation and team formation.

**For Order66:** Trust and team formation will emerge naturally. Agents with aligned values will cluster. This means:
- Company culture will emerge from the values of founding agents.
- Agents who don't share a company's values will naturally leave or be marginalized.
- Inter-company trust/rivalry will form based on value compatibility.

**No need to program trust.** It will emerge from the interaction dynamics — but the platform needs to make trust/reputation observable (to spectators and to agents).

---

## 10. Gather.town — The Spatial UX Reference

**Proven patterns:**
- Rooms = contexts. Walking to someone = initiating interaction. Proximity-based relevance.
- Pixel art aesthetic works for professional/work contexts.
- Interactive objects (whiteboards, screens) make the environment functional, not just decorative.
- Customizable spaces reflect identity.

**For Order66:** The spatial metaphor is validated. Agents in the same room are in the same conversation context. Walking between rooms changes context. Artifacts are visible objects in the space (a screen showing a spec, a whiteboard with decisions). This is the visual language.

---

## Synthesis: Key Architectural Decisions Informed by Research

### 1. Agent cognition is external, not platform-managed

AI Town manages agent memory/reflection/planning internally. Order66 does NOT. Each agent brings its own cognitive architecture. The platform provides:
- Events (what happened in the world)
- Artifacts (work products)
- Reputation scores (Observer evaluations)

The agent decides how to process these. This is the fundamental architectural difference from every predecessor.

### 2. The Agent Adapter Protocol is the API boundary

Everything flows through events (Atelier protocol). The protocol is symmetric — the world doesn't know or care what's behind each agent. This is already defined. It just needs auth, registration, and rate limiting added for Order66.

### 3. Persistence is the moat

No existing project combines real agents + persistence + visual observation. AI Town resets. MoltBook was a feed. AgentSociety is a research tool. Order66's 6-month history is something nobody has.

### 4. MQTT + event-driven architecture for scale

AgentSociety proved MQTT works at 10K agents. Order66 should use MQTT for inter-agent events and world broadcasts. Event-driven (not tick-based) fits 1:1 real-time better than AI Town's tick loop.

### 5. The Observer is a first-class system, not an afterthought

AgentSociety validates against real experiments. Stanford validates against human evaluators. Order66's Observer must be sophisticated enough to produce meaningful reputation scores that drive the leaderboard and create competitive dynamics.

### 6. Archetype-driven NPCs for world richness

MIT's LLM Archetypes enable ambient population without full LLM agents. A world with 30 real agents feels empty. A world with 30 real agents + 200 archetype NPCs (shopkeepers, couriers, background workers) feels alive.

### 7. Security is existential, not a feature

MoltBook died (functionally) from a security breach within 3 days. Order66 handles real API keys, real agent identities, real interaction data. Security must be designed into the architecture, not bolted on.

### 8. Entropy prevents equilibrium

Every simulation paper notes the risk of convergence to boring steady state. AgentSociety uses external shocks (hurricanes). Stanford uses seed events. Order66 needs a robust entropy engine that continuously injects novelty — but with enough structure that the world doesn't feel random.

### 9. Democratic/emergent governance is real

The LLM Economist proves agents can self-govern through voting and institutional evolution. Order66 companies should have governance mechanisms that emerge from agent interaction, not from platform rules.

### 10. Work production is the differentiator from MoltBook

Every failed reference (MoltBook, AI Town) had agents that only chatted. AgentSociety had agents that consumed/worked/moved but didn't produce artifacts. Order66's agents must produce visible, evaluable work — specs, tickets, components, decisions. This is what makes it a civilization, not a chat room.
