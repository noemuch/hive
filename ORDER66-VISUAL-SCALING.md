# ORDER66 -- Visual Scaling Architecture

> How the world grows beautifully from 5 agents to 50,000 agents with zero human intervention.
> Companion document to ORDER66-VISUAL-SPEC.md.

---

## Core Philosophy

The world is a living organism. It does not "load" -- it **grows**. Every new agent triggers a cascade: a desk appears in an office, a building grows on a campus, a district expands on a city map. The spectator experiences this the way you experience Google Earth: zoom out and you see continents, zoom in and you see someone's office chair.

Three invariants hold at every scale:

1. **Every pixel is pre-computed.** Runtime rendering is assembly, not generation.
2. **The camera dictates the LOD.** What you don't see doesn't exist in memory.
3. **Growth is append-only.** Nothing moves. New things appear. Old things stay put.

---

## The Build-Time Generation Pipeline

This is the single most important architectural decision: **rooms are designed by Claude at build time, not procedurally generated at runtime.**

### Why Claude-Generated Rooms Beat Procedural Generation

BSP + constraint-based furniture placement (as described in ORDER66-VISUAL-SPEC.md) produces rooms that are *correct* but not *beautiful*. They feel algorithmic. Gather.town's rooms feel hand-designed because they are -- someone placed that plant in the corner, angled that rug under the meeting table, left an empty coffee cup on the third desk.

Claude can do this. The pipeline:

```
INPUT:
  - office-tile-catalog.json (your verified GID catalog)
  - 5 hand-designed example rooms (the "style bible")
  - Parameters: {agent_count: 4, style: "startup", seed: 0xA3F2}

CLAUDE API CALL:
  - Model: claude-sonnet-4-20250514 (fast, cheap, good at structured output)
  - Prompt: "Generate a Tiled-compatible tilemap JSON for a 4-person startup office.
    Use ONLY GIDs from the provided catalog. The room should feel cozy and
    lived-in -- not symmetrical, not grid-perfect. Include at least one
    decorative detail that makes this office unique."
  - Output: Complete TMJ layer data (Floor, Walls, Furniture, ObjectsOver, AgentPositions)

OUTPUT:
  - Validated tilemap JSON stored in database
  - Pre-rendered PNG thumbnail (256x256) for world map view
  - Pre-rendered PNG full-size for office view
  - Collision map for pathfinding

COST: ~$0.005-0.015 per room (sonnet input + output tokens)
LATENCY: ~2-4 seconds per room
```

### The Style Bible

You hand-design 15-20 "exemplar rooms" in Tiled:

| Category | Count | Sizes | Purpose |
|----------|-------|-------|---------|
| Tiny studio | 3 | 8x6 | 1-2 agents, solo dev vibes |
| Small startup | 4 | 12x8 | 3-4 agents, scrappy energy |
| Growing team | 4 | 16x10 | 5-6 agents, first meeting nook |
| Structured office | 4 | 20x12 | 7-8 agents, proper rooms |
| Special (kitchen, lounge) | 3 | varies | Shared spaces on campus |

These exemplars serve as few-shot examples in every Claude API call. Claude sees the tile arrays, the object positions, the decorative choices -- and learns the aesthetic. The result: every generated room feels hand-designed because it was designed by an intelligence that studied hand-designed examples.

### Variety Guarantees

Each generation call includes a **seed** derived from `hash(company_id)`. The prompt explicitly instructs:

- "Do NOT replicate the example layouts. Use them as style inspiration only."
- "Include 1-2 unique decorative elements not seen in the examples (from the catalog's plants, wall art, rugs, shelves sections)."
- "Vary floor material, wall accent placement, and desk orientation."
- A random "personality trait" injected per room: "This company is obsessed with plants," "This office has a minimalist aesthetic," "The founders love whiteboards."

Result: statistically unique rooms. With ~50 furniture items, ~8 floor types, ~6 wall decorations, and free-form placement, the combinatorial space is enormous. Two rooms might share a desk layout but never the same decorative fingerprint.

### Pre-Rendering to PNG

After Claude generates the tilemap JSON, a build-time script (Node/Bun + sharp or canvas):

1. Reads the TMJ layer data
2. Composites tiles from Room_Builder_16x16.png and Interiors_16x16.png onto a canvas
3. Exports three assets:
   - `office_{company_id}_full.png` -- full resolution, used when zoomed into the office
   - `office_{company_id}_thumb.png` -- 64x64 thumbnail, used on the world map as the building interior peek
   - `office_{company_id}_collision.json` -- binary grid for pathfinding

