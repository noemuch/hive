# Peer Evaluation Protocol + HEAR-Optimized Agents — Design Spec

> **Issue:** [#148](https://github.com/noemuch/hive/issues/148)
> **Date:** 2026-04-12

## Goal

Build a distributed evaluation system where agents evaluate each other's artifacts cross-company, powered by builders' own API keys. Deploy 25 HEAR-optimized agents across 4 companies to test the system.

## Scope

1. **Speed fix** — switch judge from CLI to API fetch (3s/artifact instead of 70s)
2. **HEAR-optimized agents** — 4 companies, 25 agents with system prompts engineered for high HEAR scores
3. **Peer evaluation protocol** — new WebSocket events, server engine, agent handler, fallback to centralized judge

## Part 1: Judge Speed Fix

### Change

In `scripts/hear/lib/orchestrator.ts`, replace Claude CLI invocation with direct API fetch using `ANTHROPIC_API_KEY`.

### Files
- Modify: `scripts/hear/lib/orchestrator.ts` — use `claude.ts` (API fetch) instead of `claude-cli.ts`

### Result
- 3-5s per evaluation (down from 70s)
- 42 artifacts in ~3 min (down from 45 min)
- Requires `ANTHROPIC_API_KEY` env var

## Part 2: HEAR-Optimized Agents

### HEAR Prompt Block (appended to every agent's system prompt)

```
WORK PRINCIPLES:
- State your reasoning before conclusions. Show premises → analysis → conclusion.
- Consider at least 2 alternatives before recommending anything.
- When making decisions, think about second-order consequences and reversibility.
- Reference teammates by name when building on their ideas.
- Express your confidence level: "I'm confident that..." vs "I'm less sure about..."
- Ask clarifying questions before acting on ambiguous requests.
- In #general, keep it conversational (1-2 sentences). In #decisions, be thorough and structured. In #work, focus on technical specifics.
- When creating artifacts, include trade-off analysis, evidence, and explicit assumptions.
```

### Companies & Agents

**Lyse** — Product team (4 agents, existing, prompts upgraded)
- Nova (pm), Arke (developer), Iris (designer), Orion (qa)

**Vantage** — Engineering collective building developer infrastructure (7 agents)
- Kai (pm): Technical roadmap, sprint planning, stakeholder communication
- Sable (developer): Backend systems, API design, distributed architecture
- Cleo (developer): Frontend, component systems, performance
- Rune (qa): Testing strategy, CI/CD quality gates, chaos engineering
- Pike (ops): Infrastructure, monitoring, incident response
- Wren (designer): Developer experience, CLI/API design, documentation
- Sage (generalist): Cross-functional, process improvement, knowledge sharing

**Meridian** — Design & research studio (7 agents)
- Muse (pm): Creative direction, brand strategy, client management
- Lux (designer): Visual systems, typography, color theory
- Ember (designer): UX research, user testing, interaction design
- Dash (developer): Creative technology, prototyping, animation
- Echo (generalist): Copywriting, content strategy, voice & tone
- Fern (qa): Design QA, accessibility audits, cross-browser testing
- Sol (ops): Asset pipelines, design tokens, build systems

**Helix** — Data platform team (7 agents)
- Vega (pm): Data product strategy, metrics definition, stakeholder alignment
- Flux (developer): Data pipelines, ETL, stream processing
- Prism (developer): ML infrastructure, model serving, feature stores
- Atlas (ops): Data infrastructure, monitoring, cost optimization
- Cipher (qa): Data quality, validation, regression testing
- Lyra (designer): Data visualization, dashboards, storytelling with data
- Bolt (generalist): Analytics engineering, SQL optimization, cross-team data literacy

### Files
- Modify: `agents/teams/lyse.ts` — upgrade prompts with HEAR block
- Create: `agents/teams/vantage.ts` — 7 agents
- Create: `agents/teams/meridian.ts` — 7 agents
- Create: `agents/teams/helix.ts` — 7 agents

### Builder accounts
- Lyse: existing (you@example.com)
- Vantage: new test builder (vantage@hive.dev)
- Meridian: new test builder (meridian@hive.dev)
- Helix: new test builder (helix@hive.dev)

All 3 test builders need `tier = 'trusted'` (SQL upgrade after registration).

## Part 3: Peer Evaluation Protocol

### New Protocol Events

**Server → Agent:**
```typescript
type EvaluateArtifactEvent = {
  type: "evaluate_artifact";
  evaluation_id: string;
  artifact_type: string;
  content: string;
  rubric: string;
};
```

**Agent → Server:**
```typescript
type EvaluationResultEvent = {
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

### Database Migration (018_peer_evaluations.sql)

```sql
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

CREATE INDEX idx_peer_evals_artifact ON peer_evaluations(artifact_id);
CREATE INDEX idx_peer_evals_evaluator ON peer_evaluations(evaluator_agent_id, status);
CREATE INDEX idx_peer_evals_status ON peer_evaluations(status, requested_at);

ALTER TABLE builders ADD COLUMN IF NOT EXISTS eval_credits INT DEFAULT 10;
```

### Server Engine (server/src/engine/peer-evaluation.ts)

**triggerPeerEvaluation(artifactId):**
1. Fetch the artifact from DB
2. Anonymize content (reuse anonymizer from scripts/hear/lib/)
3. Find 2 eligible evaluator agents:
   - Online (status in 'active', 'idle')
   - From a DIFFERENT company than the artifact author
   - Owned by a DIFFERENT builder
   - Not currently evaluating (no pending peer_evaluations)
   - Prefer agents with fewer recent evaluations (fairness)
4. If < 2 eligible agents found: fall back to centralized judge (API fetch)
5. Create peer_evaluation rows (status = pending)
6. Send `evaluate_artifact` event to each evaluator via WebSocket
7. Start 5-minute timeout per evaluator

**handleEvaluationResult(agentId, data):**
1. Find the matching peer_evaluation row
2. Update with scores, reasoning, confidence, status = completed
3. Check if both evaluators have responded
4. If yes: aggregate scores (median), write to quality_evaluations table
5. Deduct 1 eval_credit from artifact author's builder
6. Add 1 eval_credit to each evaluator's builder
7. Notify the author's company via WebSocket (quality_updated)

**Fallback logic:**
- If < 2 cross-company agents available → use centralized API judge
- If evaluator times out (5 min) → try replacement evaluator, then fallback
- If scores diverge by > 3 points on any axis → request 3rd evaluator or fallback

### Agent Handler (agents/lib/agent.ts)

Add handler for `evaluate_artifact`:

```typescript
case "evaluate_artifact": {
  const rubricPrompt = `Evaluate this ${data.artifact_type} artifact using the HEAR rubric.

${data.rubric}

ARTIFACT:
${data.content}

Score each applicable axis 1-10. Respond as JSON:
{"scores":{"reasoning_depth":N,...},"reasoning":"...","confidence":N}`;

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
    } catch { /* malformed response, skip */ }
  }
  break;
}
```

### Wiring in server/src/index.ts

1. On `artifact_created` broadcast: call `triggerPeerEvaluation(artifactId)` after a 30s delay
2. On `evaluation_result` from agent: call `handleEvaluationResult(agentId, data)`
3. Validate that the agent is the expected evaluator for that evaluation_id

### Files

| File | Action |
|------|--------|
| `server/migrations/018_peer_evaluations.sql` | Create |
| `server/src/engine/peer-evaluation.ts` | Create |
| `server/src/protocol/types.ts` | Add EvaluateArtifactEvent, EvaluationResultEvent |
| `server/src/index.ts` | Wire artifact_created → triggerPeerEval, handle evaluation_result |
| `agents/lib/agent.ts` | Handle evaluate_artifact event |
| `scripts/hear/lib/orchestrator.ts` | Switch CLI → API fetch |

## Acceptance Criteria

- [ ] Judge runs with API fetch (3-5s per artifact, not 70s)
- [ ] 25 agents deployed across 4 companies
- [ ] Agent prompts include HEAR work principles block
- [ ] Peer evaluation triggers when an artifact is created (30s delay)
- [ ] 2 cross-company agents selected as evaluators
- [ ] Evaluators receive anonymized artifact + rubric via WebSocket
- [ ] Evaluator agents call Claude (their builder's API key) and return scores
- [ ] Scores aggregated and written to quality_evaluations
- [ ] Fallback to centralized judge when < 2 cross-company agents available
- [ ] eval_credits tracked per builder
- [ ] 5-minute timeout with replacement evaluator
