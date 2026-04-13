# Random Office Generation — Design Spec

**Issue:** [#156](https://github.com/noemuch/hive/issues/156)
**Date:** 2026-04-13
**Status:** Approved

## Problem

All company offices look visually identical. `office.ts` picks from 10 static escape-room maps that share similar layouts. The `floor_plan` DB column and the existing procedural generator (`office-generator.ts`) are dead code.

## Solution

Rewrite the procedural office generator to produce unique, beautiful Tiled-compatible JSON maps using LimeZu 16x16 tilesets. Each company gets a deterministic layout based on its ID (seeded PRNG). The client fetches from the existing `/api/companies/:id/map` endpoint instead of loading static files.

## Architecture

```
Client (office.ts)
  -> GET /api/companies/:id/map
    -> Server: generateOffice(agentCount, companyId)
      -> Seeded PRNG (hash of companyId) for unique layout
      -> Returns { Tiled JSON, deskPositions, poi }
  -> Render via existing renderAllLayers() + buildAllTileTextures()
```

### Files Changed

| File | Change |
|------|--------|
| `server/src/engine/office-generator.ts` | Rewrite: LimeZu 16x16 GIDs, seed-based randomization, 3 office sizes |
| `web/src/canvas/office.ts` | Fetch API instead of static files, dynamic desk positions and POI |
| `server/src/index.ts` | Pass `companyId` to generator (line ~258) |

### Files Unchanged

- `renderAllLayers()` — works on any Tiled JSON
- `buildAllTileTextures()` — builds textures from tileset references
- `buildCollisionGrid()` — works on any Tiled JSON
- Agent sprite system — consumes `deskPositions`
- Camera system — adapts to `OFFICE_W * TILE * SCALE`

### Files Removed (from active use)

- `getRandomRoomIndex()` — deleted
- `DESK_POSITIONS` hardcoded array — replaced by API response
- `POI` hardcoded object — replaced by API response
- 10 escape-room JSON maps — remain in repo but no longer loaded

## Generator Design

### Seeded PRNG

Mulberry32 algorithm initialized with a hash of the companyId string. Every call to the generator with the same companyId produces the identical office layout.

### Office Sizes

| Size | Agent Count | Dimensions (tiles) | Desk Count | Meeting Room |
|------|-------------|---------------------|------------|-------------|
| Small | 1-3 | 20x15 | 3 | No |
| Medium | 4-6 | 30x18 | 6 | Yes (small) |
| Large | 7-8 | 40x23 | 8 | Yes (large) |

### Tilesets

Uses the same tilesets as escape-room maps (already served from `web/public/maps/escape-room/`):

- `room_builder.png` (256x224, 16 cols, firstgid=1) — walls, floors
- `office_items.png` (256x848, 16 cols, firstgid=225) — furniture, decorations

GIDs are reverse-engineered from existing escape-room maps.

### Layers

4 Tiled layers in the output:

1. **ground** — floor tiles (wood, carpet, tile zones)
2. **walls** — perimeter walls, door
3. **furniture** — desks, chairs, tables, computers, whiteboard, bookshelf, coffee machine, etc.
4. **foreground** — decorative overlays (plants tops, shelf tops)

### Randomized Elements (seed-controlled)

- **Desk cluster positions**: left/right/center column, variable row spacing
- **Meeting room position**: NE corner, NW corner, or center-right (medium/large only)
- **Floor zones**: random assignment of wood/carpet/tile to different areas
- **Decoration placement**: plants, bookshelves, printer, coffee machine — shuffled among valid positions
- **Door position**: bottom-center, bottom-left, or bottom-right

### Fixed Elements

- Walls on full perimeter
- Exactly 1 door
- Whiteboard against a wall
- Coffee machine in a corner (medium/large)
- Each desk has a chair and monitor

### Output Format

```typescript
interface GeneratedOffice {
  // Tiled-compatible fields
  width: number;
  height: number;
  tilewidth: 16;
  tileheight: 16;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  // Metadata for client
  deskPositions: { x: number; y: number }[];
  poi: {
    coffee: { x: number; y: number } | null;
    whiteboard: { x: number; y: number };
    door: { x: number; y: number };
  };
}
```

## Client Changes (office.ts)

### createOffice(app, companyId)

1. Fetch `GET ${API_URL}/api/companies/${companyId}/map`
2. Parse response as Tiled JSON
3. Set `OFFICE_W`, `OFFICE_H` from response dimensions
4. Build collision grid from response
5. Load tilesets (`room_builder.png`, `office_items.png`) — same as before
6. Call `renderAllLayers()` — unchanged
7. Export `deskPositions` and `poi` from response metadata

### Dynamic Exports

```typescript
// Before: hardcoded
export const DESK_POSITIONS = [{ x: 17, y: 9, dir: "front" }, ...];
export const POI = { COFFEE: { x: 21, y: 3 }, ... };

// After: populated from API response
export let deskPositions: { x: number; y: number }[] = [];
export let poi: { coffee: {...} | null; whiteboard: {...}; door: {...} } = ...;
```

### Fallback

If the API call fails, fall back to loading `escape-room-01.json` with hardcoded desk positions (same as current behavior).

### Tileset Loading

The tilesets are referenced in the API response JSON. `office.ts` already loads tilesets by iterating `mapData.tilesets` — but currently hardcodes `room_builder.png` and `office_items.png` paths. The new code reads tileset paths from the JSON response, resolving them relative to `/maps/escape-room/` (where the PNGs live).

## Server Changes (index.ts)

Line 254-263, the existing `/api/companies/:id/map` handler:

```typescript
// Before
const { generateOffice } = await import("./engine/office-generator");
return json(generateOffice(agentCount));

// After
const { generateOffice } = await import("./engine/office-generator");
return json(generateOffice(agentCount, companyId));
```

## Acceptance Criteria

- [ ] Each company has a visually distinguishable office layout
- [ ] Same companyId always produces the same office (deterministic)
- [ ] Different companies with the same agent count still look different (seed variation)
- [ ] Desk positions are dynamic (agents sit at generated desks)
- [ ] POI positions are dynamic (whiteboard, coffee machine)
- [ ] Collision grid works correctly (agents can't walk through walls/furniture)
- [ ] Fallback to escape-room-01 if API fails
- [ ] Office sizes scale with agent count (small/medium/large)

## Out of Scope

- Themed tilesets per company (V2 — use Theme_Sorter pack)
- Storing generated maps in DB (deterministic = no need)
- Modifying the 10 escape-room maps
- NPC movement/pathfinding (separate issue #145)
- Canvas preview thumbnails (separate issue #155)

## Credits

Tileset: [LimeZu Modern Interiors](https://limezu.itch.io) (paid license, credits required)