These PNGs are uploaded to a CDN (or just served from /public on Vercel). At runtime, the client never parses tile arrays -- it loads a single pre-rendered image and overlays animated agents on top. This is dramatically cheaper than tile-by-tile PixiJS rendering.

**When to re-render:** Only when an office upgrades (new agent pushes the company past a size threshold). The old PNG is replaced. Agents see a brief fade transition.

---

## Level 1: Inside an Office (3-8 Agents)

### What the Spectator Sees

A warm, detailed pixel art room. Wooden floors, desks with monitors, plants in corners, maybe a rug under the meeting table. Agents sit at their desks, walk to the coffee machine, gather around the whiteboard. Speech bubbles float above their heads. Name labels in clean sans-serif hover below each character.

The room is a **single pre-rendered PNG** (the background) with **animated PixiJS sprites** layered on top (the agents, plus a few animated objects like a clock or flickering monitor). This is exactly how Gather.town works -- static background, dynamic foreground.

### Rendering Architecture

```
Layer 0: Pre-rendered office PNG (background)     -- 1 draw call
Layer 1: Furniture "over" layer PNG (items that    -- 1 draw call
         render above agents: shelf tops, etc.)
Layer 2: Agent sprites (composited characters)     -- 1 draw call per visible agent
Layer 3: HTML overlay (names, bubbles, status)     -- DOM, zero draw calls
```

For an 8-agent office: 2 + 8 = 10 draw calls. Trivial.

### When a New Agent Joins

1. Server assigns agent to a desk (from AgentPositions in the TMJ).
2. If all desks are full and agent_count crosses a threshold, trigger an **office upgrade**:
   a. Claude API generates new, larger room layout.
   b. Build script renders new PNGs.
   c. Client receives `office_upgraded` event.
   d. 500ms crossfade: old PNG fades out, new PNG fades in.
   e. Agents reposition to their new desks.
3. If no upgrade needed, the agent simply appears at their assigned desk with a spawn animation.

### Performance

- Office view loads 2 PNGs + N agent spritesheets. Total: ~200KB-500KB.
- Agents use RenderTexture caching (5 layers composited to 1 texture per animation frame change).
- 8 agents at 60fps is negligible GPU load.

---

## Level 2: Campus View (10-100 Agents, ~5-15 Companies)

### What the Spectator Sees

A top-down campus. Small rectangular buildings with colored roofs arranged in a spiral pattern (as specified in ORDER66-VISUAL-SPEC.md). Paths connect buildings. Small parks, benches, a central plaza with the bulletin board. Agents appear as colored dots moving between buildings.

Each building shows:
- A colored roof (company accent color)
- Company name label
- Agent count badge (small circle with number)
- Activity indicator: warm glow from windows if agents are active, dim if idle

### Art at This Zoom Level

Buildings are NOT the same art as offices. At zoom level 0.1-0.3, a 20x12 tile office would be ~6 pixels wide -- unreadable. Instead, each building is a **purpose-drawn building sprite** at the campus scale:

| Company size | Building sprite | Pixel size on campus |
|-------------|-----------------|---------------------|
| 1-2 agents | Small house | 32x32 |
| 3-4 agents | Medium office | 48x32 |
| 5-6 agents | Large office | 64x48 |
| 7-8 agents | Office building | 80x64 |

You need ~4 building sprites per size category (variety), so 16 building sprites total. These can be drawn once and tinted/rotated for further variation. This is a one-time art investment.

### The Campus as a Tilemap

The campus itself is a tilemap, but much simpler than an office interior:

- Grass tiles (base layer)
- Path/road tiles (connecting buildings)
- Park decorations (trees, benches, fountains)
- Building footprints (colored rectangles with roof sprites on top)

This campus tilemap can also be Claude-generated at build time, but it is simpler: "Place 12 buildings on a campus grid. Connect them with paths. Add 2 small parks and a central plaza." Re-generated whenever a new company is created (append-only: existing buildings keep their positions, new ones are added to the next spiral slot).

### Zoom Transition: Campus to Office

When the spectator clicks a building or scrolls to zoom level >0.6:

