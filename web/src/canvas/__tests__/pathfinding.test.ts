import { describe, it, expect } from "bun:test";
import { buildCollisionGrid, randomWalkableTile } from "../pathfinding";
import type { TiledMap } from "../pathfinding";

// Helper : génère une TiledMap minimale avec des objets Collisions
function makeMap(w: number, h: number, objects: { x: number; y: number; width: number; height: number }[] = []): TiledMap {
  return {
    width: w,
    height: h,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      {
        type: "objectgroup",
        name: "Collisions",
        visible: true,
        opacity: 1,
        objects: objects.map((o) => ({ ...o, name: "", type: "" })),
      },
    ],
    tilesets: [],
  };
}

describe("buildCollisionGrid", () => {
  it("marks top edge (row 0) as blocked", () => {
    const map = makeMap(5, 5);
    const grid = buildCollisionGrid(map);
    for (let x = 0; x < 5; x++) {
      expect(grid[0][x]).toBe(true);
    }
  });

  it("marks bottom edge (row H-1) as blocked", () => {
    const map = makeMap(5, 5);
    const grid = buildCollisionGrid(map);
    for (let x = 0; x < 5; x++) {
      expect(grid[4][x]).toBe(true);
    }
  });

  it("marks left edge (col 0) as blocked", () => {
    const map = makeMap(5, 5);
    const grid = buildCollisionGrid(map);
    for (let y = 0; y < 5; y++) {
      expect(grid[y][0]).toBe(true);
    }
  });

  it("marks right edge (col W-1) as blocked", () => {
    const map = makeMap(5, 5);
    const grid = buildCollisionGrid(map);
    for (let y = 0; y < 5; y++) {
      expect(grid[y][4]).toBe(true);
    }
  });

  it("leaves interior tiles walkable when no Collision objects", () => {
    const map = makeMap(5, 5);
    const grid = buildCollisionGrid(map);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        expect(grid[y][x]).toBe(false);
      }
    }
  });

  it("still blocks collision objects on interior tiles", () => {
    const map = makeMap(5, 5, [{ x: 32, y: 32, width: 16, height: 16 }]);
    const grid = buildCollisionGrid(map);
    expect(grid[2][2]).toBe(true);
  });

  it("blocks interior tiles with no floor tile (GID=0 in floor layer)", () => {
    // 5x5 grid : seul le tile (2,2) a un sol, tout le reste est vide
    const floorData = Array(25).fill(0);
    floorData[2 * 5 + 2] = 1; // tile (2,2) a un sol (GID=1)

    const mapWithFloor: TiledMap = {
      width: 5,
      height: 5,
      tilewidth: 16,
      tileheight: 16,
      layers: [
        {
          type: "group",
          name: "background",
          visible: true,
          opacity: 1,
          layers: [
            {
              type: "tilelayer",
              name: "floor",
              visible: true,
              opacity: 1,
              data: floorData,
            },
          ],
        },
      ],
      tilesets: [],
    };

    const grid = buildCollisionGrid(mapWithFloor);

    // Tiles intérieurs sans sol → bloqués
    expect(grid[1][1]).toBe(true); // void à (x=1, y=1)
    expect(grid[1][3]).toBe(true); // void à (x=3, y=1)
    expect(grid[3][1]).toBe(true); // void à (x=1, y=3)

    // Tile intérieur AVEC sol → walkable
    expect(grid[2][2]).toBe(false); // sol à (x=2, y=2)
  });
});

describe("randomWalkableTile", () => {
  it("never returns a tile on row 0", () => {
    const grid: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
    for (let i = 0; i < 200; i++) {
      const t = randomWalkableTile(grid, 5, 5);
      if (t) expect(t.y).not.toBe(0);
    }
  });

  it("never returns a tile on row H-1", () => {
    const grid: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
    for (let i = 0; i < 200; i++) {
      const t = randomWalkableTile(grid, 5, 5);
      if (t) expect(t.y).not.toBe(4);
    }
  });

  it("never returns a tile on col 0", () => {
    const grid: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
    for (let i = 0; i < 200; i++) {
      const t = randomWalkableTile(grid, 5, 5);
      if (t) expect(t.x).not.toBe(0);
    }
  });

  it("never returns a tile on col W-1", () => {
    const grid: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
    for (let i = 0; i < 200; i++) {
      const t = randomWalkableTile(grid, 5, 5);
      if (t) expect(t.x).not.toBe(4);
    }
  });

  it("returns null when only edge tiles are walkable", () => {
    const grid: boolean[][] = [
      [false, false, false],
      [false, true,  false],
      [false, false, false],
    ];
    const t = randomWalkableTile(grid, 3, 3);
    expect(t).toBeNull();
  });

  it("returns interior tile when available", () => {
    const grid: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
    const t = randomWalkableTile(grid, 5, 5);
    expect(t).not.toBeNull();
    expect(t!.x).toBeGreaterThanOrEqual(1);
    expect(t!.x).toBeLessThanOrEqual(3);
    expect(t!.y).toBeGreaterThanOrEqual(1);
    expect(t!.y).toBeLessThanOrEqual(3);
  });
});
