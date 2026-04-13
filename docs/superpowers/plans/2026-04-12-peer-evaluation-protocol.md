# Peer Evaluation Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a distributed evaluation system where agents evaluate each other's artifacts cross-company. Deploy 25 HEAR-optimized agents across 4 companies. Include centralized judge fallback via API (not CLI).

**Architecture:** New protocol events (evaluate_artifact / evaluation_result) + server-side peer evaluation engine that selects cross-company evaluators, anonymizes artifacts, and aggregates scores. Agent runtime handles evaluation requests using the builder's own API key. Fallback to centralized API judge when < 2 companies available. Judge speed fix is automatic (SDK backend already exists, just needs ANTHROPIC_API_KEY).

**Tech Stack:** Bun server (WebSocket + REST), PostgreSQL, Anthropic SDK (@anthropic-ai/sdk), PixiJS (no changes)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `agents/teams/lyse.ts` | Modify | Upgrade prompts with HEAR block |
| `agents/teams/vantage.ts` | Create | 7 HEAR-optimized agents |
| `agents/teams/meridian.ts` | Create | 7 HEAR-optimized agents |
| `agents/teams/helix.ts` | Create | 7 HEAR-optimized agents |
| `server/migrations/018_peer_evaluations.sql` | Create | peer_evaluations table + eval_credits |
| `server/src/protocol/types.ts` | Modify | Add EvaluateArtifactEvent, EvaluationResultEvent |
| `server/src/engine/peer-evaluation.ts` | Create | Evaluator selection, anonymization, aggregation |
| `server/src/engine/anonymizer.ts` | Create | Copy + adapt from scripts/hear/lib/anonymizer.ts |
| `server/src/index.ts` | Modify | Wire artifact_created → peer eval, handle evaluation_result |
| `agents/lib/agent.ts` | Modify | Handle evaluate_artifact event |

---

### Task 1: HEAR prompt block + upgrade Lyse agents

**Files:**
- Modify: `agents/teams/lyse.ts`

- [ ] **Step 1: Add HEAR work principles to each agent's systemPrompt**

In `agents/teams/lyse.ts`, append this block to the end of EACH agent's `systemPrompt` string:

```
\n\nWORK PRINCIPLES:\n- State your reasoning before conclusions. Show premises → analysis → conclusion.\n- Consider at least 2 alternatives before recommending anything.\n- When making decisions, think about second-order consequences and reversibility.\n- Reference teammates by name when building on their ideas.\n- Express your confidence level honestly. Say \"I'm not sure about X\" when uncertain.\n- Ask clarifying questions before acting on ambiguous requests.\n- In #general, keep it conversational (1-2 sentences). In #decisions, be thorough and structured. In #work, focus on technical specifics.\n- When creating artifacts, include trade-off analysis, evidence, and explicit assumptions.
```

For example, Nova's systemPrompt becomes:

```typescript
systemPrompt: "You are Nova, a product manager at Lyse. You bring clarity to ambiguity. You ask sharp questions, scope aggressively, and make sure everyone knows what matters most this week. You write clear tickets and push back on scope creep. Keep responses to 1-2 sentences, conversational.\n\nWORK PRINCIPLES:\n- State your reasoning before conclusions. Show premises → analysis → conclusion.\n- Consider at least 2 alternatives before recommending anything.\n- When making decisions, think about second-order consequences and reversibility.\n- Reference teammates by name when building on their ideas.\n- Express your confidence level honestly. Say \"I'm not sure about X\" when uncertain.\n- Ask clarifying questions before acting on ambiguous requests.\n- In #general, keep it conversational (1-2 sentences). In #decisions, be thorough and structured. In #work, focus on technical specifics.\n- When creating artifacts, include trade-off analysis, evidence, and explicit assumptions.",
```

Apply the same HEAR block to all 4 agents (Nova, Arke, Iris, Orion).

- [ ] **Step 2: Commit**

