# Canvas Rewrite — pixel-agents for Hive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PixiJS canvas with pixel-agents' Canvas 2D renderer for pixel-perfect office visualization with Z-sorted characters sitting at desks.

**Architecture:** Copy pixel-agents' entire office rendering module (MIT licensed, ~5200 lines), adapt imports for flat structure in `web/src/canvas/`, create a bridge connecting Hive WebSocket events to pixel-agents' OfficeState, rewrite GameView.tsx for Canvas 2D.

**Tech Stack:** Canvas 2D (replaces PixiJS), React 19, Next.js 16, TypeScript, pixel-agents assets (MIT)

---

## File Structure

All new canvas files live in `web/src/canvas/` (flat structure, replacing current files):

| New File | Source | Responsibility |
|----------|--------|---------------|
| `canvas/types.ts` | pixel-agents `office/types.ts` + `shared/assets/types.ts` | All type definitions |
| `canvas/constants.ts` | pixel-agents `constants.ts` + `shared/assets/constants.ts` | All constants |
| `canvas/pngDecoder.ts` | pixel-agents `shared/assets/pngDecoder.ts` | Decode PNG → SpriteData |
| `canvas/colorUtils.ts` | pixel-agents `shared/assets/colorUtils.ts` | Hue shift utilities |
| `canvas/manifestUtils.ts` | pixel-agents `shared/assets/manifestUtils.ts` | Parse furniture manifests |
| `canvas/assetLoader.ts` | pixel-agents `shared/assets/loader.ts` | Load all PNG assets |
| `canvas/spriteCache.ts` | pixel-agents `office/sprites/spriteCache.ts` | Zoom-cached sprite rendering |
| `canvas/spriteData.ts` | pixel-agents `office/sprites/spriteData.ts` | Character sprite frame access |
| `canvas/colorize.ts` | pixel-agents `office/colorize.ts` | Colorize sprites (hue/sat/bright) |
| `canvas/floorTiles.ts` | pixel-agents `office/floorTiles.ts` | Floor tile rendering |
| `canvas/wallTiles.ts` | pixel-agents `office/wallTiles.ts` | Wall autotiling |
| `canvas/tileMap.ts` | pixel-agents `office/layout/tileMap.ts` | BFS pathfinding + walkable tiles |
| `canvas/furnitureCatalog.ts` | pixel-agents `office/layout/furnitureCatalog.ts` | Furniture catalog from manifests |
| `canvas/layout.ts` | pixel-agents `office/layout/layoutSerializer.ts` | Layout → tileMap + furniture + seats |
| `canvas/characters.ts` | pixel-agents `office/engine/characters.ts` | Character state machine + updates |
| `canvas/matrixEffect.ts` | pixel-agents `office/engine/matrixEffect.ts` | Spawn/despawn matrix rain effect |
| `canvas/renderer.ts` | pixel-agents `office/engine/renderer.ts` | Canvas 2D frame rendering |
| `canvas/gameLoop.ts` | pixel-agents `office/engine/gameLoop.ts` | requestAnimationFrame loop |
| `canvas/officeState.ts` | pixel-agents `office/engine/officeState.ts` | Office state manager (seats, characters) |
| `canvas/hiveBridge.ts` | **NEW** | Connect Hive WebSocket events → OfficeState |
| `components/GameView.tsx` | **REWRITE** | Canvas 2D instead of PixiJS |

Assets in `web/public/assets/`:
- `characters/char_0..5.png`
- `floors/floor_0..8.png`
- `walls/wall_0.png`
- `furniture/*/` (25 items with manifest.json + PNGs)
- `default-layout.json`

---

### Task 1: Copy Assets

**Files:**
- Create: `web/public/assets/` (entire directory tree)

- [ ] **Step 1: Copy all pixel-agents assets to the Hive web directory**

```bash
cd 

# Copy all assets
cp -r /tmp/pixel-agents/webview-ui/public/assets/ web/public/assets/

# Rename default layout
mv web/public/assets/default-layout-1.json web/public/assets/default-layout.json

# Verify structure
echo "Characters:" && ls web/public/assets/characters/
echo "Floors:" && ls web/public/assets/floors/
echo "Walls:" && ls web/public/assets/walls/
echo "Furniture:" && ls web/public/assets/furniture/ | head -10
echo "Layout:" && ls web/public/assets/default-layout.json
```

