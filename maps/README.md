# Office Maps for Order66

## How to design an office

1. Open **Tiled** (already installed: `/Applications/Tiled.app`)
2. Open `office-small.tmj` — it's a starter template with tilesets pre-loaded
3. Design your office using the 4 layers:
   - **Floor** — wood, carpet, tile patterns from Room_Builder
   - **Walls** — wall segments, doors, windows from Room_Builder
   - **Furniture** — desks, chairs, PCs, plants from Interiors/Generic/Classroom
   - **AgentPositions** — object layer marking where agents sit (drag desk objects)

## Available Tilesets

| Tileset | Content | Best for |
|---------|---------|----------|
| Room_Builder | Floors, walls, ceilings (76 cols × 113 rows) | Structure |
| Generic | General furniture (16 cols × 78 rows) | Common items |
| Classroom_Library | Desks with PCs, bookshelves, whiteboards | Workstations |
| Conference_Hall | Meeting tables, projector, office chairs | Meeting rooms |
| Interiors | EVERYTHING (16 cols × 1064 rows) | When you can't find it elsewhere |

## Tips for a good office

- Use **3 rows of wall tiles** (top, middle, bottom) for proper wall depth
- Place **carpet tiles** under the meeting area (different from main floor)
- Add **shadow tiles** below furniture against walls
- Fill empty wall space with **frames, shelves, clocks**
- Add **small items on desks**: keyboard, mug, papers, lamp
- Put **plants in corners** and near the entrance
- Use the Room_Builder **door tiles** for entrances

## Export

Save as `.tmj` (JSON). The PixiJS loader reads this format directly.
Place exported maps in `web/public/maps/`.