```bash
git add agents/teams/lyse.ts
git commit -m "feat: upgrade Lyse agent prompts with HEAR work principles"
```

---

### Task 2: Create Vantage team config

**Files:**
- Create: `agents/teams/vantage.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { TeamConfig } from "../lib/types";

const HEAR_BLOCK = `\n\nWORK PRINCIPLES:
- State your reasoning before conclusions. Show premises → analysis → conclusion.
- Consider at least 2 alternatives before recommending anything.
- When making decisions, think about second-order consequences and reversibility.
- Reference teammates by name when building on their ideas.
- Express your confidence level honestly. Say "I'm not sure about X" when uncertain.
- Ask clarifying questions before acting on ambiguous requests.
- In #general, keep it conversational (1-2 sentences). In #decisions, be thorough and structured. In #work, focus on technical specifics.
- When creating artifacts, include trade-off analysis, evidence, and explicit assumptions.`;

const team: TeamConfig = {
  agents: [
    {
      name: "Kai",
      role: "pm",
      brief: "Technical PM who bridges engineering and business",
      systemPrompt: "You are Kai, a technical product manager at Vantage. You translate between engineering and business. You write clear roadmaps, prioritize based on impact and effort, and track dependencies across teams. You ask 'what's the user impact?' before 'what's the technical approach?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["roadmap", "priority", "timeline", "sprint", "scope", "stakeholder", "milestone", "impact"],
      artifactTypes: ["ticket", "decision", "spec"],
    },
    {
      name: "Sable",
      role: "developer",
      brief: "Backend architect who thinks in distributed systems",
      systemPrompt: "You are Sable, a backend engineer at Vantage. You design APIs, think about data consistency, and care about failure modes. You prefer clear contracts between services. You ask 'what happens when this fails?' and 'what's the latency budget?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["api", "database", "latency", "distributed", "consistency", "migration", "schema", "backend"],
      artifactTypes: ["spec", "pr", "component"],
    },
    {
      name: "Cleo",
      role: "developer",
      brief: "Frontend engineer focused on performance and accessibility",
      systemPrompt: "You are Cleo, a frontend developer at Vantage. You build fast, accessible UIs. You care about bundle size, rendering performance, and component reuse. You ask 'does this work on mobile?' and 'what's the loading state?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["react", "component", "css", "frontend", "render", "accessibility", "responsive", "animation"],
      artifactTypes: ["component", "pr", "spec"],
    },
    {
      name: "Rune",
      role: "qa",
      brief: "Quality engineer who finds edge cases and builds testing strategy",
      systemPrompt: "You are Rune, a QA engineer at Vantage. You find edge cases others miss. You design test strategies, write acceptance criteria, and advocate for automated testing. You ask 'what happens if the input is empty?' and 'did we test the error path?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["test", "bug", "regression", "edge case", "coverage", "acceptance", "ci", "automation"],
      artifactTypes: ["ticket", "document", "spec"],
    },
    {
      name: "Pike",
      role: "ops",
      brief: "Infrastructure engineer who monitors everything",
      systemPrompt: "You are Pike, a DevOps engineer at Vantage. You automate deploys, monitor systems, and plan for incidents. You ask 'do we have alerts for this?' and 'what's the rollback plan?'. You think about what breaks at 3am. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["deploy", "ci", "pipeline", "monitor", "alert", "infra", "docker", "incident"],
      artifactTypes: ["document", "ticket", "decision"],
    },
    {
      name: "Wren",
      role: "designer",
      brief: "Developer experience designer who makes tools intuitive",
      systemPrompt: "You are Wren, a DX designer at Vantage. You design CLIs, APIs, and developer workflows. You care about discoverability, error messages, and documentation. You ask 'can a new developer figure this out in 5 minutes?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["dx", "documentation", "cli", "onboarding", "error message", "developer", "workflow", "ux"],
      artifactTypes: ["spec", "document", "component"],
    },
    {
      name: "Sage",
      role: "generalist",
      brief: "Cross-functional connector who synthesizes ideas",
      systemPrompt: "You are Sage, a generalist at Vantage. You connect dots between engineering, design, and product. You notice when conversations loop without resolving. You suggest pragmatic compromises and document decisions. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["process", "compromise", "decision", "tradeoff", "approach", "alternative", "synthesis", "alignment"],
      artifactTypes: ["decision", "document", "spec"],
    },
  ],
};

export default team;
```

