# Canvas Gather-Inspired UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Gather-inspired overlays to the company canvas: pill-shaped name labels, a minimap with agent dots, and floating zoom controls.

**Architecture:** Name labels are rewritten in PixiJS (agents.ts). Minimap and zoom controls are React components absolutely positioned over the canvas. Camera.ts is extended to expose viewport state and control methods. GameView mounts the new overlays.

**Tech Stack:** PixiJS 8 (Graphics, Text), React components, pixi-viewport, shadcn/ui (for DropdownMenu), Tailwind CSS

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/canvas/agents.ts` | Modify | Replace name label + role badge with pill badge |
| `web/src/canvas/camera.ts` | Modify | Export viewport ref, add zoomIn/zoomOut/panTo methods |
| `web/src/components/CanvasMinimap.tsx` | Create | Minimap overlay with walls + agent dots + viewport rect |
| `web/src/components/CanvasControls.tsx` | Create | Zoom +/- buttons + minimap toggle |
| `web/src/components/GameView.tsx` | Modify | Mount overlays, pass viewport state + agents |

---

### Task 1: Rewrite name labels as pill badges

**Files:**
- Modify: `web/src/canvas/agents.ts:297-357`

Replace the current name label block (monospace text + black rect + role badge) with a single Gather-style pill.

- [ ] **Step 1: Replace the name label + role badge section**

In `web/src/canvas/agents.ts`, find the section starting at line 297:
```typescript
  // --- Name label with dark semi-transparent background style ---
```

And ending with line 357:
```typescript
  container.addChild(roleBadge);
```

Replace this entire block (lines 297-357) with:

```typescript
  // --- Pill name label (Gather-style) ---
  const pillFontSize = 7;
  const pillPadH = 6;
  const pillPadV = 3;
  const dotRadius = 3;
  const dotGap = 4;
  const arrowSize = 4;

  const nameLabel = new Text({
    text: name,
    style: new TextStyle({
      fontSize: pillFontSize,
      fontFamily: "Inter, system-ui, sans-serif",
      fill: 0xffffff,
      fontWeight: "500",
    }),
  });
  nameLabel.anchor.set(0, 0.5);

  // Measure pill dimensions
  const textWidth = name.length * (pillFontSize * 0.55);
  const pillWidth = dotRadius * 2 + dotGap + textWidth + pillPadH * 2;
  const pillHeight = pillFontSize + pillPadV * 2;
  const pillY = -38; // above 32px character sprite

  // Pill background
  const pillBg = new Graphics();
  pillBg.roundRect(-pillWidth / 2, pillY, pillWidth, pillHeight, pillHeight / 2);
  pillBg.fill({ color: 0x1a1a2e, alpha: 0.92 });
  container.addChild(pillBg);

  // Arrow pointing down to agent
  const arrowX = 0;
  const arrowY = pillY + pillHeight;
  const arrow = new Graphics();
  arrow.moveTo(arrowX - arrowSize, arrowY);
  arrow.lineTo(arrowX, arrowY + arrowSize);
  arrow.lineTo(arrowX + arrowSize, arrowY);
  arrow.closePath();
  arrow.fill({ color: 0x1a1a2e, alpha: 0.92 });
  container.addChild(arrow);

  // Green status dot
  const dotX = -pillWidth / 2 + pillPadH + dotRadius;
  const dotY = pillY + pillHeight / 2;
  const dot = new Graphics();
  dot.circle(dotX, dotY, dotRadius);
  dot.fill(0x22c55e);
  container.addChild(dot);

  // Name text (positioned after dot)
  nameLabel.x = dotX + dotRadius + dotGap - pillWidth / 2 + pillPadH + dotRadius + dotGap;
  nameLabel.x = -pillWidth / 2 + pillPadH + dotRadius * 2 + dotGap;
  nameLabel.y = pillY + pillHeight / 2;
  container.addChild(nameLabel);
```

- [ ] **Step 2: Verify visually**

Open http://localhost:3001, navigate to Lyse company. Agent names should appear as dark rounded pills with a green dot on the left and a small arrow pointing to the sprite.

- [ ] **Step 3: Commit**

```bash
git add web/src/canvas/agents.ts
git commit -m "feat: replace agent name labels with Gather-style pill badges"
```

---

### Task 2: Extend camera with viewport state and controls

**Files:**
- Modify: `web/src/canvas/camera.ts`

The camera needs to expose: current viewport position/zoom (for minimap), and control methods (for zoom buttons).

- [ ] **Step 1: Add exported viewport ref and control methods**

Rewrite `web/src/canvas/camera.ts` to export a viewport handle:

At the top of the file, after the existing imports, add:

```typescript
export type ViewportState = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export type CameraHandle = {
  getViewport: () => ViewportState;
  zoomIn: () => void;
  zoomOut: () => void;
  panTo: (worldX: number, worldY: number) => void;
  resetZoom: () => void;
};

let currentHandle: CameraHandle | null = null;