Expected: 6 character PNGs, 9 floor PNGs, 1 wall PNG, ~25 furniture dirs, 1 layout JSON.

- [ ] **Step 2: Commit**

```bash
git add web/public/assets/
git commit -m "feat(#156): copy pixel-agents assets (MIT licensed)"
```

---

### Task 2: Copy and Adapt Source Modules

**Files:**
- Create: 19 files in `web/src/canvas/`

This task copies ALL pixel-agents source files and rewrites imports for our flat structure. A script handles the bulk work.

- [ ] **Step 1: Copy source files with a mapping script**

```bash
cd 

# Remove old canvas files (keep directory)
rm -f web/src/canvas/office.ts web/src/canvas/agents.ts web/src/canvas/camera.ts web/src/canvas/npcs.ts web/src/canvas/pathfinding.ts web/src/canvas/constants.ts

PA="/tmp/pixel-agents"

# Copy with rename
cp "$PA/webview-ui/src/office/types.ts" web/src/canvas/types.ts
cp "$PA/webview-ui/src/office/colorize.ts" web/src/canvas/colorize.ts
cp "$PA/webview-ui/src/office/floorTiles.ts" web/src/canvas/floorTiles.ts
cp "$PA/webview-ui/src/office/wallTiles.ts" web/src/canvas/wallTiles.ts
cp "$PA/webview-ui/src/office/engine/renderer.ts" web/src/canvas/renderer.ts
cp "$PA/webview-ui/src/office/engine/officeState.ts" web/src/canvas/officeState.ts
cp "$PA/webview-ui/src/office/engine/characters.ts" web/src/canvas/characters.ts
cp "$PA/webview-ui/src/office/engine/gameLoop.ts" web/src/canvas/gameLoop.ts
cp "$PA/webview-ui/src/office/engine/matrixEffect.ts" web/src/canvas/matrixEffect.ts
cp "$PA/webview-ui/src/office/layout/layoutSerializer.ts" web/src/canvas/layout.ts
cp "$PA/webview-ui/src/office/layout/furnitureCatalog.ts" web/src/canvas/furnitureCatalog.ts
cp "$PA/webview-ui/src/office/layout/tileMap.ts" web/src/canvas/tileMap.ts
cp "$PA/webview-ui/src/office/sprites/spriteCache.ts" web/src/canvas/spriteCache.ts
cp "$PA/webview-ui/src/office/sprites/spriteData.ts" web/src/canvas/spriteData.ts
cp "$PA/shared/assets/pngDecoder.ts" web/src/canvas/pngDecoder.ts
cp "$PA/shared/assets/loader.ts" web/src/canvas/assetLoader.ts
cp "$PA/shared/assets/manifestUtils.ts" web/src/canvas/manifestUtils.ts
cp "$PA/shared/assets/colorUtils.ts" web/src/canvas/colorUtils.ts

# Copy sprite bubble data
cp "$PA/webview-ui/src/office/sprites/bubble-permission.json" web/src/canvas/
cp "$PA/webview-ui/src/office/sprites/bubble-waiting.json" web/src/canvas/
```

- [ ] **Step 2: Create constants.ts by merging both constant files**

Read both constant files from pixel-agents and merge them:
- `webview-ui/src/constants.ts` (135 lines — office rendering constants)
- `shared/assets/constants.ts` (19 lines — PNG parsing, character frame dimensions)

Create `web/src/canvas/constants.ts` that combines both. Read both files from the pixel-agents repo and merge them into one file. The shared constants should come first, then the webview constants. Remove any VS Code-specific imports (like `ColorValue` from components — re-export from types.ts instead).

- [ ] **Step 3: Fix all imports with a sed script**

All files are now in `web/src/canvas/` (flat). Fix all relative imports to point to siblings:

```bash
cd web/src/canvas

# Fix imports from nested paths to flat siblings
for f in *.ts *.tsx; do
  [ -f "$f" ] || continue
  # ../../constants.js → ./constants.js
  sed -i '' "s|from '../../constants.js'|from './constants.js'|g" "$f"
  # ../types.js → ./types.js
  sed -i '' "s|from '../types.js'|from './types.js'|g" "$f"
  # ../colorize.js → ./colorize.js
  sed -i '' "s|from '../colorize.js'|from './colorize.js'|g" "$f"
  # ../floorTiles.js → ./floorTiles.js
  sed -i '' "s|from '../floorTiles.js'|from './floorTiles.js'|g" "$f"
  # ../wallTiles.js → ./wallTiles.js
  sed -i '' "s|from '../wallTiles.js'|from './wallTiles.js'|g" "$f"
  # ../sprites/spriteCache.js → ./spriteCache.js
  sed -i '' "s|from '../sprites/spriteCache.js'|from './spriteCache.js'|g" "$f"
  # ../sprites/spriteData.js → ./spriteData.js
  sed -i '' "s|from '../sprites/spriteData.js'|from './spriteData.js'|g" "$f"
  # ../layout/furnitureCatalog.js → ./furnitureCatalog.js
  sed -i '' "s|from '../layout/furnitureCatalog.js'|from './furnitureCatalog.js'|g" "$f"
  # ../layout/layoutSerializer.js → ./layout.js
  sed -i '' "s|from '../layout/layoutSerializer.js'|from './layout.js'|g" "$f"
  # ../layout/tileMap.js → ./tileMap.js
  sed -i '' "s|from '../layout/tileMap.js'|from './tileMap.js'|g" "$f"
  # ./characters.js stays the same
  # ./matrixEffect.js stays the same
  # ./gameLoop.js stays the same
  # Remove .js extensions for Next.js/TypeScript
  sed -i '' "s|from '\./\([^']*\)\.js'|from './\1'|g" "$f"
done
```

- [ ] **Step 4: Fix asset loading paths in assetLoader.ts**

The pixel-agents loader (`shared/assets/loader.ts`) loads assets from file system paths (VS Code extension). We need to load from HTTP URLs. Read `web/src/canvas/assetLoader.ts` and adapt the `loadAssets()` function to:
1. Fetch PNGs from `/assets/characters/`, `/assets/floors/`, `/assets/walls/`, `/assets/furniture/`
2. Fetch `default-layout.json` from `/assets/default-layout.json`
3. Use `fetch()` + `arrayBuffer()` + the pngDecoder to parse PNGs into SpriteData
4. Use `fetch()` + `json()` to load furniture manifests and the layout

The adapted loader should export:
```typescript
export async function loadAllAssets(): Promise<{
  characters: SpriteData[][];  // [palette][frame]
  floors: SpriteData[];
  walls: SpriteData[];
  furniture: Map<string, FurnitureManifest>;
  layout: OfficeLayout;
}>
```

- [ ] **Step 5: Verify compilation**

```bash
cd web
bun run lint 2>&1 | grep "canvas/" | head -20
```

Fix any remaining import errors. Common issues:
- `ColorValue` type from `components/ui/types.ts` → define locally in `canvas/types.ts`
- VS Code-specific imports → remove or stub
- `.js` extension remnants → remove

- [ ] **Step 6: Commit**

```bash
git add web/src/canvas/
git commit -m "feat(#156): copy pixel-agents office modules, adapt imports for Hive"
```

---

### Task 3: Create hiveBridge.ts

**Files:**
- Create: `web/src/canvas/hiveBridge.ts`

This is the ONLY fully new file. It bridges Hive WebSocket events to pixel-agents OfficeState.

- [ ] **Step 1: Create hiveBridge.ts**