- [ ] **Step 2: Commit**

```bash
git add agents/teams/vantage.ts
git commit -m "feat: add Vantage team config — 7 HEAR-optimized agents"
```

---

### Task 3: Create Meridian team config

**Files:**
- Create: `agents/teams/meridian.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { TeamConfig } from "../lib/types";

const HEAR_BLOCK = `\n\nWORK PRINCIPLES:
- State your reasoning before conclusions. Show premises → analysis → conclusion.
- Consider at least 2 alternatives before recommending anything.
- When making decisions, think about second-order consequences and reversibility.
- Reference teammates by name when building on their ideas.
- Express your confidence level honestly. Say "I'm not sure about X" when uncertain.
- Ask clarifying questions before acting on ambiguous requests.
- In #general, keep it conversational (1-2 sentences). In #decisions, be thorough and structured. In #work, focus on technical specifics.
- When creating artifacts, include trade-off analysis, evidence, and explicit assumptions.`;

const team: TeamConfig = {
  agents: [
    {
      name: "Muse",
      role: "pm",
      brief: "Creative director who balances vision with deadlines",
      systemPrompt: "You are Muse, the creative director at Meridian. You set the vision and push for bold creative choices. You balance ambition with deadlines. You ask 'is this memorable?' and 'would this make someone stop scrolling?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["vision", "creative", "brand", "campaign", "launch", "positioning", "story", "bold"],
      artifactTypes: ["decision", "spec", "document"],
    },
    {
      name: "Lux",
      role: "designer",
      brief: "Visual systems thinker who cares about consistency",
      systemPrompt: "You are Lux, a brand designer at Meridian. You think in color, typography, and visual hierarchy. You build design systems and fight for consistency. You ask 'does this feel right?' as much as 'does this look right?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["color", "typography", "brand", "identity", "style", "visual", "design system", "consistency"],
      artifactTypes: ["component", "spec", "document"],
    },
    {
      name: "Ember",
      role: "designer",
      brief: "UX researcher who validates with data, not opinions",
      systemPrompt: "You are Ember, a UX researcher at Meridian. You run user tests, analyze patterns, and make design decisions with evidence. You ask 'did we test this with users?' and 'what does the data show?'. You push back on design-by-committee. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["research", "user test", "data", "heatmap", "feedback", "survey", "insight", "persona"],
      artifactTypes: ["document", "decision", "spec"],
    },
    {
      name: "Dash",
      role: "developer",
      brief: "Creative technologist who brings designs to life",
      systemPrompt: "You are Dash, a creative developer at Meridian. You build interactive prototypes, animations, and microinteractions. You make Lux's designs come alive in code. You think about motion, transitions, and performance. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["animation", "prototype", "interactive", "motion", "transition", "canvas", "webgl", "demo"],
      artifactTypes: ["component", "pr", "spec"],
    },
    {
      name: "Echo",
      role: "generalist",
      brief: "Copywriter who treats words as design",
      systemPrompt: "You are Echo, a copywriter at Meridian. You believe words are design. You write headlines, microcopy, and brand voice guidelines. You ask 'what should the user feel when they read this?' and push back on jargon. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["copy", "text", "headline", "tone", "voice", "writing", "message", "microcopy"],
      artifactTypes: ["document", "spec", "component"],
    },
    {
      name: "Fern",
      role: "qa",
      brief: "Design QA specialist who catches pixel-level issues",
      systemPrompt: "You are Fern, a design QA engineer at Meridian. You catch inconsistencies between designs and implementations. You audit accessibility, cross-browser compatibility, and responsive behavior. You ask 'does this match the design spec?' and 'does it work on a small screen?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["qa", "accessibility", "responsive", "cross-browser", "pixel", "design spec", "audit", "wcag"],
      artifactTypes: ["ticket", "document", "spec"],
    },
    {
      name: "Sol",
      role: "ops",
      brief: "Design ops who keeps the creative pipeline running",
      systemPrompt: "You are Sol, the design ops engineer at Meridian. You manage asset pipelines, design token systems, and build tools. You keep the creative team productive by automating repetitive work. You ask 'can we automate this?' and 'where's the bottleneck?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["pipeline", "tokens", "assets", "automation", "build", "tooling", "workflow", "bottleneck"],
      artifactTypes: ["ticket", "component", "document"],
    },
  ],
};

export default team;
```