export function getCameraHandle(): CameraHandle | null {
  return currentHandle;
}
```

Then at the end of the `setupCamera` function, before the cleanup return, add:

```typescript
  // Expose camera handle for React overlays
  currentHandle = {
    getViewport: () => ({
      x: viewport.left,
      y: viewport.top,
      width: viewport.screenWidth / viewport.scale.x,
      height: viewport.screenHeight / viewport.scale.y,
      scale: viewport.scale.x,
    }),
    zoomIn: () => {
      const newScale = Math.min(viewport.scale.x * 1.5, MAX_ZOOM);
      viewport.setZoom(newScale, true);
    },
    zoomOut: () => {
      const newScale = Math.max(viewport.scale.x * 0.67, MIN_ZOOM);
      viewport.setZoom(newScale, true);
    },
    panTo: (worldX: number, worldY: number) => {
      viewport.moveCenter(worldX, worldY);
    },
    resetZoom: () => {
      const screenW = app.screen.width;
      const screenH = app.screen.height;
      const fitScale = Math.min(screenW / bounds.width, screenH / bounds.height) * FIT_MARGIN;
      viewport.setZoom(fitScale, true);
      viewport.moveCenter(bounds.width / 2, bounds.height / 2);
    },
  };
```

And in the cleanup function, add `currentHandle = null;` before the viewport destroy.

- [ ] **Step 2: Commit**

```bash
git add web/src/canvas/camera.ts
git commit -m "feat: expose camera handle with viewport state and zoom controls"
```

---

### Task 3: Create CanvasControls component

**Files:**
- Create: `web/src/components/CanvasControls.tsx`

- [ ] **Step 1: Create the zoom controls component**

```tsx
"use client";

import { Plus, Minus, Map, RotateCcw } from "lucide-react";

type CanvasControlsProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleMinimap: () => void;
  onResetZoom: () => void;
  minimapVisible: boolean;
};

export function CanvasControls({
  onZoomIn,
  onZoomOut,
  onToggleMinimap,
  onResetZoom,
  minimapVisible,
}: CanvasControlsProps) {
  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col rounded-xl border bg-card overflow-hidden">
      <button
        onClick={onZoomIn}
        className="p-2.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
        title="Zoom in"
      >
        <Plus className="size-4" />
      </button>
      <div className="border-b" />
      <button
        onClick={onZoomOut}
        className="p-2.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
        title="Zoom out"
      >
        <Minus className="size-4" />
      </button>
      <div className="border-b" />
      <button
        onClick={onToggleMinimap}
        className={`p-2.5 transition-colors cursor-pointer ${minimapVisible ? "text-primary bg-muted/30" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"}`}
        title="Toggle minimap"
      >
        <Map className="size-4" />
      </button>
      <div className="border-b" />
      <button
        onClick={onResetZoom}
        className="p-2.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
        title="Reset zoom"
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/CanvasControls.tsx
git commit -m "feat: add CanvasControls overlay (zoom +/-, minimap toggle, reset)"
```

---

### Task 4: Create CanvasMinimap component

**Files:**
- Create: `web/src/components/CanvasMinimap.tsx`

- [ ] **Step 1: Create the minimap component**

```tsx
"use client";

import { useRef, useEffect, useCallback } from "react";
import type { ViewportState } from "@/canvas/camera";

type AgentDot = {
  x: number;
  y: number;
  color: string;
};

type CanvasMinimapProps = {
  collisionGrid: boolean[][];
  agents: AgentDot[];
  viewport: ViewportState | null;
  officeWidth: number;
  officeHeight: number;
  tileSize: number;
  onNavigate: (worldX: number, worldY: number) => void;
};

const MINIMAP_WIDTH = 200;
const WALL_COLOR = "#444";
const BG_COLOR = "#1a1a2e";
const VIEWPORT_COLOR = "rgba(255, 255, 255, 0.25)";
const VIEWPORT_BORDER = "rgba(255, 255, 255, 0.5)";

const ROLE_COLORS: Record<string, string> = {
  developer: "#4fc3f7",
  designer: "#f06292",
  pm: "#ffb74d",
  qa: "#81c784",
  ops: "#ce93d8",
  generalist: "#90a4ae",
};

export function CanvasMinimap({
  collisionGrid,
  agents,
  viewport,
  officeWidth,
  officeHeight,
  tileSize,
  onNavigate,
}: CanvasMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const minimapHeight = Math.round(MINIMAP_WIDTH * (officeHeight / officeWidth));
  const scaleX = MINIMAP_WIDTH / (officeWidth * tileSize);
  const scaleY = minimapHeight / (officeHeight * tileSize);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, MINIMAP_WIDTH, minimapHeight);

    // Draw walls
    ctx.fillStyle = WALL_COLOR;
    for (let y = 0; y < collisionGrid.length; y++) {
      for (let x = 0; x < (collisionGrid[y]?.length || 0); x++) {
        if (collisionGrid[y][x]) {
          ctx.fillRect(
            x * tileSize * scaleX,
            y * tileSize * scaleY,
            tileSize * scaleX + 0.5,
            tileSize * scaleY + 0.5
          );
        }
      }
    }

    // Draw agents
    for (const agent of agents) {
      ctx.fillStyle = agent.color;
      ctx.beginPath();
      ctx.arc(agent.x * scaleX, agent.y * scaleY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw viewport rectangle
    if (viewport) {
      ctx.strokeStyle = VIEWPORT_BORDER;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = VIEWPORT_COLOR;
      const vx = viewport.x * scaleX;
      const vy = viewport.y * scaleY;
      const vw = viewport.width * scaleX;
      const vh = viewport.height * scaleY;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.strokeRect(vx, vy, vw, vh);
      ctx.setLineDash([]);
    }
  }, [collisionGrid, agents, viewport, minimapHeight, scaleX, scaleY, tileSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = mx / scaleX;
    const worldY = my / scaleY;
    onNavigate(worldX, worldY);
  }

  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-xl border bg-card p-2 cursor-pointer">
      <canvas
        ref={canvasRef}
        width={MINIMAP_WIDTH}
        height={minimapHeight}
        onClick={handleClick}
        className="rounded-lg"
      />
    </div>
  );
}

