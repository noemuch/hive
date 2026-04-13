import {
  Container,
  Sprite,
  Assets,
  Texture,
  Rectangle,
  AnimatedSprite,
  TextureSource,
  Ticker,
} from "pixi.js";
import { TILE, OFFICE_W, OFFICE_H, collisionGrid, getPoi } from "./office";
import { findPath, randomWalkableTile, type Point } from "./pathfinding";

TextureSource.defaultOptions.scaleMode = "nearest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NPCState = "IDLE" | "WALKING" | "AT_DESTINATION";

type NPC = {
  container: Container;
  sprite: AnimatedSprite | Sprite;
  state: NPCState;
  tileX: number;
  tileY: number;
  path: Point[];
  pathIndex: number;
  lerpProgress: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  stateTimer: number; // seconds
  homeX: number;
  homeY: number;
  returningHome: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NPC_HOMES = [
  { x: 9, y: 5 },
  { x: 9, y: 8 },
  { x: 9, y: 11 },
  { x: 11, y: 5 },
  { x: 11, y: 8 },
  { x: 11, y: 11 },
  { x: 13, y: 5 },
  { x: 13, y: 8 },
];

const TILES_PER_SECOND = 3;

const npcs: NPC[] = [];

// ---------------------------------------------------------------------------
// Texture loading
// ---------------------------------------------------------------------------

const npcTextures: Texture[] = [];

async function loadNPCTextures(): Promise<void> {
  try {
    const sheet = await Assets.load(
      "/tilesets/limezu/characters/animated/Adam_idle_anim_16x16.png"
    );
    const source = sheet.source;
    const frameW = 16;
    const frameH = 32;
    const cols = Math.floor(source.width / frameW);
    for (let c = 0; c < Math.min(cols, 6); c++) {
      npcTextures.push(
        new Texture({
          source,
          frame: new Rectangle(c * frameW, 0, frameW, frameH),
        })
      );
    }
  } catch {
    // Fallback to circles
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tileToPixel(tx: number, ty: number): { px: number; py: number } {
  return { px: tx * TILE + TILE / 2, py: ty * TILE + TILE / 2 };
}

function pickDestination(_npc: NPC): Point | null {
  const roll = Math.random();
  let target: Point;

  if (roll < 0.3) {
    // Coffee
    target = getPoi().COFFEE;
  } else if (roll < 0.4) {
    // Whiteboard
    target = getPoi().WHITEBOARD;
  } else if (roll < 0.5) {
    // Wander to random walkable tile
    const wt = randomWalkableTile(collisionGrid, OFFICE_W, OFFICE_H);
    if (!wt) return null;
    target = wt;
  } else {
    // Stay idle
    return null;
  }

  return target;
}

function findValidHome(home: Point): Point {
  // If home tile is blocked, find nearest walkable tile
  if (!collisionGrid[home.y]?.[home.x]) return home;
  // Search in expanding radius
  for (let r = 1; r < 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = home.x + dx;
        const ny = home.y + dy;
        if (nx >= 0 && nx < OFFICE_W && ny >= 0 && ny < OFFICE_H && !collisionGrid[ny][nx]) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return home;
}

function startWalking(npc: NPC, target: Point): boolean {
  const path = findPath(
    collisionGrid,
    { x: npc.tileX, y: npc.tileY },
    target,
    OFFICE_W,
    OFFICE_H
  );

  if (!path || path.length === 0) return false;

  npc.path = path;
  npc.pathIndex = 0;
  npc.lerpProgress = 0;

  const from = tileToPixel(npc.tileX, npc.tileY);
  const to = tileToPixel(path[0].x, path[0].y);
  npc.fromX = from.px;
  npc.fromY = from.py;
  npc.toX = to.px;
  npc.toY = to.py;
  npc.state = "WALKING";

  return true;
}

// ---------------------------------------------------------------------------
// Spawn NPCs
// ---------------------------------------------------------------------------

export async function createNPCs(parent: Container): Promise<void> {
  await loadNPCTextures();

  // Use up to 8 homes, but only those that are walkable
  const validHomes = NPC_HOMES
    .slice(0, Math.min(NPC_HOMES.length, 6))
    .map(findValidHome);

  for (const home of validHomes) {
    const container = new Container();

    let sprite: AnimatedSprite | Sprite;

    if (npcTextures.length > 0) {
      const anim = new AnimatedSprite(npcTextures);
      anim.animationSpeed = 0.05;
      anim.anchor.set(0.5, 0.8);
      anim.alpha = 0.5;
      anim.play();
      sprite = anim;
    } else {
      const { Graphics } = await import("pixi.js");
      const g = new Graphics();
      g.circle(0, 0, TILE * 0.3);
      g.fill({ color: 0x999999, alpha: 0.4 });
      sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.alpha = 0.4;
      container.addChild(g);
    }

    container.addChild(sprite);

    const { px, py } = tileToPixel(home.x, home.y);
    container.x = px;
    container.y = py;
    container.zIndex = home.y; // depth sorting

    parent.addChild(container);

    npcs.push({
      container,
      sprite,
      state: "IDLE",
      tileX: home.x,
      tileY: home.y,
      path: [],
      pathIndex: 0,
      lerpProgress: 0,
      fromX: px,
      fromY: py,
      toX: px,
      toY: py,
      stateTimer: 3 + Math.random() * 5, // 3-8 seconds
      homeX: home.x,
      homeY: home.y,
      returningHome: false,
    });
  }

  // Animation loop
  Ticker.shared.add((ticker) => {
    const dt = ticker.deltaMS / 1000; // convert to seconds
    for (const npc of npcs) {
      updateNPC(npc, dt);
    }
  });
}

// ---------------------------------------------------------------------------
// Update loop
// ---------------------------------------------------------------------------

function updateNPC(npc: NPC, dt: number): void {
  switch (npc.state) {
    case "IDLE": {
      npc.stateTimer -= dt;
      if (npc.stateTimer <= 0) {
        const dest = pickDestination(npc);
        if (dest) {
          npc.returningHome = false;
          if (!startWalking(npc, dest)) {
            // Can't reach destination, try again later
            npc.stateTimer = 2 + Math.random() * 3;
          }
        } else {
          // Stay idle
          npc.stateTimer = 3 + Math.random() * 5;
        }
      }
      break;
    }

    case "WALKING": {
      // Advance lerp
      npc.lerpProgress += TILES_PER_SECOND * dt;

      // Flip sprite based on direction
      const dx = npc.toX - npc.fromX;
      if (dx < 0) {
        npc.sprite.scale.x = -Math.abs(npc.sprite.scale.x);
      } else if (dx > 0) {
        npc.sprite.scale.x = Math.abs(npc.sprite.scale.x);
      }

      if (npc.lerpProgress >= 1) {
        // Arrived at next tile in path
        const current = npc.path[npc.pathIndex];
        npc.tileX = current.x;
        npc.tileY = current.y;
        npc.container.zIndex = current.y; // depth sorting

        const { px, py } = tileToPixel(current.x, current.y);
        npc.container.x = px;
        npc.container.y = py;

        npc.pathIndex++;

        if (npc.pathIndex >= npc.path.length) {
          // Arrived at final destination
          if (npc.returningHome) {
            npc.state = "IDLE";
            npc.stateTimer = 3 + Math.random() * 5;
          } else {
            npc.state = "AT_DESTINATION";
            npc.stateTimer = 2 + Math.random() * 3; // 2-5s at destination
          }
        } else {
          // Continue to next tile
          const next = npc.path[npc.pathIndex];
          npc.fromX = px;
          npc.fromY = py;
          const nextPos = tileToPixel(next.x, next.y);
          npc.toX = nextPos.px;
          npc.toY = nextPos.py;
          npc.lerpProgress = npc.lerpProgress - 1; // carry over excess
        }
      } else {
        // Interpolate position
        npc.container.x = Math.round(npc.fromX + (npc.toX - npc.fromX) * npc.lerpProgress);
        npc.container.y = Math.round(npc.fromY + (npc.toY - npc.fromY) * npc.lerpProgress);
      }
      break;
    }

    case "AT_DESTINATION": {
      npc.stateTimer -= dt;
      if (npc.stateTimer <= 0) {
        // Return home
        npc.returningHome = true;
        const home = { x: npc.homeX, y: npc.homeY };
        if (!startWalking(npc, home)) {
          // Can't find path home, just teleport
          npc.tileX = npc.homeX;
          npc.tileY = npc.homeY;
          const { px, py } = tileToPixel(npc.homeX, npc.homeY);
          npc.container.x = px;
          npc.container.y = py;
          npc.state = "IDLE";
          npc.stateTimer = 3 + Math.random() * 5;
        }
      }
      break;
    }
  }
}