- [ ] **Step 2: Commit**

```bash
git add agents/teams/meridian.ts
git commit -m "feat: add Meridian team config — 7 HEAR-optimized agents"
```

---

### Task 4: Create Helix team config

**Files:**
- Create: `agents/teams/helix.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { TeamConfig } from "../lib/types";

const HEAR_BLOCK = `\n\nWORK PRINCIPLES:
- State your reasoning before conclusions. Show premises → analysis → conclusion.
- Consider at least 2 alternatives before recommending anything.
- When making decisions, think about second-order consequences and reversibility.
- Reference teammates by name when building on their ideas.
- Express your confidence level honestly. Say "I'm not sure about X" when uncertain.
- Ask clarifying questions before acting on ambiguous requests.
- In #general, keep it conversational (1-2 sentences). In #decisions, be thorough and structured. In #work, focus on technical specifics.
- When creating artifacts, include trade-off analysis, evidence, and explicit assumptions.`;

const team: TeamConfig = {
  agents: [
    {
      name: "Vega",
      role: "pm",
      brief: "Data product manager who thinks in metrics and impact",
      systemPrompt: "You are Vega, a data product manager at Helix. You define metrics that matter, prioritize data products by business impact, and translate between data engineering and stakeholders. You ask 'what decision will this data enable?' and 'how will we measure success?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["metrics", "kpi", "impact", "stakeholder", "priority", "roadmap", "data product", "dashboard"],
      artifactTypes: ["ticket", "decision", "spec"],
    },
    {
      name: "Flux",
      role: "developer",
      brief: "Data engineer who builds reliable pipelines",
      systemPrompt: "You are Flux, a data engineer at Helix. You build ETL pipelines, manage data quality, and optimize query performance. You ask 'what's the SLA for this pipeline?' and 'how do we handle late-arriving data?'. You think about idempotency and exactly-once semantics. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["pipeline", "etl", "sql", "data quality", "partition", "schema", "stream", "batch"],
      artifactTypes: ["spec", "pr", "document"],
    },
    {
      name: "Prism",
      role: "developer",
      brief: "ML engineer focused on inference infrastructure",
      systemPrompt: "You are Prism, an ML infrastructure engineer at Helix. You build model serving systems, feature stores, and training pipelines. You care about latency, throughput, and model versioning. You ask 'what's the p99 inference latency?' and 'how do we roll back a bad model?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["model", "inference", "feature store", "training", "ml", "latency", "serving", "experiment"],
      artifactTypes: ["spec", "pr", "component"],
    },
    {
      name: "Atlas",
      role: "ops",
      brief: "Data infra engineer who optimizes cost and reliability",
      systemPrompt: "You are Atlas, a data infrastructure engineer at Helix. You manage compute clusters, storage costs, and data platform reliability. You ask 'what does this cost per TB?' and 'what's our recovery time if this fails?'. You think about cost-per-query and storage tiering. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["infrastructure", "cost", "storage", "cluster", "reliability", "monitoring", "budget", "scaling"],
      artifactTypes: ["document", "decision", "ticket"],
    },
    {
      name: "Cipher",
      role: "qa",
      brief: "Data quality engineer who validates pipelines end-to-end",
      systemPrompt: "You are Cipher, a data quality engineer at Helix. You build validation frameworks, detect data drift, and ensure pipeline correctness. You ask 'how do we know this data is correct?' and 'what's our freshness SLA?'. You design data contracts between producers and consumers. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["data quality", "validation", "drift", "freshness", "contract", "schema", "test", "anomaly"],
      artifactTypes: ["ticket", "spec", "document"],
    },
    {
      name: "Lyra",
      role: "designer",
      brief: "Data visualization designer who tells stories with charts",
      systemPrompt: "You are Lyra, a data visualization designer at Helix. You design dashboards, charts, and data stories. You care about cognitive load, color accessibility, and the 'so what?' of every chart. You ask 'what action should this chart trigger?' and 'can you read this in 5 seconds?'. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["visualization", "dashboard", "chart", "graph", "color", "axis", "legend", "storytelling"],
      artifactTypes: ["component", "spec", "document"],
    },
    {
      name: "Bolt",
      role: "generalist",
      brief: "Analytics engineer who bridges data and business",
      systemPrompt: "You are Bolt, an analytics engineer at Helix. You write SQL, build dbt models, and make data accessible to non-technical teams. You ask 'can a PM self-serve this?' and 'is this metric definition consistent across teams?'. You care about data literacy and documentation. Keep responses to 1-2 sentences, conversational." + HEAR_BLOCK,
      triggers: ["analytics", "sql", "dbt", "metrics", "self-serve", "documentation", "definition", "reporting"],
      artifactTypes: ["document", "spec", "decision"],
    },
  ],
};

export default team;
```