```typescript
// web/src/canvas/hiveBridge.ts

/**
 * Bridge between Hive WebSocket events and pixel-agents OfficeState.
 * Maps Hive agent UUIDs to sequential numeric IDs used by OfficeState.
 */

import type { OfficeState } from './officeState';

const INACTIVITY_TIMEOUT_MS = 30_000; // 30s without message → agent becomes inactive

export class HiveBridge {
  private state: OfficeState;
  private uuidToId = new Map<string, number>();
  private idToUuid = new Map<number, string>();
  private nextId = 0;
  private activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private onAgentClickCallback: ((agentId: string) => void) | null = null;

  constructor(state: OfficeState) {
    this.state = state;
  }

  /** Set callback for when a character is clicked */
  setOnAgentClick(cb: ((agentId: string) => void) | null): void {
    this.onAgentClickCallback = cb;
  }

  /** Handle click on character — translate numeric ID back to UUID */
  handleCharacterClick(numericId: number): void {
    const uuid = this.idToUuid.get(numericId);
    if (uuid && this.onAgentClickCallback) {
      this.onAgentClickCallback(uuid);
    }
  }

  /** Map a Hive UUID to a sequential numeric ID */
  private getOrCreateId(uuid: string): number {
    let id = this.uuidToId.get(uuid);
    if (id === undefined) {
      id = this.nextId++;
      this.uuidToId.set(uuid, id);
      this.idToUuid.set(id, uuid);
    }
    return id;
  }

  /** Called when an agent joins the company */
  onAgentJoined(agentId: string, _name: string): void {
    const id = this.getOrCreateId(agentId);
    this.state.addAgent(id);
  }

  /** Called when an agent leaves the company */
  onAgentLeft(agentId: string): void {
    const id = this.uuidToId.get(agentId);
    if (id === undefined) return;
    this.state.removeAgent(id);
    // Clean up activity timer
    const timer = this.activityTimers.get(agentId);
    if (timer) clearTimeout(timer);
    this.activityTimers.delete(agentId);
  }

  /** Called when an agent posts a message */
  onMessage(authorId: string): void {
    const id = this.uuidToId.get(authorId);
    if (id === undefined) return;

    // Mark agent as active (walks to seat, starts typing)
    this.state.setAgentActive(id, true);

    // Show speech bubble
    this.state.showWaitingBubble(id);

    // Reset inactivity timer
    const existing = this.activityTimers.get(authorId);
    if (existing) clearTimeout(existing);
    this.activityTimers.set(
      authorId,
      setTimeout(() => {
        const numId = this.uuidToId.get(authorId);
        if (numId !== undefined) {
          this.state.setAgentActive(numId, false);
        }
        this.activityTimers.delete(authorId);
      }, INACTIVITY_TIMEOUT_MS),
    );
  }

  /** Clean up all timers */
  destroy(): void {
    for (const timer of this.activityTimers.values()) {
      clearTimeout(timer);
    }
    this.activityTimers.clear();
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd web
bunx tsc --noEmit src/canvas/hiveBridge.ts 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add web/src/canvas/hiveBridge.ts
git commit -m "feat(#156): create HiveBridge — WebSocket events → OfficeState"
```

---

### Task 4: Rewrite GameView.tsx

**Files:**
- Rewrite: `web/src/components/GameView.tsx`

Replace the PixiJS-based GameView with Canvas 2D using pixel-agents' rendering pipeline.

- [ ] **Step 1: Rewrite GameView.tsx**

Read the current `web/src/components/GameView.tsx` to understand the interface it exposes (props, FeedItem type, AgentInfo type, useCompanyEvents usage). Then rewrite it to use Canvas 2D.

The key changes:
1. Remove all PixiJS imports (Application, Container, etc.)
2. Remove `createOffice`, `addAgentSprite`, `showSpeechBubble`, etc. imports
3. Replace with: `OfficeState`, `HiveBridge`, `loadAllAssets`, `renderFrame`, `createGameLoop`
4. Use a `<canvas>` element instead of PixiJS Application
5. Keep the EXACT same props interface and WebSocket event handling
6. Keep FeedItem and AgentInfo types exported

The canvas rendering loop:
```typescript
// In the useEffect that initializes the canvas:
const assets = await loadAllAssets();
const state = new OfficeState(assets.layout);
const bridge = new HiveBridge(state);

const canvas = canvasRef.current;
const ctx = canvas.getContext('2d');

// Game loop: update state + render frame
const loop = createGameLoop((dt) => {
  state.update(dt);
  renderFrame(ctx, canvas.width, canvas.height,
    state.tileMap, state.furniture, state.getCharacters(),
    zoom, panX, panY);
});
```

WebSocket events connect through the bridge:
```typescript
useCompanyEvents(companyId, {
  onMessage: (data) => {
    // Keep existing feed/bubble logic
    bridge.onMessage(data.author_id as string);
  },
  onAgentJoined: (data) => {
    // Keep existing agent tracking
    bridge.onAgentJoined(data.agent_id as string, data.name as string);
  },
  onAgentLeft: (data) => {
    bridge.onAgentLeft(data.agent_id as string);
  },
  // ... artifact events unchanged
});
```

Zoom controls:
```typescript
const [zoom, setZoom] = useState(3); // integer zoom (2x, 3x, 4x)
// Zoom in/out changes the integer zoom level
// Pan handled by mouse drag on canvas
```

- [ ] **Step 2: Adapt CanvasControls**

Update `web/src/components/CanvasControls.tsx` if needed — the zoom callbacks are already generic (onZoomIn/onZoomOut). Just make sure they connect to the integer zoom state.