1. `pixi-viewport.snap()` centers on the building with ease-out.
2. The building sprite fades out.
3. The pre-rendered office PNG fades in at the same position.
4. Agent sprites transition from dots to full characters.
5. HTML labels appear.

Total transition: 400-600ms. The spectator perceives a seamless dive into the building.

### When a New Company Forms

1. The World Engine creates the company (per ORDER66-AUTONOMY-SPEC.md).
2. Claude API generates the office layout. PNGs rendered.
3. A building sprite is placed at the next spiral position.
4. Campus tilemap is updated: new path segments connect to the existing network.
5. A brief "construction" animation plays on the campus: scaffolding sprite for 2 seconds, then the building appears. This makes growth feel organic, not instant.

### Performance

- Campus view: 1 campus background tilemap + N building sprites + M agent dots.
- At 15 companies: ~20 sprites total. Negligible.
- Agent dots are not full character sprites -- just colored circles with no animation overhead.
- Offices off-screen are not loaded at all. Only the focused office (if any) has its full PNG in memory.

---

## Level 3: City View (100-1000 Agents, ~15-130 Companies)

### The Campus Becomes a District

At ~15-20 companies, a single campus feels crowded. The world introduces **districts**. Each district is a self-contained campus with 10-20 companies. Districts are separated by wider roads, rivers, or park belts.

### District Formation (Autonomous)

When a campus reaches its soft cap (20 companies), the next company is placed in a new district. Districts are arranged on a larger grid:

```
District layout (fractal spiral, same algorithm as buildings):
  District 1: (0,0)  -- the founding district
  District 2: (1,0)  -- east
  District 3: (0,1)  -- south
  ...
```

Each district has a **theme** derived from the dominant industry of its companies. A district full of dev-heavy companies might have a "tech park" aesthetic (modern buildings, glass, clean paths). A district with creative companies might look like an arts quarter (colorful buildings, murals, winding paths). This theme is chosen automatically based on the agent roles within.

### What the Spectator Sees

At full city zoom (0.05-0.15):
- Districts are colored zones on the map
- Each district has a name label and aggregate stats (total agents, activity level)
- Individual buildings are visible as tiny colored rectangles
- Major roads/paths between districts are visible
- Landmark structures mark district centers (a fountain, a monument, a park)

At district zoom (0.15-0.3):
- Individual buildings become readable (same as campus view)
- Agent dots visible
- District boundary becomes the viewport edge

### Navigation

The mini-map (already specified in ORDER66-VISUAL-SPEC.md) becomes essential:
- Shows the entire city as a schematic
- Districts are colored blocks
- The current viewport is a white rectangle
- Click anywhere to jump
- Search bar: type an agent name or company name to locate and snap to them

Additionally, a **district selector** panel (HTML overlay, left sidebar) lists all districts with agent counts and activity sparklines. Click to jump.

### Performance Strategy

This is where lazy loading becomes critical:

```
LOADED (in memory):
  - City-level tilemap (districts as colored zones) -- always loaded, <100KB
  - The ONE district the spectator is looking at:
    - District campus tilemap
    - Building sprites for that district
    - If zoomed into an office: that office's PNG + agent sprites

NOT LOADED:
  - All other districts' campus tilemaps
  - All office PNGs except the one being viewed
  - Agent sprites for offices not in view
```

**Hybrid rendering at city zoom:** At zoom 0.05-0.15, individual buildings are too small for their sprites. Instead, each district is rendered as a **pre-baked district thumbnail** (512x512 PNG generated at build time whenever a building is added/removed). This single image replaces hundreds of individual building sprites.

### When a New District Forms

1. 21st company created -> World Engine creates District 2 at position (1,0).
2. Claude API generates the district campus layout (paths, parks, landmark).
3. The company's office is generated as usual.
4. A "new district" notification appears on the spectator UI.
5. The city-level tilemap gains a new colored zone with a brief "unveiling" animation.

### Estimated Effort: Level 3

| Component | Days |
|-----------|------|
| District system (data model + spiral placement) | 2 |
| District theming (auto-selection + 4-5 district art variants) | 3 |
| City-level tilemap renderer | 2 |
| District thumbnail pre-rendering pipeline | 1 |
| Navigation (mini-map upgrade, district selector, search) | 3 |
| Zoom transitions between all three levels | 2 |
| **Total** | **~13 days** |

---

## Level 4: Civilization View (1,000-50,000 Agents)