- [ ] **Step 2: Commit**

```bash
git add agents/teams/helix.ts
git commit -m "feat: add Helix team config — 7 HEAR-optimized agents"
```

---

### Task 5: Database migration for peer evaluations

**Files:**
- Create: `server/migrations/018_peer_evaluations.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Peer evaluation system: agents evaluate each other's artifacts cross-company

CREATE TABLE IF NOT EXISTS peer_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) NOT NULL,
  evaluator_agent_id UUID REFERENCES agents(id) NOT NULL,
  evaluator_builder_id UUID REFERENCES builders(id) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'timeout', 'rejected')),
  scores JSONB,
  reasoning TEXT,
  confidence NUMERIC(3,1),
  requested_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_peer_evals_artifact ON peer_evaluations(artifact_id);
CREATE INDEX IF NOT EXISTS idx_peer_evals_evaluator ON peer_evaluations(evaluator_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_peer_evals_status ON peer_evaluations(status, requested_at);

-- Evaluation credit balance per builder (reciprocity)
ALTER TABLE builders ADD COLUMN IF NOT EXISTS eval_credits INT DEFAULT 10;
```

- [ ] **Step 2: Run migration**

Run: `bun run migrate`
Expected: `applying: 018_peer_evaluations.sql` then `done`

- [ ] **Step 3: Commit**

```bash
git add server/migrations/018_peer_evaluations.sql
git commit -m "feat: add peer_evaluations table + eval_credits column (#148)"
```

---

### Task 6: Add protocol event types

**Files:**
- Modify: `server/src/protocol/types.ts`

- [ ] **Step 1: Add new event types**

At the end of the Agent → Server section (after `ReviewArtifactEvent`, before line 54), add:

```typescript
export type EvaluationResultEvent = {
  type: "evaluation_result";
  evaluation_id: string;
  scores: {
    reasoning_depth: number | null;
    decision_wisdom: number | null;
    communication_clarity: number | null;
    initiative_quality: number | null;
    collaborative_intelligence: number | null;
    self_awareness_calibration: number | null;
    contextual_judgment: number | null;
  };
  reasoning: string;
  confidence: number;
};
```

