# Office Generation V2 — Template Gallery + Detail Randomizer

**Issue:** [#156](https://github.com/noemuch/hive/issues/156) (continuation)
**Date:** 2026-04-13
**Status:** Approved

## Problem

V1 procedural generation produces sparse offices (15% furniture coverage) using a limited subset of tiles. The target is LimeZu showcase quality: dense furniture (60%+), internal walls creating zones, wall decorations on every surface, desk accessories, floor variety.

## Solution

Replace the procedural generator with a **template-based system**. 5 hand-crafted office templates using the Modern Office tileset, with seed-based detail randomization for per-company variety.

## Architecture

```
Modern Office tileset (drop-in replacement, same dimensions)
         |
    5 TEMPLATES (hand-crafted in code, LimeZu quality)
         |
    DETAIL RANDOMIZER (seed-based per company)
    - mirror horizontal (50%)
    - swap wall decorations
    - vary floor accent zones
    - randomize desk accessories
    - shuffle plant positions
         |
    Tiled JSON -> API -> office.ts (unchanged)
```

## Tileset Swap

Drop-in replacement — identical dimensions, same firstgid structure:

| File | Current | Replacement | Dimensions |
|------|---------|-------------|-----------|
| `office_items.png` | Old escape-room items | `Modern_Office_16x16.png` | 256x848 (16 cols, 53 rows) |
| `room_builder.png` | Old room builder | `Room_Builder_Office_16x16.png` | 256x224 (16 cols, 14 rows) |

67% of tiles are identical or similar between old and new. The GID structure (firstgid=1 for room_builder, firstgid=225 for office_items) is preserved.

## Templates

5 templates covering 3 size categories:

| Template | Tiles | Agents | Zones |
|----------|-------|--------|-------|
| `small-a` | 20x15 | 2-3 | Workspace + break corner |
| `medium-a` | 30x20 | 4-5 | 2 workspaces + meeting + break |
| `medium-b` | 30x20 | 4-5 | Open floor + manager office + break |
| `large-a` | 40x26 | 6-8 | Open floor rows + meeting + break + manager |
| `large-b` | 40x26 | 6-8 | L-shape + cubicles + meeting + reception |

Each template is a complete Tiled JSON with:
- 4 layers: `backdrop` (void), `floor` (wood/carpet/tile), `furniture` (walls + furniture), `Collisions` (objectgroup)
- `deskPositions[]` — one per agent slot
- `poi` — coffee, whiteboard, door positions
- `swappable` regions — positions where the detail randomizer can substitute tiles

### Template Composition Rules (from LimeZu reference analysis)

**Walls:** Multi-row depth (4 rows top, 2 rows bottom, 1 tile sides). Internal walls create zone boundaries.

**Desks:** Each workstation = desk (3x2) + chair (1x2) + monitor on desk + keyboard + 1-2 accessories (lamp, papers, mug). Desks face walls or cubicle dividers.

**Meeting Room:** Table (3x2 or 6x2) + chairs around + whiteboard on adjacent wall.

**Break Area:** Coffee machine + water cooler + small table + chairs + plants.

**Wall Decorations:** Every 3-4 tiles along walls: shelves, paintings, AC unit, clock, certificates, monitors. No bare wall stretches > 4 tiles.

**Floor:** Wood base + carpet zones under workstations + tile zones in break areas.

**Corners:** Always a plant, filing cabinet, or decorative item. Never empty.

**Density Target:** 60%+ of non-wall floor tiles covered by furniture or decoration.

## GID Catalog V2

Extend `office-tiles.ts` with Modern Office tile identifications:

Categories to catalog:
- Monitors (desktop, wall-mounted, with content)
- Keyboards, mice, desk lamps
- Desk accessories (papers, mugs, pen holders)
- Wall shelves (with books, with items)
- AC units, clocks, certificates
- Vending machines, water coolers
- Large plants (2x2, 2x3 in pots)
- Filing cabinets (1x2, 2x2)
- Printers/copiers (2x2)
- Reception desk, bench seating
- Carpet floor variants, tile floor variants

GIDs identified by visually reading `Modern_Office_16x16.png` sections.

## Detail Randomizer

Input: template JSON + companyId (seed)

Randomized per seed:
1. **Template selection**: among same-size templates (e.g., `medium-a` vs `medium-b`)
2. **Horizontal mirror**: 50% chance to flip the entire layout
3. **Desk accessories**: for each desk, pick 3-5 items from accessory pool
4. **Wall decorations**: shuffle positions of art/shelves/AC along walls
5. **Floor accent**: carpet zone position and color variant
6. **Plants**: shuffle between available corner/gap positions
7. **Clutter**: random small items in empty spots

Output: modified Tiled JSON (unique per company, deterministic per seed)

## Files Changed

| File | Action |
|------|--------|
| `web/public/maps/escape-room/office_items.png` | Replace with Modern_Office_16x16.png |
| `web/public/maps/escape-room/room_builder.png` | Replace with Room_Builder_Office_16x16.png |
| `server/src/engine/office-tiles.ts` | Rewrite: V2 GID catalog for Modern Office tileset |
| `server/src/engine/office-templates.ts` | Create: 5 template definitions |
| `server/src/engine/office-randomizer.ts` | Create: detail randomization logic |
| `server/src/engine/office-generator.ts` | Rewrite: template selector + randomizer |
| `server/src/engine/office-generator.test.ts` | Update tests |

**No client changes.** `office.ts`, `agents.ts`, `pathfinding.ts` are unchanged — they already handle any Tiled JSON from the API.

## Acceptance Criteria

- [ ] Modern Office tileset renders correctly (drop-in replacement verified)
- [ ] Each office has 60%+ furniture coverage (visually dense)
- [ ] Internal walls create distinct zones
- [ ] Each desk has monitor + chair + 2+ accessories
- [ ] All walls have decorations (no bare stretches > 4 tiles)
- [ ] Floor has carpet/tile zone variety
- [ ] Different companies get different layouts (template + detail variation)
- [ ] Same companyId always produces same office (deterministic)
- [ ] All desk positions and POI are within bounds and walkable
- [ ] Visual quality comparable to LimeZu Office Design reference GIFs

## Out of Scope

- Animated tiles
- Company-specific themes (V3)
- More than 5 templates (can be added later)
- WFC detail pass (researched, deferred to V3)