export { ROLE_COLORS };
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/CanvasMinimap.tsx
git commit -m "feat: add CanvasMinimap overlay with walls, agent dots, viewport rect"
```

---

### Task 5: Mount overlays in GameView

**Files:**
- Modify: `web/src/components/GameView.tsx`

- [ ] **Step 1: Add imports**

At the top of GameView.tsx, add:

```typescript
import { getCameraHandle } from "@/canvas/camera";
import { getAgents } from "@/canvas/agents";
import { collisionGrid, TILE, OFFICE_W, OFFICE_H } from "@/canvas/office";
import { CanvasControls } from "./CanvasControls";
import { CanvasMinimap, ROLE_COLORS } from "./CanvasMinimap";
import type { ViewportState } from "@/canvas/camera";
```

Note: `TILE`, `OFFICE_W`, `OFFICE_H` may already be imported from `@/canvas/office` via `createOffice`. Check existing imports and add only what's missing.

- [ ] **Step 2: Add state for minimap and viewport**

Inside the GameView component, add these state variables near the top:

```typescript
const [minimapVisible, setMinimapVisible] = useState(false);
const [viewportState, setViewportState] = useState<ViewportState | null>(null);
const [agentDots, setAgentDots] = useState<{ x: number; y: number; color: string }[]>([]);
```

- [ ] **Step 3: Add a ticker effect to sync viewport state**

After the canvas initialization useEffect, add a new effect that reads camera + agent positions every 500ms (not every frame — React doesn't need 60fps updates):

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    const handle = getCameraHandle();
    if (handle) {
      setViewportState(handle.getViewport());
    }

    const agentsMap = getAgents();
    const dots: { x: number; y: number; color: string }[] = [];
    for (const [, agent] of agentsMap) {
      dots.push({
        x: agent.container.x,
        y: agent.container.y,
        color: ROLE_COLORS[agent.role] || ROLE_COLORS.generalist,
      });
    }
    setAgentDots(dots);
  }, 500);

  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 4: Render overlays in the JSX**

Find where the canvas container div is returned in the JSX. It should be a div that wraps the canvas ref. Make it `relative` and add the overlays inside:

The GameView return should wrap its canvas area with a relative container. Find the existing structure and add the overlays. The pattern:

```tsx
<div className="relative flex-1">
  {/* existing canvas ref div */}
  <div ref={canvasRef} className="w-full h-full" />

  {/* Overlay controls */}
  <CanvasControls
    onZoomIn={() => getCameraHandle()?.zoomIn()}
    onZoomOut={() => getCameraHandle()?.zoomOut()}
    onToggleMinimap={() => setMinimapVisible((v) => !v)}
    onResetZoom={() => getCameraHandle()?.resetZoom()}
    minimapVisible={minimapVisible}
  />

  {/* Minimap */}
  {minimapVisible && (
    <CanvasMinimap
      collisionGrid={collisionGrid}
      agents={agentDots}
      viewport={viewportState}
      officeWidth={OFFICE_W}
      officeHeight={OFFICE_H}
      tileSize={TILE}
      onNavigate={(x, y) => getCameraHandle()?.panTo(x, y)}
    />
  )}
</div>
```

Adapt this to the existing JSX structure — the key is that the overlays are siblings of the canvas div inside a `relative` container.

- [ ] **Step 5: Verify in browser**

1. Open Lyse company page
2. Zoom controls should appear bottom-right (4 buttons: +, -, map, reset)
3. Click + / - → canvas zooms in/out
4. Click map icon → minimap appears bottom-left
5. Minimap shows office walls as gray blocks, colored dots for agents
6. Dashed rectangle shows current viewport
7. Click on minimap → camera pans to that position
8. Click reset → camera centers on office

- [ ] **Step 6: Commit**

```bash
git add web/src/components/GameView.tsx
git commit -m "feat: mount CanvasControls + CanvasMinimap overlays in GameView"
```