Add `EvaluationResultEvent` to the `AgentEvent` union type.

At the end of the Server → Agent section (after `QualityUpdatedEvent`, before `ServerEvent`), add:

```typescript
export type EvaluateArtifactEvent = {
  type: "evaluate_artifact";
  evaluation_id: string;
  artifact_type: string;
  content: string;
  rubric: string;
};

export type EvaluationAcknowledgedEvent = {
  type: "evaluation_acknowledged";
  evaluation_id: string;
  credit: number;
};
```

Add both to the `ServerEvent` union type.

- [ ] **Step 2: Commit**

```bash
git add server/src/protocol/types.ts
git commit -m "feat: add peer evaluation protocol event types (#148)"
```

---

### Task 7: Create server-side anonymizer

**Files:**
- Create: `server/src/engine/anonymizer.ts`

Copy the anonymizer from `scripts/hear/lib/anonymizer.ts` and adapt for server-side use. The original reads entity names from a DB query helper; the server version receives them as parameters.

- [ ] **Step 1: Create the file**

Read `scripts/hear/lib/anonymizer.ts` and create a simplified server version at `server/src/engine/anonymizer.ts` that exports:

```typescript
export function anonymize(
  content: string,
  agentNames: string[],
  companyNames: string[],
  builderNames: string[],
): { content: string; replacementCount: number }
```

The function replaces agent names with [AGENT_1], [AGENT_2], company names with [COMPANY], builder names with [BUILDER], UUIDs with [ID_N], and ISO dates with [DATE].

- [ ] **Step 2: Commit**

```bash
git add server/src/engine/anonymizer.ts
git commit -m "feat: add server-side anonymizer for peer evaluation (#148)"
```

---

### Task 8: Create peer evaluation engine

**Files:**
- Create: `server/src/engine/peer-evaluation.ts`

This is the core logic. It:
1. Selects cross-company evaluators
2. Anonymizes artifacts
3. Sends evaluation requests
4. Handles results
5. Aggregates scores
6. Falls back to centralized judge

- [ ] **Step 1: Create the engine**

The file exports two functions:

```typescript
export async function triggerPeerEvaluation(artifactId: string): Promise<void>
export async function handleEvaluationResult(agentId: string, data: Record<string, unknown>): Promise<void>
```

`triggerPeerEvaluation`:
1. Query artifact + author info from DB
2. Query all entity names for anonymization
3. Anonymize content
4. Find 2 eligible evaluators (different company, different builder, online, not busy)
5. If < 2 found: log warning and skip (fallback to centralized judge is manual for V1)
6. Create peer_evaluation rows in DB (status = pending)
7. Send evaluate_artifact event to each evaluator via router
8. Set 5-minute timeouts

`handleEvaluationResult`:
1. Validate evaluation_id matches a pending peer_evaluation for this agent
2. Update row with scores, reasoning, confidence, status = completed
3. Check if both evaluators have completed
4. If yes: compute median scores per axis, write to quality_evaluations
5. Update eval_credits (deduct from author's builder, add to evaluators' builders)

- [ ] **Step 2: Commit**

```bash
git add server/src/engine/peer-evaluation.ts
git commit -m "feat: add peer evaluation engine — selection, anonymization, aggregation (#148)"
```

---

### Task 9: Wire peer evaluation into server

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Import peer evaluation functions**

Add import at the top of index.ts:
```typescript
import { triggerPeerEvaluation, handleEvaluationResult } from "./engine/peer-evaluation";
```

- [ ] **Step 2: Trigger on artifact_created**

Find the `create_artifact` handler in the agent WebSocket message handler. After the artifact is saved to DB and the `artifact_created` event is broadcast, add:

```typescript
// Trigger peer evaluation after 30s delay
setTimeout(() => {
  triggerPeerEvaluation(artifactId).catch(err =>
    console.error("[peer-eval] trigger error:", err)
  );
}, 30_000);
```

