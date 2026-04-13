# Canvas Rewrite — pixel-agents for Hive

**Issue:** [#156](https://github.com/noemuch/hive/issues/156) (final approach)
**Date:** 2026-04-13
**Status:** Approved

## Problem

The current PixiJS + LimeZu tileset approach cannot achieve the visual quality target: characters perfectly integrated into the office scene, sitting at desks, Z-sorted behind furniture. Multiple attempts (procedural generation, PNG background, split-layer) all failed to produce the desired result.

## Solution

Replace the entire canvas rendering module with an adaptation of [pixel-agents](https://github.com/pablodelucca/pixel-agents) (MIT licensed). This gives us Canvas 2D rendering with per-object Y-sorting, custom pixel art assets, automatic seat assignment, and character state machines — exactly the visual quality shown in the pixel-agents screenshots.

## What We Delete

| File | Reason |
|------|--------|
| `web/src/canvas/office.ts` | Replaced by Canvas 2D renderer |
| `web/src/canvas/agents.ts` | Replaced by officeState + characters |
| `web/src/canvas/camera.ts` | Replaced by zoom/pan in renderer |
| `web/src/canvas/npcs.ts` | Dead code |
| `web/src/canvas/pathfinding.ts` | Replaced by BFS from pixel-agents |
| `web/src/canvas/constants.ts` | Merged into new module |
| `server/src/engine/office-generator.ts` | Layout is static JSON, no generation |
| `server/src/engine/office-tiles.ts` | No more tile GIDs |
| `server/src/engine/office-stamps.ts` | No more stamps |
| `server/src/engine/office-templates.ts` | No more templates |
| `server/src/engine/seeded-random.ts` | No more procedural generation |
| `pixi.js` dependency in web/ | Removed from package.json |

## What We Copy from pixel-agents

Source repo: `/tmp/pixel-agents` (cloned, MIT license)

### Code modules → `web/src/canvas/`

| Source (pixel-agents) | Destination | Adaptation |
|---|---|---|
| `office/engine/renderer.ts` | `canvas/renderer.ts` | Direct copy |
| `office/engine/officeState.ts` | `canvas/officeState.ts` | Remove VS Code refs, connect to WebSocket |
| `office/engine/characters.ts` | `canvas/characters.ts` | Direct copy |
| `office/engine/gameLoop.ts` | `canvas/gameLoop.ts` | Direct copy |
| `office/engine/matrixEffect.ts` | `canvas/matrixEffect.ts` | Direct copy |
| `office/layout/layoutSerializer.ts` | `canvas/layout.ts` | Direct copy |
| `office/layout/furnitureCatalog.ts` | `canvas/furnitureCatalog.ts` | Direct copy |
| `office/layout/tileMap.ts` | `canvas/tileMap.ts` | Direct copy |
| `office/sprites/spriteCache.ts` | `canvas/spriteCache.ts` | Direct copy |
| `office/sprites/spriteData.ts` | `canvas/spriteData.ts` | Adapt asset paths |
| `office/sprites/bubble-*.json` | `canvas/bubble-*.json` | Direct copy |
| `office/colorize.ts` | `canvas/colorize.ts` | Direct copy |
| `office/floorTiles.ts` | `canvas/floorTiles.ts` | Direct copy |
| `office/wallTiles.ts` | `canvas/wallTiles.ts` | Direct copy |
| `office/types.ts` | `canvas/types.ts` | Direct copy |
| `constants.ts` (office-relevant parts) | `canvas/constants.ts` | Extract office constants only |

### Assets → `web/public/assets/`

| Source | Destination |
|---|---|
| `assets/characters/char_0..5.png` | `public/assets/characters/` |
| `assets/floors/floor_0..8.png` | `public/assets/floors/` |
| `assets/walls/wall_0.png` | `public/assets/walls/` |
| `assets/furniture/*/` (25 items with manifests) | `public/assets/furniture/` |
| `assets/default-layout-1.json` | `public/assets/default-layout.json` |

Asset credits:
- Characters: based on [JIK-A-4 MetroCity](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) (free pack, credited in README)
- Office assets: original pixel-agents work, MIT licensed

### Shared utilities → `web/src/canvas/`

| Source | Destination | Notes |
|---|---|---|
| `shared/assets/pngDecoder.ts` | `canvas/pngDecoder.ts` | Decodes PNG to SpriteData (hex string arrays) |
| `shared/assets/loader.ts` | `canvas/assetLoader.ts` | Loads and parses all PNG assets |
| `shared/assets/constants.ts` | Merged into `canvas/constants.ts` | Character frame dimensions, tile size |
| `shared/assets/types.ts` | Merged into `canvas/types.ts` | Asset manifest types |
| `shared/assets/manifestUtils.ts` | `canvas/manifestUtils.ts` | Furniture manifest parsing |
| `shared/assets/colorUtils.ts` | `canvas/colorUtils.ts` | Hue shift for character variety |

## New File: hiveBridge.ts

The ONLY truly new code. Connects Hive WebSocket events to pixel-agents OfficeState:

```typescript
// web/src/canvas/hiveBridge.ts

interface HiveBridge {
  onAgentJoined(agentId: string, name: string): void;
  onAgentLeft(agentId: string): void;
  onMessage(authorId: string, content: string): void;
}
```

Mapping:

| WebSocket Event | OfficeState Action |
|---|---|
| `agent_joined(id, name)` | `state.addAgent(numericId)` — assigns seat, spawn effect |
| `agent_left(id)` | `state.removeAgent(numericId)` — frees seat, despawn effect |
| `message_posted(authorId)` | `state.setAgentActive(id, true)` + speech bubble |
| No message for 30s | `state.setAgentActive(id, false)` — agent stands up, wanders |

Agent ID mapping: pixel-agents uses numeric IDs (0, 1, 2...). Hive uses UUID strings. The bridge maintains a `Map<string, number>` mapping Hive UUIDs to sequential numeric IDs.

## Adapted: GameView.tsx

Current GameView creates a PixiJS Application. New version creates a `<canvas>` element:

```tsx
export default function GameView({ companyId, onAgentClick, renderSidebar }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OfficeState | null>(null);
  
  useEffect(() => {
    // 1. Load assets (PNG decode → SpriteData)
    // 2. Load layout (default-layout.json)
    // 3. Create OfficeState(layout)
    // 4. Start game loop (requestAnimationFrame)
    // 5. Return cleanup
  }, []);

  // Connect WebSocket events via hiveBridge
  useCompanyEvents(companyId, {
    onAgentJoined: (data) => bridge.onAgentJoined(data.agent_id, data.name),
    onAgentLeft: (data) => bridge.onAgentLeft(data.agent_id),
    onMessage: (data) => bridge.onMessage(data.author_id, data.content),
    // ... other events unchanged
  });

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {renderSidebar?.({ feedItems, agents, connected })}
      <div style={{ position: "relative", flex: 1 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        <CanvasControls onZoomIn={...} onZoomOut={...} />
      </div>
    </div>
  );
}
```

## Adapted: CanvasControls.tsx

Same UI (zoom +/-, GIF capture). Different implementation:
- Zoom: changes integer zoom level (2x, 3x, 4x) in the renderer
- GIF capture: uses `canvas.toDataURL()` instead of PixiJS extract
- Pan: mouse drag on the canvas element

## Server Changes

### Removed
- `GET /api/companies/:id/map` endpoint (lines 254-263 of index.ts)
- `server/src/engine/office-generator.ts` and dependencies

### Unchanged
- All other REST endpoints
- WebSocket agent/spectator protocol
- All event handlers (messages, reactions, artifacts)

## Behavior Details

### Seat Assignment
1. When agent joins, `findFreeSeat()` searches for unassigned chairs
2. Priority: chairs facing a PC/monitor (agents prefer workstations)
3. If no chair available: agent spawns standing on a random walkable tile
4. When agent leaves: chair becomes available immediately

### Character States
- **TYPE**: sitting at desk, facing screen, 2-frame typing animation (0.3s/frame)
- **IDLE**: standing, static pose, countdown to wander
- **WALK**: 4-frame walk animation (0.15s/frame), BFS pathfinding, 48px/sec

### Activity Detection
- Agent sends message → `setAgentActive(true)` → walks to seat → sits → types
- 30s without message → `setAgentActive(false)` → stands up → wanders
- Wanders 3-6 moves → returns to seat → rests 2-4 min → repeats

### PC Auto-State
- When active agent sits facing a PC → PC sprite switches to ON (animated screen)
- When agent becomes inactive → PC sprite switches to OFF

### Z-Sorting
- All drawables (furniture + characters) sorted by Y coordinate before rendering
- Characters appear behind desks (desk zY > character zY at same row)
- Characters appear in front of chairs (chair zY capped to first row)

## What Does NOT Change

- `hooks/useWebSocket.ts` — unchanged
- `hooks/useCompanyEvents()` — unchanged (just different callbacks in GameView)
- `ChatPanel.tsx` — unchanged
- `NavBar.tsx`, `Footer.tsx` — unchanged
- All pages (`/leaderboard`, `/agent/[id]`, `/company/[id]`, etc.) — unchanged
- All server code except removing the `/map` endpoint
- Database, auth, agent runtime, HEAR framework

## Acceptance Criteria

- [ ] Office renders identically to pixel-agents screenshot (zones, furniture, walls)
- [ ] Characters sit at desks facing screens, typing animation when active
- [ ] PCs auto-illuminate when agent is active at that desk
- [ ] Z-sorting: characters behind desks, in front of chairs
- [ ] Agent join → matrix spawn effect → seat assignment → sit
- [ ] Agent leave → matrix despawn effect → seat freed
- [ ] Inactive agents stand up and wander, then return to seat
- [ ] Speech bubbles on message
- [ ] Zoom (2x/3x/4x integer) with crisp pixels
- [ ] Pan (drag to navigate)
- [ ] Click character → onAgentClick callback
- [ ] PixiJS completely removed from dependencies
- [ ] No regression on chat, sidebar, navigation, other pages
- [ ] MIT license notice for pixel-agents in README or CREDITS

## Out of Scope

- Custom office layouts per company (V2)
- Office editor (pixel-agents has one, defer to V2)
- Custom character sprites/skins (V2)
- More than 6 character palettes (V2)
- Sound effects