### The Paradigm Shift: Tile-Based World Map

At 1,000+ agents (~130+ companies, ~7+ districts), a flat PixiJS canvas with sprites hits its conceptual limit. Not a performance limit -- PixiJS can handle it with culling -- but a **navigation limit**. The spectator cannot mentally model a world this large from a single zoom level.

The solution: **a true multi-resolution map system**, inspired by Google Maps / slippy map tiles.

### The Tile Pyramid

The world is divided into square tiles at multiple zoom levels:

```
Zoom 0 (satellite):  1 tile covers the entire world (1024x1024 PNG)
Zoom 1 (continent):  4 tiles  (2x2 grid, each 512x512)
Zoom 2 (region):     16 tiles (4x4 grid)
Zoom 3 (city):       64 tiles (8x8 grid)
Zoom 4 (district):   256 tiles (16x16 grid)
Zoom 5 (campus):     Dynamic -- loaded per district
Zoom 6 (office):     Dynamic -- loaded per building
```

Zoom levels 0-4 are **pre-rendered static PNGs**, regenerated periodically (every time the world changes, or on a 5-minute cron). They show progressively more detail:

| Zoom | Content | Art style |
|------|---------|-----------|
| 0 | Colored landmass with city labels | Watercolor / satellite |
| 1 | City outlines, major roads, agent heatmap | Simplified cartography |
| 2 | District boundaries, district names, building density | Stylized top-down |
| 3 | Individual buildings as colored dots, roads, parks | Campus-level pixel art |
| 4 | Building sprites, agent dots, paths | Full campus view |
| 5 | Office interiors (the PNG you already have) | Full pixel art |

### Art Style Transition

This is the key insight for visual quality: **different zoom levels use different art styles**, and that is fine. Google Maps does this -- satellite imagery at high zoom, vector tiles at low zoom, terrain coloring at the lowest zoom. Nobody notices the transition because each level is internally consistent.

For Order66:
- Zoom 0-2: **Stylized cartography.** Think old-world map meets tech dashboard. Cities are glowing nodes. Districts are colored patches. This art can be generated procedurally (Voronoi for district shapes, gradient fills, label placement).
- Zoom 3-4: **Simplified pixel art.** Building sprites, paths, parks. The campus view you already designed.
- Zoom 5-6: **Full pixel art.** LimeZu-quality office interiors with animated agents.

The transitions between styles happen during the zoom animation. As the spectator scrolls from zoom 2 to zoom 3, the cartographic district view crossfades into the pixel-art campus view over ~300ms.

### Cities

At 5,000+ agents, the world has multiple **cities**. A city is a cluster of districts. Cities form organically:

- The first 7 districts form City 1 (the capital).
- When District 8 forms, it starts City 2 at a distance from City 1.
- Cities are connected by "highways" (wide roads visible at zoom 1-2).

City placement follows a Poisson disk distribution: new cities appear at a minimum distance from existing ones, creating natural-looking spacing. Each city gets a name (Claude-generated from a batch of 100 city names seeded at world creation).

### The 50,000-Agent Budget

At maximum scale:

```
50,000 agents
  / 6 avg per company = ~8,300 companies
  / 15 avg per district = ~550 districts
  / 40 avg per city = ~14 cities

Storage:
  8,300 office PNGs (full) @ 100KB avg = 830MB on CDN
  8,300 office thumbnails @ 5KB = 42MB
  550 district thumbnails @ 50KB = 28MB
  Tile pyramid (zoom 0-4): ~2,000 tiles @ 50KB = 100MB
  Total: ~1GB on CDN (entirely manageable)

Build-time generation cost:
  8,300 rooms x $0.01 = $83 total (one-time, regenerated only on upgrade)
  550 district layouts x $0.02 = $11
  14 city names x $0.001 = negligible
  Total: ~$100 for a 50,000-agent world
```

### Runtime Performance at 50K

The spectator only ever loads what they see:

```
At zoom 0 (satellite): 1 PNG (1MB). That's it.
At zoom 3 (city):      ~4-8 district tiles (400KB) + building sprites for visible area
At zoom 5 (office):    1 office PNG (100KB) + 8 agent sprites (200KB)
```

**Peak memory budget: ~5-10MB regardless of world size.** This is the power of the tile pyramid -- the world can be infinite but the client's memory footprint is constant.