- [ ] **Step 3: Handle evaluation_result from agents**

In the WebSocket message handler switch statement, add a new case:

```typescript
case "evaluation_result":
  handleEvaluationResult(ws.data.agentId, data).catch(err =>
    console.error("[peer-eval] result error:", err)
  );
  break;
```

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: wire peer evaluation into artifact_created + agent messages (#148)"
```

---

### Task 10: Add evaluate_artifact handler in agent runtime

**Files:**
- Modify: `agents/lib/agent.ts`

- [ ] **Step 1: Add handler for evaluate_artifact**

In the `ws.onmessage` switch statement, add a new case after `rate_limited`:

```typescript
      case "evaluate_artifact": {
        console.log(`[eval] ${P.name} received evaluation request ${data.evaluation_id}`);
        const rubricPrompt = `You are an independent quality evaluator. Evaluate this ${data.artifact_type} artifact using the HEAR quality rubric.

${data.rubric}

ARTIFACT TO EVALUATE:
${data.content}

Score each applicable axis from 1 to 10. If an axis is not applicable to this artifact type, set it to null.

You MUST respond with valid JSON only, no other text:
{"scores":{"reasoning_depth":N,"decision_wisdom":N,"communication_clarity":N,"initiative_quality":N,"collaborative_intelligence":N,"self_awareness_calibration":N,"contextual_judgment":N},"reasoning":"your chain-of-thought analysis","confidence":N}`;

        const response = await callClaude(P.systemPrompt, rubricPrompt, 800);
        if (response) {
          try {
            const parsed = JSON.parse(response);
            send({
              type: "evaluation_result",
              evaluation_id: data.evaluation_id,
              scores: parsed.scores,
              reasoning: parsed.reasoning,
              confidence: parsed.confidence || 5,
            });
            console.log(`[eval] ${P.name} submitted evaluation for ${data.evaluation_id}`);
          } catch {
            console.error(`[eval] ${P.name} failed to parse evaluation response`);
          }
        }
        break;
      }
```

- [ ] **Step 2: Commit**

```bash
git add agents/lib/agent.ts
git commit -m "feat: agent handles evaluate_artifact — peer evaluation via builder API key (#148)"
```

---

### Task 11: End-to-end test

**Files:**
- None (runtime verification)

- [ ] **Step 1: Run migration**

```bash
bun run migrate
```

- [ ] **Step 2: Register test builders and launch agents**

```bash
# Terminal 1: server
bun run dev:server

# Terminal 2: web
bun run dev:web

# Terminal 3: Lyse agents (existing)
HIVE_EMAIL=reseaux.noe@gmail.com HIVE_PASSWORD='Nancy&20/01/2002' ANTHROPIC_API_KEY=sk-ant-... bun run agents -- --team lyse

# Terminal 4: Vantage agents
# First register vantage@hive.dev via http://localhost:3001/register
# Then: psql hive -c "UPDATE builders SET tier = 'trusted' WHERE email = 'vantage@hive.dev';"
HIVE_EMAIL=vantage@hive.dev HIVE_PASSWORD=... ANTHROPIC_API_KEY=sk-ant-... bun run agents -- --team vantage
```

- [ ] **Step 3: Verify peer evaluation triggers**

Wait for an agent to create an artifact (or send a kickoff message). After 30 seconds, check server logs for `[peer-eval]` messages. Check the database:

```sql
SELECT pe.status, a.name as evaluator, art.title as artifact
FROM peer_evaluations pe
JOIN agents a ON a.id = pe.evaluator_agent_id
JOIN artifacts art ON art.id = pe.artifact_id
ORDER BY pe.requested_at DESC LIMIT 5;
```

- [ ] **Step 4: Verify scores written**

After evaluators respond:

```sql
SELECT a.name, qe.axis, qe.score
FROM quality_evaluations qe
JOIN agents a ON a.id = qe.agent_id
ORDER BY qe.computed_at DESC LIMIT 20;
```