- [ ] **Step 3: Verify the web project compiles**

```bash
cd web
bun run lint 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/GameView.tsx
git commit -m "feat(#156): rewrite GameView.tsx for Canvas 2D rendering"
```

---

### Task 5: Remove Old Canvas Files + PixiJS + Server Generator

**Files:**
- Delete: old canvas files, server generator files
- Modify: `web/package.json` (remove pixi.js)
- Modify: `server/src/index.ts` (remove /map endpoint)

- [ ] **Step 1: Remove old files**

```bash
cd 

# Old server generator files (no longer needed — layout is static)
rm -f server/src/engine/office-generator.ts
rm -f server/src/engine/office-generator.test.ts
rm -f server/src/engine/office-tiles.ts
rm -f server/src/engine/office-stamps.ts
rm -f server/src/engine/office-templates.ts
rm -f server/src/engine/seeded-random.ts

# Old static map assets (replaced by pixel-agents assets)
rm -f web/public/maps/office-v1.png
rm -f web/public/maps/office-v1-bg.png
rm -f web/public/maps/office-v1-fg.png
rm -f web/public/maps/office-v1.json
```

- [ ] **Step 2: Remove PixiJS dependency**

```bash
cd web
bun remove pixi.js
```

- [ ] **Step 3: Remove the /api/companies/:id/map endpoint from server**

In `server/src/index.ts`, find and remove the block (around line 254):

```typescript
    // Generate office map for a company
    if (url.pathname.startsWith("/api/companies/") && url.pathname.endsWith("/map") && req.method === "GET") {
      ...
    }
```

Remove the entire if-block (~10 lines).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(#156): remove PixiJS, old canvas, server generator — replaced by pixel-agents"
```

---

### Task 6: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Create: `CREDITS.md` or update `README.md`

- [ ] **Step 1: Update CLAUDE.md**

Update the Canvas section:
```
- **Canvas:** Canvas 2D renderer adapted from pixel-agents (MIT), officeState.ts (seats + characters), hiveBridge.ts (WebSocket→OfficeState), BFS pathfinding, character state machine (TYPE/IDLE/WALK)
```

Update the Assets section to mention pixel-agents:
```
- **Assets:** pixel-agents office sprites (MIT) — 6 characters, 9 floors, 25 furniture, 1 wall autotile. Characters based on JIK-A-4 MetroCity pack.
```

Remove references to LimeZu tilesets, PixiJS, escape-room maps from the architecture table and key rules.

- [ ] **Step 2: Add credit notice**

Add to README.md or a new CREDITS.md:
```
## Credits

Office visualization adapted from [pixel-agents](https://github.com/pablodelucca/pixel-agents) by Pablo De Lucca (MIT License).
Character sprites based on [MetroCity](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) by JIK-A-4.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update for pixel-agents canvas rewrite, add credits"
```

---

### Task 7: Integration Test

- [ ] **Step 1: Start the server**

```bash
kill $(lsof -ti:3000) 2>/dev/null
cd server && bun run src/index.ts &
```

- [ ] **Step 2: Start the web dev server**

```bash
cd web && bun run dev
```

- [ ] **Step 3: Verify in browser**

Open the company page. Verify:
- [ ] Office renders with pixel-agents style (colored floor zones, furniture, walls)
- [ ] Characters appear when agents are connected (or use agent launcher)
- [ ] Characters sit at desks facing PCs
- [ ] PCs illuminate when character is active
- [ ] Z-sorting: characters behind desk surfaces
- [ ] Speech bubbles appear when agents send messages
- [ ] Zoom controls work (integer 2x/3x/4x)
- [ ] Click on character triggers agent profile navigation
- [ ] Chat panel works normally
- [ ] No console errors

- [ ] **Step 4: Fix any issues found during testing**

Common issues to watch for:
- Asset loading paths (check browser Network tab for 404s)
- Canvas sizing (check if canvas fills the container properly)
- Zoom rendering (ensure `image-rendering: pixelated` on canvas)
- WebSocket connection (ensure agents appear when connected)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(#156): canvas rewrite complete — pixel-agents rendering for Hive

Replace PixiJS with Canvas 2D renderer from pixel-agents (MIT).
Characters sit at desks, Z-sorted behind furniture, with typing
animation and automatic seat assignment.

Closes #156"
```
