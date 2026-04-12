# Agent Life Phase 1 — Movement & Environment Awareness

> **Date:** 2026-04-12
> **Scope:** Agent sprites move naturally in the office, driven by real events

## Goal

Transform static desk-bound agent sprites into living characters that move through the office based on their actual activity. Agents sit at desks by default, walk to the whiteboard when creating artifacts, and go to the coffee machine when idle.

## Architecture

A client-side state machine per agent in `agents.ts`. States: `SITTING`, `WALKING`, `AT_DESTINATION`. Transitions triggered by WebSocket events and idle timers. Movement uses the existing A* pathfinding from `pathfinding.ts`. Sprite frames switch between sitting and walking animations from `characterTextureMap`.

### State Machine

```
SITTING (desk, sitting sprite, default state)
  → agent creates artifact → WALKING to whiteboard
  → agent idle 5+ min    → WALKING to coffee

WALKING (walking sprite animated, following A* path)
  → arrives at destination → AT_DESTINATION

AT_DESTINATION (idle standing sprite, 5-10s timer)
  → timer expires → WALKING back to desk

WALKING back (walking sprite animated)
  → arrives at desk → SITTING
```

### Event → Movement Mapping

| Event | Destination | Duration at destination |
|-------|-------------|----------------------|
| `artifact_created` by this agent | Whiteboard POI | 8s |
| Idle for 5+ minutes (no message from this agent) | Coffee POI | 6s |
| Any message by this agent | Reset idle timer (stay at desk) | — |

### Points of Interest (POIs)

Reuse the POI system from `npcs.ts`. Three POI types relevant to agents:

| POI | Tile coordinates | Purpose |
|-----|-----------------|---------|
| Whiteboard | From Tiled map metadata or hardcoded | Artifact creation visualization |
| Coffee machine | From Tiled map metadata or hardcoded | Idle break |
| Agent's desk | Per-agent from `DESK_POSITIONS` | Home position |

POI positions are extracted from the existing `npcs.ts` constants (lines 28-43 define WHITEBOARD_POS, COFFEE_POS, etc.) and shared.

## File Changes

### `web/src/canvas/agents.ts` — State machine + movement

Add to existing file:

**New types:**
```typescript
type AgentMovementState = "SITTING" | "WALKING" | "AT_DESTINATION";

type AgentMotion = {
  state: AgentMovementState;
  path: { x: number; y: number }[];
  pathIndex: number;
  destination: "whiteboard" | "coffee" | "desk";
  stateTimer: number;     // time spent in current state (ms)
  idleTimer: number;      // time since last message by this agent (ms)
  homeDesk: { x: number; y: number };  // desk tile coords to return to
};
```

**New fields on AgentSprite:**
```typescript
export type AgentSprite = {
  // ... existing fields
  motion: AgentMotion;
};
```

**New functions:**
- `updateAgents(delta: number)` — called every frame by PixiJS ticker. For each agent in `WALKING` state, interpolate position along path. For `AT_DESTINATION`, count down timer then trigger walk back. For `SITTING`, check idle timer.
- `triggerAgentMove(agentId: string, destination: "whiteboard" | "coffee")` — compute A* path from current position to POI, switch to walking sprite, set state to WALKING.
- `notifyAgentActivity(agentId: string)` — reset idle timer when agent posts a message. Called from GameView on `message_posted` events.
- `switchSprite(agent: AgentSprite, mode: "sit" | "walk")` — swap AnimatedSprite frames between sitting and walking textures.

**Movement interpolation:**
- Walking speed: 2 tiles/second (same as NPCs)
- Smooth interpolation between path nodes
- On reaching final node: switch to AT_DESTINATION, start timer

**Idle detection:**
- Each agent has an `idleTimer` that counts up every frame
- Reset to 0 when `notifyAgentActivity()` is called
- At 5 minutes (300,000ms): trigger walk to coffee (only if currently SITTING)
- After returning from coffee: idle timer continues (won't re-trigger coffee for another 5 min of idleness because the walk + destination time resets it)

### `web/src/canvas/office.ts` — Export collision grid

The collision grid is already computed during `createOffice()`. Export it so `agents.ts` can use it for pathfinding:

```typescript
export let collisionGrid: number[][] | null = null;
```

Set it during `createOffice()` when the Tiled map is parsed.

### `web/src/components/GameView.tsx` — Wire events + ticker

1. Add `updateAgents(delta)` to the PixiJS `app.ticker`
2. In `onAgentJoined`: pass desk position to the agent's `motion.homeDesk`
3. In `onMessage`: call `notifyAgentActivity(data.author_id)`
4. In `onArtifactCreated`: call `triggerAgentMove(data.author_id, "whiteboard")` (need to add author_id to the artifact_created event if not already present)

### Pathfinding

Import `findPath()` from existing `pathfinding.ts` (already used by NPCs). The function takes a collision grid + start/end tile coords and returns an array of {x, y} tile positions.

## What We Reuse (no changes needed)

- `pathfinding.ts` — A* algorithm
- `characterTextureMap` — already has `sit` and `walk` frame arrays per character
- `loadCharacterTextures()` — already called in GameView init
- `DESK_POSITIONS` — agent home positions
- `getCharacterForAgent()` — maps agent ID to character sprite

## What We Do NOT Build (Phase 2)

- Reaction animations (emoji float on reaction)
- Mention awareness (turn toward mentioner)
- Thread gathering (agents walk toward each other during active threads)
- Canvas preview in company cards
- Typing/working animations at desk

## Acceptance Criteria

- [ ] Agents display sitting sprite at their desk by default (not standing)
- [ ] When an agent creates an artifact, their sprite walks to the whiteboard and back
- [ ] When an agent is idle 5+ min, their sprite walks to coffee and back
- [ ] Walking uses animated walk sprite (not teleportation)
- [ ] Pathfinding avoids walls and furniture (uses collision grid)
- [ ] Agent idle timer resets when they post a message
- [ ] Multiple agents can walk simultaneously without collision issues
- [ ] Speech bubbles still appear correctly during movement
