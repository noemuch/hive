# Canvas Gather-Inspired UI — Design Spec

> **Date:** 2026-04-12
> **Inspiration:** Gather.town canvas UX
> **Scope:** 3 independent overlay components on the existing canvas

## Goal

Add three Gather-inspired UI overlays to the company canvas: redesigned agent name labels, a minimap, and zoom controls. All three float on top of the existing PixiJS canvas. No layout changes to header, sidebar, or chat panel.

## 1. Name Labels (PixiJS — agents.ts)

Replace the current monospace debug-style labels with Gather-style pill badges.

### Current
- Black rectangle background, monospace white text
- Role badge below (separate block, colored)
- Two stacked blocks per agent

### Target
- Single pill-shaped badge above agent sprite
- Dark background (`bg-card` equivalent: `0x1a1a2e` with 90% alpha)
- Rounded corners (fully rounded, capsule shape)
- Green dot (PulseDot) on the left inside the pill
- Agent name in Inter-style font (clean sans-serif, not monospace)
- Small triangle/arrow pointing down to the agent sprite
- No role displayed (clicking the agent opens the profile — role is there)
- Font size: 7px (readable when zoomed in, subtle when zoomed out)

### Interaction
- Click on the label or sprite → opens AgentProfile sheet (already implemented via `onAgentClick`)
- Cursor: pointer on hover

### Visual spec
```
     ╭──●─Nova──╮        ● = green dot (3px circle, #22c55e)
     ╰────┬─────╯        background: #1a1a2e at 90% alpha
          ╲╱              border-radius: fully rounded (pill)
         agent            arrow: 4px triangle pointing down
        sprite            font: sans-serif 7px, white, medium weight
```

## 2. Minimap (React overlay — new component)

A small overview map in the bottom-left corner of the canvas showing the entire office layout with agent positions.

### Visual spec
- Position: bottom-left of the canvas container, 16px from edges
- Size: ~200px wide, proportional height to office aspect ratio
- Background: `bg-card` with `rounded-xl border`
- Content:
  - Office walls/furniture rendered as simplified gray outlines (thin lines, no textures)
  - Each agent = a colored dot (4px circle, color from role palette)
  - Current viewport = dashed rectangle outline (`border-dashed border-muted-foreground/50`)
- Interaction:
  - Click on minimap → teleport camera to that position
  - Drag on minimap → pan camera in real-time
- The minimap reads the collision grid from `office.ts` to draw wall outlines
- Agent positions read from the `agents` Map in `agents.ts`
- Viewport rectangle computed from PixiJS camera/viewport position and zoom level

### Data flow
```
office.ts (collisionGrid) ─→ Minimap renders walls
agents.ts (getAgents())   ─→ Minimap renders dots
camera.ts (viewport)      ─→ Minimap renders viewport rect
user click on minimap      ─→ camera.ts pans to position
```

### Component
```tsx
<Minimap
  collisionGrid={collisionGrid}
  agents={agents}
  viewport={viewportRect}
  onNavigate={(x, y) => panCameraTo(x, y)}
/>
```

Rendered as a React component overlaid on the canvas via absolute positioning. Updated every frame via requestAnimationFrame or PixiJS ticker callback that syncs viewport position to React state.

## 3. Zoom Controls (React overlay — new component)

Floating vertical toolbar on the right side of the canvas with zoom and navigation buttons.

### Visual spec
- Position: bottom-right of the canvas container, 16px from edges
- Background: `bg-card` with `rounded-xl border`
- Buttons stacked vertically, divided by subtle `border-b`

### Buttons (top to bottom)
| Icon | Action |
|------|--------|
| `+` | Zoom in (scale × 1.5) |
| `−` | Zoom out (scale × 0.67) |
| `⊞` | Toggle minimap visibility |
| `···` | Menu: "Center on agents", "Reset zoom" |

### Styling
- Icons: `text-muted-foreground` (subtle gray)
- Hover: `hover:bg-muted/30`
- Active/pressed: `bg-muted/50`
- Size: 40px × 40px per button
- Gap: 0 (touching, divided by border)
- Consistent with shadcn design system

### Interaction
- Zoom buttons call existing camera zoom methods
- Minimap toggle shows/hides the Minimap component
- Menu uses shadcn `DropdownMenu`

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/canvas/agents.ts` | Modify | Rewrite name label rendering (pill badge + arrow) |
| `web/src/components/CanvasMinimap.tsx` | Create | Minimap React component |
| `web/src/components/CanvasControls.tsx` | Create | Zoom controls React component |
| `web/src/components/GameView.tsx` | Modify | Mount Minimap + Controls overlays, pass props |
| `web/src/canvas/camera.ts` | Modify | Export viewport position, expose panTo/zoomTo methods |

## What We Do NOT Change

- Header (OfficeHeader) — stays as-is
- Chat panel (ChatPanel) — stays as-is, #136 handles retractable
- Canvas layout — stays flex with chat on right
- Agent sprite rendering — #145 handles sprites (Thomas)
- Agent movement — #145 handles movement (Thomas)

## Acceptance Criteria

- [ ] Agent name labels are pill-shaped with green dot, no role badge, Inter font
- [ ] Clicking a label opens the agent profile sheet
- [ ] Minimap shows office outline + colored agent dots + viewport rectangle
- [ ] Clicking minimap teleports camera
- [ ] Zoom controls (+/-) change canvas zoom level
- [ ] Minimap toggle button shows/hides minimap
- [ ] All overlays use shadcn design tokens (bg-card, border, rounded-xl, hover:bg-muted/30)
- [ ] Overlays don't block canvas interaction (pointer-events managed correctly)
