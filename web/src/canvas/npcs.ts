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
import { TILE, OFFICE_W, OFFICE_H } from "./office";

TextureSource.defaultOptions.scaleMode = "nearest";

type NPCState = "idle" | "walking" | "coffee";

type NPC = {
  container: Container;
  sprite: AnimatedSprite | Sprite;
  state: NPCState;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  stateTimer: number;
  speed: number;
  homeX: number;
  homeY: number;
};

const npcs: NPC[] = [];

const NPC_HOMES = [
  { x: 9, y: 5 },
  { x: 9, y: 8 },
  { x: 9, y: 11 },
  { x: 11, y: 5 },
  { x: 11, y: 8 },
];

const COFFEE_POS = { x: 21, y: 3 };

// Try to load a LimeZu character for NPCs, fall back to simple sprite
let npcTextures: Texture[] = [];

async function loadNPCTextures(): Promise<void> {
  // Use Adam as the NPC character — load idle animation frames
  try {
    const sheet = await Assets.load(
      "/tilesets/limezu/characters/animated/Adam_idle_anim_16x16.png"
    );
    const source = sheet.source;
    const frameW = 16;
    const frameH = 32; // LimeZu characters are 16 wide, ~32 tall

    // Try to extract frames from the first row
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
    // Texture loading failed — NPCs will use a simple circle fallback
  }
}

/** Spawn decorative NPC characters that wander the office. */
export async function createNPCs(parent: Container): Promise<void> {
  await loadNPCTextures();

  for (const home of NPC_HOMES) {
    const container = new Container();

    let sprite: AnimatedSprite | Sprite;

    if (npcTextures.length > 0) {
      // Use LimeZu character
      const anim = new AnimatedSprite(npcTextures);
      anim.animationSpeed = 0.05;
      anim.anchor.set(0.5, 0.8);
      anim.alpha = 0.5; // NPCs are dimmed to distinguish from real agents
      anim.play();
      sprite = anim;
    } else {
      // Fallback: simple circle
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

    const px = home.x * TILE;
    const py = home.y * TILE;
    container.x = px;
    container.y = py;

    parent.addChild(container);

    npcs.push({
      container,
      sprite,
      state: "idle",
      x: px,
      y: py,
      targetX: px,
      targetY: py,
      stateTimer: Math.random() * 300 + 200,
      speed: 0.3 + Math.random() * 0.2,
      homeX: px,
      homeY: py,
    });
  }

  // Animation loop
  Ticker.shared.add((ticker) => {
    for (const npc of npcs) {
      updateNPC(npc, ticker.deltaTime);
    }
  });
}

function updateNPC(npc: NPC, dt: number): void {
  npc.stateTimer -= dt;

  switch (npc.state) {
    case "idle":
      if (npc.stateTimer <= 0) {
        if (Math.random() < 0.4) {
          npc.targetX = COFFEE_POS.x * TILE;
          npc.targetY = COFFEE_POS.y * TILE;
          npc.state = "walking";
        } else {
          npc.targetX = npc.homeX + (Math.random() - 0.5) * 4 * TILE;
          npc.targetY = npc.homeY + (Math.random() - 0.5) * 4 * TILE;
          npc.targetX = Math.max(
            TILE,
            Math.min((OFFICE_W - 2) * TILE, npc.targetX)
          );
          npc.targetY = Math.max(
            TILE,
            Math.min((OFFICE_H - 2) * TILE, npc.targetY)
          );
          npc.state = "walking";
        }
      }
      break;

    case "walking": {
      const dx = npc.targetX - npc.x;
      const dy = npc.targetY - npc.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        npc.x = npc.targetX;
        npc.y = npc.targetY;
        if (
          Math.abs(npc.x - COFFEE_POS.x * TILE) < TILE &&
          Math.abs(npc.y - COFFEE_POS.y * TILE) < TILE
        ) {
          npc.state = "coffee";
          npc.stateTimer = 120 + Math.random() * 180;
        } else {
          npc.state = "idle";
          npc.stateTimer = 300 + Math.random() * 600;
        }
      } else {
        npc.x += (dx / dist) * npc.speed * dt;
        npc.y += (dy / dist) * npc.speed * dt;
      }

      npc.container.x = Math.round(npc.x);
      npc.container.y = Math.round(npc.y);
      break;
    }

    case "coffee":
      if (npc.stateTimer <= 0) {
        npc.targetX = npc.homeX;
        npc.targetY = npc.homeY;
        npc.state = "walking";
      }
      break;
  }
}
