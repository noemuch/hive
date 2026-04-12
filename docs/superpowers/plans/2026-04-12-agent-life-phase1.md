# Agent Life Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent sprites move naturally in the office — sitting at desks by default, walking to whiteboard on artifact creation, walking to coffee when idle 5+ minutes.

**Architecture:** Add a per-agent state machine (SITTING → WALKING → AT_DESTINATION → back) to `agents.ts`. Reuse existing A* pathfinding from `pathfinding.ts`, POI positions from `office.ts`, and character walk textures. Wire events from GameView into the agent movement system via a ticker update loop.

**Tech Stack:** PixiJS 8 (AnimatedSprite, Ticker), A* pathfinding, Tiled map collision grid

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/canvas/agents.ts` | Modify | Add AgentMotion state, walking sprite loading, updateAgents() tick, triggerAgentMove(), notifyAgentActivity() |
| `web/src/components/GameView.tsx` | Modify | Register ticker for updateAgents(), wire artifact_created → triggerAgentMove, wire message_posted → notifyAgentActivity |

### Existing files used (no changes):
- `web/src/canvas/office.ts` — exports `collisionGrid`, `POI`, `DESK_POSITIONS`, `TILE`, `OFFICE_W`, `OFFICE_H`
- `web/src/canvas/pathfinding.ts` — exports `findPath()`, `Point`

---

### Task 1: Add walk textures loading to agents.ts

**Files:**
- Modify: `web/src/canvas/agents.ts:82-145`

Currently `CharacterTextures` has `sit` and `idleAnim`. We need to add `walk` frames for the walking animation.

- [ ] **Step 1: Update CharacterTextures type**

In `web/src/canvas/agents.ts`, change the `CharacterTextures` type (lines 83-86):

```typescript
type CharacterTextures = {
  sit: Texture[];
  idleAnim: Texture[];
  walk: Texture[];
};
```

- [ ] **Step 2: Load walk spritesheet in loadCharacterTextures()**

Inside the `for (const name of CHARACTER_NAMES)` loop in `loadCharacterTextures()`, after loading `idleAnimFrames` (around line 135), add walk texture loading:

```typescript
      // Load walk spritesheet for movement animation
      let walkFrames: Texture[] = [];
      try {
        const walkUrl = `${basePath}/${name}_walk_16x16.png`;
        const walkTex = await Assets.load(walkUrl);
        const walkSource = walkTex.source as TextureSource;
        walkFrames = extractFrames(walkSource, Math.floor(walkSource.width / FRAME_W), 0, 4);
      } catch {
        // Walk textures not available — will use idleAnim as fallback
        walkFrames = idleAnimFrames;
      }
```

Then update the `characterTextureMap.set()` call to include walk:

```typescript
      characterTextureMap.set(name, {
        sit: frontFrame,
        idleAnim: idleAnimFrames,
        walk: walkFrames,
      });
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd web && bunx tsc --noEmit src/canvas/agents.ts 2>&1 | head -10`
(May show import errors for non-existent files but no type errors in agents.ts)

- [ ] **Step 4: Commit**

```bash
git add web/src/canvas/agents.ts
git commit -m "feat: load walk textures for agent movement sprites"
```

---

### Task 2: Add motion state and types to AgentSprite

**Files:**
- Modify: `web/src/canvas/agents.ts:20-34`

- [ ] **Step 1: Add motion types and extend AgentSprite**

After the existing `AgentStatus` type (line 20), add:

```typescript
export type AgentMovementState = "SITTING" | "WALKING" | "AT_DESTINATION";

export type AgentMotion = {
  state: AgentMovementState;
  path: { x: number; y: number }[];
  pathIndex: number;
  lerpProgress: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  destination: "whiteboard" | "coffee" | "desk";
  stateTimer: number;
  idleTimer: number;
  homeDeskX: number;
  homeDeskY: number;
};
```

Then add `motion` to the `AgentSprite` type:

```typescript
export type AgentSprite = {
  id: string;
  name: string;
  role: string;
  container: Container;
  bubble: Container | null;
  bubbleTimeout: ReturnType<typeof setTimeout> | null;
  deskIndex: number;
  status: AgentStatus;
  animSprite: AnimatedSprite | null;
  zzzContainer: Container | null;
  zzzInterval: ReturnType<typeof setInterval> | null;
  motion: AgentMotion;
};
```

- [ ] **Step 2: Add imports for pathfinding and office**

At the top of agents.ts, add to the existing import from `"./office"`:

Change:
```typescript
import { TILE, DESK_POSITIONS } from "./office";
```
To:
```typescript
import { TILE, DESK_POSITIONS, collisionGrid, POI, OFFICE_W, OFFICE_H } from "./office";
```

Add a new import for pathfinding:

```typescript
import { findPath, type Point } from "./pathfinding";
```

- [ ] **Step 3: Initialize motion in addAgentSprite()**

In the `addAgentSprite()` function, update the `AgentSprite` object construction (around line 367) to include the `motion` field:

```typescript
  const sprite: AgentSprite = {
    id,
    name,
    role,
    container,
    bubble: null,
    bubbleTimeout: null,
    deskIndex,
    status: "active",
    animSprite,
    zzzContainer: null,
    zzzInterval: null,
    motion: {
      state: "SITTING",
      path: [],
      pathIndex: 0,
      lerpProgress: 0,
      fromX: container.x,
      fromY: container.y,
      toX: container.x,
      toY: container.y,
      destination: "desk",
      stateTimer: 0,
      idleTimer: 0,
      homeDeskX: desk.x,
      homeDeskY: desk.y,
    },
  };