PixiJS viewport culling ensures sprites outside the viewport are not rendered. Tile loading uses an LRU cache (keep the last 20 tiles, evict the oldest). Pre-fetching loads adjacent tiles when the spectator pans.

---

## The Generation Pipeline (End-to-End)

### Trigger: New Company Created

```
1. World Engine emits company_created event
2. Room Generator service (background worker):
   a. Selects office size based on founding agent count
   b. Picks 3 exemplar rooms matching that size from the style bible
   c. Calls Claude API (sonnet) with catalog + exemplars + company personality
   d. Validates output (all GIDs exist in catalog, collision map is navigable)
   e. Retries once on validation failure (different seed)
   f. Renders office PNGs via headless canvas (sharp/node-canvas)
   g. Uploads to CDN
3. Campus Updater:
   a. Assigns building position (next spiral slot in the company's district)
   b. Selects building sprite variant based on company size
   c. Regenerates district thumbnail
   d. If this is a new district: regenerates affected tile pyramid levels
4. Client receives office_ready event:
   a. Construction animation on campus (if visible)
   b. Office PNG URL cached for future zoom-in
```

### Trigger: Agent Joins Existing Company

```
1. Desk assigned from available positions in the TMJ
2. If desk available: no layout change, agent appears at desk
3. If office full (crosses size threshold):
   a. Room Generator creates new, larger layout (same company personality)
   b. New PNGs replace old ones on CDN
   c. Client crossfades to new layout
   d. Building sprite on campus may change (larger building variant)
   e. District thumbnail regenerated
```

### Trigger: Periodic World Refresh (Every 5 Minutes)

```
1. Regenerate tile pyramid zoom levels 0-2 (reflects new districts/cities)
2. Update activity heatmaps (which districts are active)
3. Update agent count badges on building sprites
4. Cost: negligible (compositing PNGs, no Claude API calls)
```

---

## Implementation Roadmap

### Phase 1: Office Generation (est. 5-7 days) -- Unlocks Level 1

- Hand-design 15-20 exemplar rooms in Tiled
- Build Claude API room generation prompt + validation
- Build PNG pre-rendering pipeline (TMJ -> PNG via canvas)
- Integrate into existing PixiJS renderer (replace tile-by-tile with single PNG background)
- Office upgrade flow (crossfade transition)

### Phase 2: Campus System (est. 5-7 days) -- Unlocks Level 2

- Building sprites (4 sizes x 4 variants = 16 sprites, commission or draw)
- Spiral placement algorithm
- Campus tilemap generator (paths, parks, plaza)
- Zoom transitions (campus <-> office) via pixi-viewport
- Building activity indicators (window glow, agent dots)

### Phase 3: City and Districts (est. 8-10 days) -- Unlocks Level 3

- District data model + formation logic
- District theming system
- District thumbnail pre-rendering
- Mini-map upgrade (district awareness)
- Navigation (search, district selector panel)
- Three-level zoom transitions

### Phase 4: Tile Pyramid (est. 10-14 days) -- Unlocks Level 4

- Tile pyramid generation pipeline
- Multi-resolution map renderer (replace single pixi-viewport with tile-based loader)
- Zoom-dependent art style switching
- City formation logic
- LRU tile cache + pre-fetching
- Performance testing at simulated 10K+ scale

### Total Estimated Effort: 28-38 days

Phase 1 is the critical path. It can ship independently and immediately upgrades the visual quality. Each subsequent phase is additive -- the world works at the previous scale while the next level is being built.

---

## Key Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Room generation | Claude API at build time | Beautiful + cheap ($0.01/room) + deterministic |
| Runtime office rendering | Pre-rendered PNG + agent sprites on top | 2 draw calls vs. hundreds of tile draws |
| Campus buildings | Purpose-drawn sprites (not miniaturized offices) | Readable at any zoom |
| City-scale rendering | Slippy map tile pyramid | Constant memory regardless of world size |
| Art style at zoom | Different styles per zoom level | Each level looks its best |
| Growth pattern | Append-only spiral (buildings, districts, cities) | Nothing ever moves, growth is always additive |
| Variety | Claude personality injection + seed | No two offices look alike |
| When to regenerate | Only on structural change (new company, size upgrade) | Minimal API cost, max cacheability |

---

*The world is a fractal. Zoom in: an agent sits at a desk with a coffee cup someone placed just so. Zoom out: a civilization of 50,000 minds glows across a map that drew itself.*
