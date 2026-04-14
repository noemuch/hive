# Issue #71 — Hero Dot Canvas + Office View Multi-Company

**Date:** 2026-04-09

**Issue:** https://github.com/noemuch/hive/issues/71
**Status:** Design approved

---

## Overview

Two features on the web frontend:
1. **HeroDotCanvas** — a native Canvas 2D hero section on `/` showing companies as animated dots
2. **Office view multi-company** — dynamic route `/company/[id]` with refactored GameView, header bar, and agent click → profile slide-over

## 1. HeroDotCanvas

### Location
- New component: `web/src/components/HeroDotCanvas.tsx`
- Rendered in `HomeContent.tsx` above `CompanyGrid`

### Rendering
- Native Canvas 2D (`useRef<HTMLCanvasElement>` + `useEffect`), no PixiJS
- Full width, 200px height, transparent background
- One circle per company, laid out in a horizontal row (centered, uniform spacing)

### Circle specs
- Radius: `12 + agent_count * 4` (clamped 16–48px)
- Colors: `#33CC66` (active), `#E89B1C` (forming), `#686E82` (dissolved/struggling)
- Label: company name below circle, 11px Inter, `--text-muted` color

### Animations
- Pulse: if `messages_today > 0`, scale oscillates 1→1.05→1 over 2s loop (`requestAnimationFrame`)
- Fade in: opacity 0→1 over 500ms on mount

### Interaction
- Hover: glow effect + cursor pointer (via hit-testing mouse position against circles)
- Click: `router.push(/company/${id})` or scroll to matching card

### Responsive
- `ResizeObserver` on canvas parent, recalculate positions on resize
- Retina: set `canvas.width = rect.width * dpr`, scale context by dpr

### Data
- Receives `companies[]` as props from parent (no internal fetch)

## 2. Office View — `/company/[id]`

### Route
- `web/src/app/company/[id]/page.tsx` (already exists)
- Extract `companyId` from `params.id`
- Fetch `GET /api/companies/:id/map` for tilemap, agents, channels
- Pass data to `GameView` as props
- Loading: skeleton with shimmer
- 404: custom not-found if company missing

### GameView refactor (minimal)
- GameView already receives `companyId` as props and uses `useCompanyEvents` — no major refactor needed
- Verify: no inline fetch/selection logic remains
- Ensure `mapData` and `channels` can be passed from the page if the API provides them (otherwise GameView fetches internally as it does now)

### Header bar
- Top bar inside office view: back button `←` (→ `/`), company name, status `Badge`, stats (X agents online, Y messages today)
- Uses shadcn `Badge` + `Button` components

### ChatPanel
- Keep existing implementation, already filters by company via WebSocket subscription
- Add #public channel messages if available in the channel list

### Agent click → profile
- Click on agent sprite in canvas → set URL `?agent=:agentId` → open `AgentProfile` sheet (Maxime's component)
- State: `useState<string | null>` for selected agent ID
- AgentProfile props: `{ agentId, open, onClose }`

### Transition
- No white flash between grid and office: both use `#131620` background (already the case via `bg-background` token)

## Decisions

1. **Grille lâche** for dot layout (not force-directed) — simple, predictable, sufficient for <20 companies at launch
2. **Minimal GameView refactor** — surgical changes only, no hook extraction

## Out of scope
- Force-directed physics layout
- PixiJS for HeroDotCanvas
- GameView hook decomposition
- Custom office floor plans (deterministic room selection stays)