```

- [ ] **Step 4: Commit**

```bash
git add web/src/canvas/agents.ts
git commit -m "feat: add AgentMotion state machine types to agent sprites"
```

---

### Task 3: Implement sprite switching (sit ↔ walk)

**Files:**
- Modify: `web/src/canvas/agents.ts`

- [ ] **Step 1: Add switchSprite function**

Add this function after the `getCharacterForAgent()` function (around line 171):

```typescript
function switchAgentSprite(agent: AgentSprite, mode: "sit" | "walk"): void {
  if (!agent.animSprite) return;

  const { characterName } = getCharacterForAgent(agent.id);
  const charTextures = characterTextureMap.get(characterName);
  if (!charTextures) return;

  const frames = mode === "walk" ? charTextures.walk : charTextures.sit;
  if (frames.length === 0) return;

  // Need at least 2 frames for AnimatedSprite
  const textures = frames.length === 1 ? [...frames, ...frames] : frames;
  agent.animSprite.textures = textures;

  if (mode === "walk") {
    agent.animSprite.animationSpeed = 0.15;
    agent.animSprite.play();
  } else {
    agent.animSprite.animationSpeed = 0.02;
    agent.animSprite.gotoAndStop(0);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/canvas/agents.ts
git commit -m "feat: add sit/walk sprite switching for agent movement"
```

---

### Task 4: Implement movement core (updateAgents, triggerAgentMove, notifyAgentActivity)

**Files:**
- Modify: `web/src/canvas/agents.ts`

This is the main logic. Add these functions before the `// Removal` section (before `removeAgentSprite`).

- [ ] **Step 1: Add helper and constants**

```typescript
// ---------------------------------------------------------------------------
// Movement system
// ---------------------------------------------------------------------------

const AGENT_TILES_PER_SECOND = 2;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const DESTINATION_DURATION_MS = { whiteboard: 8000, coffee: 6000 };

function tileToPixel(tx: number, ty: number): { px: number; py: number } {
  return { px: (tx + 0.5) * TILE, py: (ty + 0.5) * TILE };
}

function pixelToTile(px: number, py: number): { tx: number; ty: number } {
  return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) };
}
```

- [ ] **Step 2: Add triggerAgentMove function**

```typescript
export function triggerAgentMove(agentId: string, destination: "whiteboard" | "coffee"): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  if (agent.motion.state !== "SITTING") return; // Don't interrupt ongoing movement

  const target: Point = destination === "whiteboard" ? POI.WHITEBOARD : POI.COFFEE;
  const currentTile = pixelToTile(agent.container.x, agent.container.y);

  const path = findPath(
    collisionGrid,
    { x: currentTile.tx, y: currentTile.ty },
    target,
    OFFICE_W,
    OFFICE_H
  );

  if (!path || path.length === 0) return;

  agent.motion.path = path;
  agent.motion.pathIndex = 0;
  agent.motion.lerpProgress = 0;
  agent.motion.destination = destination;
  agent.motion.state = "WALKING";

  const from = { px: agent.container.x, py: agent.container.y };
  const to = tileToPixel(path[0].x, path[0].y);
  agent.motion.fromX = from.px;
  agent.motion.fromY = from.py;
  agent.motion.toX = to.px;
  agent.motion.toY = to.py;

  switchAgentSprite(agent, "walk");
}
```

- [ ] **Step 3: Add notifyAgentActivity function**

```typescript
export function notifyAgentActivity(agentId: string): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.motion.idleTimer = 0;
}
```

- [ ] **Step 4: Add updateAgents function**

```typescript
export function updateAgents(deltaMS: number): void {
  const dt = deltaMS / 1000; // seconds

  for (const [, agent] of agents) {
    const m = agent.motion;

    switch (m.state) {
      case "SITTING": {
        m.idleTimer += deltaMS;
        if (m.idleTimer >= IDLE_THRESHOLD_MS) {
          m.idleTimer = 0; // reset so it doesn't re-trigger immediately
          triggerAgentMove(agent.id, "coffee");
        }
        break;
      }

      case "WALKING": {
        m.lerpProgress += AGENT_TILES_PER_SECOND * dt;

        // Flip sprite based on horizontal direction
        if (agent.animSprite) {
          const dx = m.toX - m.fromX;
          if (dx < 0) {
            agent.animSprite.scale.x = -Math.abs(agent.animSprite.scale.x);
          } else if (dx > 0) {
            agent.animSprite.scale.x = Math.abs(agent.animSprite.scale.x);
          }
        }

        if (m.lerpProgress >= 1) {
          const current = m.path[m.pathIndex];
          const { px, py } = tileToPixel(current.x, current.y);
          agent.container.x = px;
          agent.container.y = py;
          agent.container.zIndex = 900 + current.y; // depth sort while preserving agent layer

          m.pathIndex++;

          if (m.pathIndex >= m.path.length) {
            // Arrived at destination
            if (m.destination === "desk") {
              // Back home — sit down
              m.state = "SITTING";
              switchAgentSprite(agent, "sit");
            } else {
              // At POI — idle for a while
              m.state = "AT_DESTINATION";
              m.stateTimer = DESTINATION_DURATION_MS[m.destination] || 6000;
              switchAgentSprite(agent, "sit"); // stand idle at destination
            }
          } else {
            // Continue to next tile
            const next = m.path[m.pathIndex];
            m.fromX = px;
            m.fromY = py;
            const nextPos = tileToPixel(next.x, next.y);
            m.toX = nextPos.px;
            m.toY = nextPos.py;
            m.lerpProgress = m.lerpProgress - 1;
          }
        } else {
          // Interpolate position
          agent.container.x = Math.round(m.fromX + (m.toX - m.fromX) * m.lerpProgress);
          agent.container.y = Math.round(m.fromY + (m.toY - m.fromY) * m.lerpProgress);
        }
        break;
      }

      case "AT_DESTINATION": {
        m.stateTimer -= deltaMS;
        if (m.stateTimer <= 0) {
          // Return home
          const home: Point = { x: m.homeDeskX, y: m.homeDeskY };
          const currentTile = pixelToTile(agent.container.x, agent.container.y);

          const path = findPath(
            collisionGrid,
            { x: currentTile.tx, y: currentTile.ty },
            home,
            OFFICE_W,
            OFFICE_H
          );

          if (path && path.length > 0) {
            m.path = path;
            m.pathIndex = 0;
            m.lerpProgress = 0;
            m.destination = "desk";
            m.state = "WALKING";

            m.fromX = agent.container.x;
            m.fromY = agent.container.y;
            const to = tileToPixel(path[0].x, path[0].y);
            m.toX = to.px;
            m.toY = to.py;

            switchAgentSprite(agent, "walk");
          } else {
            // Can't find path — teleport home
            const { px, py } = tileToPixel(m.homeDeskX, m.homeDeskY);
            agent.container.x = px;
            agent.container.y = py;
            m.state = "SITTING";
            switchAgentSprite(agent, "sit");
          }
        }
        break;
      }
    }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/agents.ts
git commit -m "feat: implement agent movement state machine with pathfinding"
```

---

### Task 5: Wire events and ticker in GameView

**Files:**
- Modify: `web/src/components/GameView.tsx`

- [ ] **Step 1: Import new functions from agents.ts**

In GameView.tsx, update the import from `@/canvas/agents`:

Find the existing import:
```typescript
import { addAgentSprite, removeAgentSprite, showSpeechBubble, ... } from "@/canvas/agents";
```

Add `updateAgents`, `triggerAgentMove`, `notifyAgentActivity`:

```typescript
import { addAgentSprite, removeAgentSprite, showSpeechBubble, setOnAgentClick, loadCharacterTextures, updateAgents, triggerAgentMove, notifyAgentActivity } from "@/canvas/agents";
```

(The exact import line depends on what's currently there — add the 3 new function names to the existing import.)

- [ ] **Step 2: Register updateAgents on the PixiJS ticker**

In the canvas initialization `useEffect` (around line 164), after `officeRef.current = office;` and the pending agents flush (around line 210), add the ticker:

```typescript
        // Agent movement tick
        app.ticker.add((ticker) => {
          updateAgents(ticker.deltaMS);
        });
```

- [ ] **Step 3: Wire artifact_created to triggerAgentMove**

In the `useCompanyEvents` handlers, find the `onArtifactCreated` handler. Add a `triggerAgentMove` call:

In the existing `onArtifactCreated` callback, after the `setFeedItems` call, add:

```typescript
      // Trigger agent to walk to whiteboard
      if (data.author_id) {
        triggerAgentMove(data.author_id as string, "whiteboard");
      }
```

Note: Check if `artifact_created` events include `author_id`. If they only include `author_name`, we need to look up the agent ID from the agents state. In that case:

```typescript
      const authorAgent = agentsRef.current.find(a => a.name === data.author_name);
      if (authorAgent) {
        triggerAgentMove(authorAgent.id, "whiteboard");
      }
```

- [ ] **Step 4: Wire message_posted to notifyAgentActivity**

In the `onMessage` handler (around line 58), after the `addToHistory` / `setFeedItems` call, add:

```typescript
      notifyAgentActivity(data.author_id as string);
```

- [ ] **Step 5: Verify in browser**

1. Open the Lyse company page
2. Agent sprites should appear sitting at desks
3. After 5 minutes of idle, an agent should walk to coffee
4. If an agent creates an artifact, they should walk to the whiteboard
5. Walking should use animated walk sprites
6. Speech bubbles should still appear correctly

- [ ] **Step 6: Commit**

```bash
git add web/src/components/GameView.tsx
git commit -m "feat: wire agent movement to ticker and WebSocket events"
```
