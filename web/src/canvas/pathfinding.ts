import { TILE } from "./constants";

export type Point = { x: number; y: number };

export type TiledLayer = {
  type: "tilelayer" | "objectgroup" | "group";
  name: string;
  data?: number[];
  layers?: TiledLayer[];
  objects?: { name: string; type: string; x: number; y: number; width: number; height: number }[];
  visible: boolean;
  opacity: number;
  width?: number;
  height?: number;
};

export type TiledMap = {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: { firstgid: number; name?: string; columns?: number; tilecount?: number; image?: string; imagewidth?: number; imageheight?: number; source?: string }[];
  deskPositions?: { x: number; y: number }[];
};

// ---------------------------------------------------------------------------
// Collision grid extraction from Tiled map
// ---------------------------------------------------------------------------

function findLayer(layers: TiledLayer[], name: string): TiledLayer | null {
  for (const layer of layers) {
    if (layer.name === name) return layer;
    if (layer.type === "group" && layer.layers) {
      const found = findLayer(layer.layers, name);
      if (found) return found;
    }
  }
  return null;
}

/** Build a collision grid from Tiled map Collisions objectgroup.
 *  Returns grid[y][x] where true = blocked. */
export function buildCollisionGrid(mapData: TiledMap): boolean[][] {
  const w = mapData.width;
  const h = mapData.height;
  const grid: boolean[][] = Array.from({ length: h }, () => Array(w).fill(false));

  const collisions = findLayer(mapData.layers, "Collisions");
  if (collisions?.objects) {
    for (const obj of collisions.objects) {
      const startX = Math.floor(obj.x / TILE);
      const startY = Math.floor(obj.y / TILE);
      const endX = Math.ceil((obj.x + obj.width) / TILE);
      const endY = Math.ceil((obj.y + obj.height) / TILE);

      for (let ty = startY; ty < endY && ty < h; ty++) {
        for (let tx = startX; tx < endX && tx < w; tx++) {
          if (ty >= 0 && tx >= 0) {
            grid[ty][tx] = true;
          }
        }
      }
    }
  }

  // Block void tiles — positions with no floor tile are outside the office
  const floorLayer = findLayer(mapData.layers, "floor");
  if (floorLayer?.data) {
    for (let i = 0; i < floorLayer.data.length; i++) {
      if ((floorLayer.data[i] & 0x1FFFFFFF) === 0) {
        const tx = i % w;
        const ty = Math.floor(i / w);
        if (ty < h && tx < w) grid[ty][tx] = true;
      }
    }
  }

  // Block map edges — NPCs must never walk to boundary tiles
  for (let x = 0; x < w; x++) {
    grid[0][x] = true;
    grid[h - 1][x] = true;
  }
  for (let y = 0; y < h; y++) {
    grid[y][0] = true;
    grid[y][w - 1] = true;
  }

  return grid;
}

// ---------------------------------------------------------------------------
// A* pathfinding (4-direction, Manhattan heuristic)
// ---------------------------------------------------------------------------

const DIRS: Point[] = [
  { x: 0, y: -1 }, // up
  { x: 0, y: 1 },  // down
  { x: -1, y: 0 }, // left
  { x: 1, y: 0 },  // right
];

type AStarNode = {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: AStarNode | null;
};

/** Find a path from start to end on the collision grid.
 *  Returns array of tile coordinates (excluding start), or null if unreachable. */
export function findPath(
  grid: boolean[][],
  start: Point,
  end: Point,
  width: number,
  height: number
): Point[] | null {
  if (start.x === end.x && start.y === end.y) return [];
  if (end.x < 0 || end.x >= width || end.y < 0 || end.y >= height) return null;
  if (grid[end.y]?.[end.x]) return null; // destination blocked

  const key = (x: number, y: number) => y * width + x;

  const openList: AStarNode[] = [];
  const gScores = new Map<number, number>();
  const closed = new Set<number>();

  const startNode: AStarNode = {
    x: start.x,
    y: start.y,
    g: 0,
    f: Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
    parent: null,
  };

  openList.push(startNode);
  gScores.set(key(start.x, start.y), 0);

  while (openList.length > 0) {
    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[bestIdx].f) bestIdx = i;
    }
    const current = openList[bestIdx];
    openList.splice(bestIdx, 1);

    if (current.x === end.x && current.y === end.y) {
      // Reconstruct path (skip start)
      const path: Point[] = [];
      let node: AStarNode | null = current;
      while (node && !(node.x === start.x && node.y === start.y)) {
        path.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    const k = key(current.x, current.y);
    if (closed.has(k)) continue;
    closed.add(k);

    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (grid[ny][nx]) continue; // blocked
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const ng = current.g + 1;
      const existing = gScores.get(nk);
      if (existing !== undefined && ng >= existing) continue;

      gScores.set(nk, ng);
      const h = Math.abs(end.x - nx) + Math.abs(end.y - ny);
      openList.push({
        x: nx,
        y: ny,
        g: ng,
        f: ng + h,
        parent: current,
      });
    }
  }

  return null; // no path found
}

/** Pick a random walkable interior tile (1-tile margin from edges). */
export function randomWalkableTile(grid: boolean[][], width: number, height: number): Point | null {
  const walkable: Point[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!grid[y][x]) walkable.push({ x, y });
    }
  }
  if (walkable.length === 0) return null;
  return walkable[Math.floor(Math.random() * walkable.length)];
}
