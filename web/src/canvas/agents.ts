import {
  Container,
  Graphics,
  Text,
  TextStyle,
  Texture,
  Assets,
  Rectangle,
  AnimatedSprite,
  TextureSource,
} from "pixi.js";
import { TILE, DESK_POSITIONS, getPoi, collisionGrid, OFFICE_W, OFFICE_H } from "./office";
import { findPath, type Point } from "./pathfinding";

TextureSource.defaultOptions.scaleMode = "nearest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = "active" | "idle" | "sleeping";
export type MovementState = "SITTING" | "WALKING" | "AT_DESTINATION";
export type DestinationType = "whiteboard" | "coffee" | "desk";

export type AgentMotion = {
  state: MovementState;
  path: Point[];
  pathIndex: number;
  lerpProgress: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  destination: DestinationType;
  stateTimer: number;
  idleTimer: number;
  homeDesk: Point;
};

export type AgentSprite = {
  id: string;
  name: string;
  role: string;
  container: Container;
  bubble: Container | null;
  bubbleTimeout: ReturnType<typeof setTimeout> | null;
  deskIndex: number;
  status: AgentStatus;
  animSprite: AnimatedSprite | null;
  zzzContainer: Container | null;
  zzzInterval: ReturnType<typeof setInterval> | null;
  motion: AgentMotion;
  characterName: CharacterName;
  tint: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHARACTER_NAMES = ["Adam", "Alex", "Amelia", "Bob"] as const;
type CharacterName = (typeof CHARACTER_NAMES)[number];

const ROLE_COLORS: Record<string, number> = {
  developer: 0x4fc3f7,
  designer: 0xf06292,
  pm: 0xffb74d,
  qa: 0x81c784,
  ops: 0xce93d8,
  generalist: 0x90a4ae,
};

// LimeZu 16x16 character frame dimensions
// Sit/idle sheets are 384x32 single-row strips.
// Each frame is 16px wide, 32px tall (full character height).
const FRAME_W = 16;

// Tint hues for agents beyond the 4 base characters
const TINT_COLORS = [
  0xffffff, // no tint (original)
  0xffcccc, // pinkish
  0xccffcc, // greenish
  0xccccff, // bluish
  0xffffcc, // yellowish
  0xffccff, // magenta-ish
  0xccffff, // cyan-ish
  0xffe0cc, // peach
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const agents = new Map<string, AgentSprite>();
let nextDeskIndex = 0;

const TILES_PER_SECOND = 2;
const IDLE_BEFORE_COFFEE_S = 300; // 5 minutes
const AT_DESTINATION_S = 8;

let onAgentClickCallback: ((agentId: string) => void) | null = null;

export function setOnAgentClick(cb: ((agentId: string) => void) | null) {
  onAgentClickCallback = cb;
}

type CharacterTextures = {
  sit: Texture[];
  idleAnim: Texture[];
  walk: Texture[];
};
const characterTextureMap = new Map<CharacterName, CharacterTextures>();

// ---------------------------------------------------------------------------
// Texture loading
// ---------------------------------------------------------------------------

function extractFrames(
  source: TextureSource,
  frameCount: number,
  startFrame: number,
  count: number
): Texture[] {
  const frameH = source.height; // single-row strips: full height is frame height
  const frames: Texture[] = [];
  for (let i = startFrame; i < startFrame + count && i < frameCount; i++) {
    frames.push(
      new Texture({
        source,
        frame: new Rectangle(i * FRAME_W, 0, FRAME_W, frameH),
      })
    );
  }
  return frames;
}

/** Pre-load all LimeZu character spritesheets into texture cache. */
export async function loadCharacterTextures(): Promise<void> {
  characterTextureMap.clear();

  // Reset PixiJS asset cache to avoid stale references from destroyed apps
  // (React Strict Mode destroys the first app, corrupting Assets state)
  Assets.reset();

  const basePath = "/tilesets/limezu/characters/animated";

  for (const name of CHARACTER_NAMES) {
    try {
      // Load IDLE spritesheet (64x32 = 4 frames: front, back, left, right)
      const idleUrl = `${basePath}/${name}_idle_16x16.png`;
      const idleTex = await Assets.load(idleUrl);
      const idleSource = idleTex.source as TextureSource;

      // Extract just the front-facing frame (frame 0)
      const frontFrame = [new Texture({
        source: idleSource,
        frame: new Rectangle(0, 0, FRAME_W, idleSource.height),
      })];

      // Load idle ANIM for subtle breathing (use first 2 frames only)
      const idleAnimUrl = `${basePath}/${name}_idle_anim_16x16.png`;
      const idleAnimTex = await Assets.load(idleAnimUrl);
      const idleAnimSource = idleAnimTex.source as TextureSource;
      const totalAnimFrames = Math.floor(idleAnimSource.width / FRAME_W);
      const idleAnimFrames = extractFrames(idleAnimSource, totalAnimFrames, 0, 2);

      // Load walk/run sprite (384x32 = 24 frames: 4 dirs × 6 frames, front = 0-5)
      let walkFrames: Texture[] = [];
      try {
        const walkUrl = `/tilesets/limezu/characters/legacy/${name}_run_16x16.png`;
        const walkTex = await Assets.load(walkUrl);
        const walkSource = walkTex.source as TextureSource;
        walkFrames = extractFrames(walkSource, Math.floor(walkSource.width / FRAME_W), 0, 6);
      } catch {
        // No walk sprite — will use idle as fallback
      }

      characterTextureMap.set(name, {
        sit: frontFrame,
        idleAnim: idleAnimFrames,
        walk: walkFrames,
      });
    } catch (e) {
      console.warn(`Failed to load character ${name}:`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic character assignment
// ---------------------------------------------------------------------------

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash);
}

function getCharacterForAgent(agentId: string): {
  characterName: CharacterName;
  tint: number;
} {
  const hash = hashString(agentId);
  const charIndex = hash % CHARACTER_NAMES.length;
  const tintIndex = Math.floor(hash / CHARACTER_NAMES.length) % TINT_COLORS.length;
  return {
    characterName: CHARACTER_NAMES[charIndex],
    tint: TINT_COLORS[tintIndex],
  };
}

// ---------------------------------------------------------------------------
// Zzz overlay for sleeping status
// ---------------------------------------------------------------------------

function createZzzOverlay(parentContainer: Container): {
  container: Container;
  interval: ReturnType<typeof setInterval>;
} {
  const zzz = new Container();
  zzz.x = 8;
  zzz.y = -30; // float above 32px tall character

  let frame = 0;
  const interval = setInterval(() => {
    // Remove old z's
    while (zzz.children.length > 0) {
      zzz.removeChildAt(0);
    }

    // Draw 1-3 z's floating upward
    const count = (frame % 3) + 1;
    for (let i = 0; i < count; i++) {
      const z = new Text({
        text: "z",
        style: new TextStyle({
          fontSize: 4 + i,
          fontFamily: "monospace",
          fontWeight: "bold",
          fill: 0xaaaaff,
        }),
      });
      z.x = i * 3;
      z.y = -i * 4;
      z.alpha = 1 - i * 0.25;
      zzz.addChild(z);
    }
    frame++;
  }, 600);

  parentContainer.addChild(zzz);
  return { container: zzz, interval };
}

// ---------------------------------------------------------------------------
// Agent sprite creation
// ---------------------------------------------------------------------------

/** Create and place an agent sprite at the next available desk. */
export function addAgentSprite(
  parent: Container,
  id: string,
  name: string,
  role: string
): AgentSprite {
  if (agents.has(id)) return agents.get(id)!;

  const deskIndex = nextDeskIndex % DESK_POSITIONS.length;
  nextDeskIndex++;

  const desk = DESK_POSITIONS[deskIndex];
  const color = ROLE_COLORS[role] || ROLE_COLORS.generalist;

  const container = new Container();
  container.sortableChildren = true;

  // Position at desk chair — desk.x/y are tile coords of the chair.
  // +6px sitting offset (from pixel-agents) visually "sinks" the sprite into the chair.
  const SITTING_OFFSET_PX = 6;
  container.x = (desk.x + 0.5) * TILE;
  container.y = (desk.y + 0.5) * TILE + SITTING_OFFSET_PX;

  // Determine which character sprite to use
  const { characterName, tint } = getCharacterForAgent(id);
  const charTextures = characterTextureMap.get(characterName);

  let animSprite: AnimatedSprite | null = null;

  if (charTextures && charTextures.sit.length > 0) {
    // Use sitting frame — static single frame, no animation loop
    const frames = charTextures.sit.length === 1
      ? [...charTextures.sit, ...charTextures.sit] // AnimatedSprite needs 2+ frames
      : charTextures.sit;
    animSprite = new AnimatedSprite(frames);
    animSprite.animationSpeed = 0.02;
    animSprite.anchor.set(0.5, 1.0);
    animSprite.scale.set(1.0);
    if (frames.length <= 2) {
      animSprite.gotoAndStop(0); // Static — don't animate
    } else {
      animSprite.play();
    }

    // Apply tint for variety
    if (tint !== 0xffffff) {
      animSprite.tint = tint;
    }

    container.addChild(animSprite);
  } else {
    // Fallback: large colored circle with initial — clearly visible
    const RADIUS = 6;
    const body = new Graphics();
    body.circle(0, -RADIUS, RADIUS);
    body.fill(color);
    body.stroke({ color: 0xffffff, width: 1.5 });
    container.addChild(body);
    // Fallback circle — character textures not available

    const initial = new Text({
      text: name[0].toUpperCase(),
      style: new TextStyle({
        fontSize: 8,
        fontFamily: "monospace",
        fontWeight: "bold",
        fill: 0xffffff,
      }),
    });
    initial.anchor.set(0.5);
    initial.y = -RADIUS;
    container.addChild(initial);
  }

  // --- Pill name label (Gather-style) ---
  const pillFontSize = 7;
  const pillPadH = 6;
  const pillPadV = 3;
  const dotRadius = 3;
  const dotGap = 4;
  const arrowSize = 4;

  const nameLabel = new Text({
    text: name,
    style: new TextStyle({
      fontSize: pillFontSize * 4, // render at 4x for crisp text
      fontFamily: "Inter, system-ui, sans-serif",
      fill: 0xffffff,
      fontWeight: "500",
    }),
    resolution: 2,
  });
  nameLabel.scale.set(0.25); // scale back down to target size
  nameLabel.anchor.set(0, 0.5);

  // Measure pill dimensions
  const textWidth = name.length * (pillFontSize * 0.55);
  const pillWidth = dotRadius * 2 + dotGap + textWidth + pillPadH * 2;
  const pillHeight = pillFontSize + pillPadV * 2;
  const pillY = -38; // above 32px character sprite

  // Pill background
  const pillBg = new Graphics();
  pillBg.roundRect(-pillWidth / 2, pillY, pillWidth, pillHeight, pillHeight / 2);
  pillBg.fill({ color: 0x1a1a2e, alpha: 0.92 });
  container.addChild(pillBg);

  // Arrow pointing down to agent
  const arrowY = pillY + pillHeight;
  const arrow = new Graphics();
  arrow.moveTo(-arrowSize, arrowY);
  arrow.lineTo(0, arrowY + arrowSize);
  arrow.lineTo(arrowSize, arrowY);
  arrow.closePath();
  arrow.fill({ color: 0x1a1a2e, alpha: 0.92 });
  container.addChild(arrow);

  // Green status dot
  const dotX = -pillWidth / 2 + pillPadH + dotRadius;
  const dotY = pillY + pillHeight / 2;
  const dot = new Graphics();
  dot.circle(dotX, dotY, dotRadius);
  dot.fill(0x22c55e);
  container.addChild(dot);

  // Name text (positioned after dot)
  nameLabel.x = -pillWidth / 2 + pillPadH + dotRadius * 2 + dotGap;
  nameLabel.y = pillY + pillHeight / 2;
  container.addChild(nameLabel);

  container.zIndex = 900;
  container.eventMode = "static";
  container.cursor = "pointer";
  container.on("pointertap", () => {
    onAgentClickCallback?.(id);
  });
  parent.addChild(container);

  const sprite: AgentSprite = {
    id,
    name,
    role,
    container,
    bubble: null,
    bubbleTimeout: null,
    deskIndex,
    status: "active",
    animSprite,
    zzzContainer: null,
    zzzInterval: null,
    motion: {
      state: "SITTING",
      path: [],
      pathIndex: 0,
      lerpProgress: 0,
      fromX: container.x,
      fromY: container.y,
      toX: container.x,
      toY: container.y,
      destination: "desk",
      stateTimer: 0,
      idleTimer: 0,
      homeDesk: { x: desk.x, y: desk.y },
    },
    characterName,
    tint,
  };

  agents.set(id, sprite);
  return sprite;
}

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

/** Update visual appearance of an agent based on their status. */
export function setAgentStatus(agentId: string, status: AgentStatus): void {
  const sprite = agents.get(agentId);
  if (!sprite) return;
  if (sprite.status === status) return;

  sprite.status = status;

  // Clean up previous zzz overlay
  if (sprite.zzzContainer) {
    sprite.container.removeChild(sprite.zzzContainer);
    sprite.zzzContainer = null;
  }
  if (sprite.zzzInterval) {
    clearInterval(sprite.zzzInterval);
    sprite.zzzInterval = null;
  }

  switch (status) {
    case "active":
      // Full color, normal speed
      sprite.container.alpha = 1;
      if (sprite.animSprite) {
        sprite.animSprite.animationSpeed = 0.06;
        sprite.animSprite.play();
      }
      break;

    case "idle":
      // Dimmed appearance
      sprite.container.alpha = 0.55;
      if (sprite.animSprite) {
        sprite.animSprite.animationSpeed = 0.03;
      }
      break;

    case "sleeping": {
      // Dimmed + zzz overlay
      sprite.container.alpha = 0.4;
      if (sprite.animSprite) {
        sprite.animSprite.animationSpeed = 0.02;
      }
      const zzz = createZzzOverlay(sprite.container);
      sprite.zzzContainer = zzz.container;
      sprite.zzzInterval = zzz.interval;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Speech bubbles
// ---------------------------------------------------------------------------

/** Display a temporary speech bubble above an agent. */
export function showSpeechBubble(
  parent: Container,
  agentId: string,
  message: string
): void {
  const sprite = agents.get(agentId);
  if (!sprite) return;

  // Remove existing bubble (it's a child of sprite.container now)
  if (sprite.bubble) {
    sprite.container.removeChild(sprite.bubble);
    sprite.bubble = null;
  }
  if (sprite.bubbleTimeout) {
    clearTimeout(sprite.bubbleTimeout);
  }

  // When talking, briefly set to active
  if (sprite.status !== "active") {
    setAgentStatus(agentId, "active");
  }

  const truncated =
    message.length > 60 ? message.slice(0, 57) + "..." : message;

  // Add bubble as child of the agent container so it moves with the agent
  // and is positioned relative to the agent's origin.
  const bubble = new Container();
  bubble.zIndex = 1000; // Above everything

  // Position above the agent. The agent container origin is at the chair
  // tile center. The sprite (if loaded) is ~32px tall anchored at bottom.
  // Place bubble above the sprite.
  bubble.x = 0;
  bubble.y = -38; // well above a 32px tall character

  // Bubble text
  const text = new Text({
    text: truncated,
    style: new TextStyle({
      fontSize: 5,
      fontFamily: "monospace",
      fill: 0x222222,
      wordWrap: true,
      wordWrapWidth: 80,
      lineHeight: 7,
    }),
  });

  // Measure and build background
  const padding = 4;
  const bgWidth = Math.min(text.width + padding * 2, 95);
  const bgHeight = text.height + padding * 2;

  const bg = new Graphics();

  // Main bubble rect
  bg.roundRect(-bgWidth / 2, -bgHeight, bgWidth, bgHeight, 3);
  bg.fill({ color: 0xffffff, alpha: 0.95 });
  bg.stroke({ color: 0xaaaaaa, width: 0.5 });

  // Tail triangle pointing down to agent
  bg.moveTo(-2, 0);
  bg.lineTo(0, 4);
  bg.lineTo(2, 0);
  bg.closePath();
  bg.fill({ color: 0xffffff, alpha: 0.95 });

  text.x = -bgWidth / 2 + padding;
  text.y = -bgHeight + padding;

  bubble.addChild(bg);
  bubble.addChild(text);

  // Add to agent container (not parent) so it's relative to agent position
  sprite.container.addChild(bubble);

  sprite.bubble = bubble;

  // Auto-dismiss after 6 seconds
  sprite.bubbleTimeout = setTimeout(() => {
    if (sprite.bubble === bubble) {
      sprite.container.removeChild(bubble);
      sprite.bubble = null;
    }
  }, 6000);
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

/** Remove an agent sprite and clean up timers. */
export function removeAgentSprite(parent: Container, agentId: string): void {
  const sprite = agents.get(agentId);
  if (!sprite) return;

  parent.removeChild(sprite.container);
  // Bubble is a child of sprite.container, so removing container removes it too
  if (sprite.bubbleTimeout) {
    clearTimeout(sprite.bubbleTimeout);
  }
  if (sprite.zzzInterval) {
    clearInterval(sprite.zzzInterval);
  }
  agents.delete(agentId);
}

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

/** Get the current map of all active agent sprites. */
export function getAgents(): Map<string, AgentSprite> {
  return agents;
}

// ---------------------------------------------------------------------------
// Movement system
// ---------------------------------------------------------------------------

function getDestPoi(dest: DestinationType): Point {
  const poi = getPoi();
  if (dest === "whiteboard") return poi.WHITEBOARD;
  if (dest === "coffee") return poi.COFFEE;
  return { x: 0, y: 0 };
}

function switchSprite(agent: AgentSprite, mode: "sit" | "walk"): void {
  if (!agent.animSprite) return;
  const textures = characterTextureMap.get(agent.characterName);
  if (!textures) return;

  const frames = mode === "walk" && textures.walk.length >= 2
    ? textures.walk
    : textures.sit.length === 1
      ? [...textures.sit, ...textures.sit]
      : textures.sit;

  agent.animSprite.textures = frames;
  if (mode === "walk") {
    agent.animSprite.animationSpeed = 0.15;
    agent.animSprite.play();
  } else {
    agent.animSprite.animationSpeed = 0.02;
    agent.animSprite.gotoAndStop(0);
  }
}

function startWalking(agent: AgentSprite, dest: DestinationType): void {
  const m = agent.motion;
  const startTile: Point = {
    x: Math.floor(agent.container.x / TILE),
    y: Math.floor(agent.container.y / TILE),
  };
  const endTile = dest === "desk" ? m.homeDesk : getDestPoi(dest);

  if (!collisionGrid.length) { m.idleTimer = 0; return; }
  const path = findPath(collisionGrid, startTile, endTile, OFFICE_W, OFFICE_H);
  if (!path || path.length === 0) { m.idleTimer = 0; return; }

  m.state = "WALKING";
  m.destination = dest;
  m.path = path;
  m.pathIndex = 0;
  m.lerpProgress = 0;
  m.fromX = agent.container.x;
  m.fromY = agent.container.y;
  m.toX = (path[0].x + 0.5) * TILE;
  m.toY = (path[0].y + 0.5) * TILE;
  m.stateTimer = 0;
  m.idleTimer = 0;

  switchSprite(agent, "walk");
  agent.container.alpha = 1;
}

/** Trigger an agent to walk to a destination. */
export function triggerAgentMove(agentId: string, dest: DestinationType): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  if (agent.motion.state === "WALKING") return; // already moving
  startWalking(agent, dest);
}

/** Reset idle timer when agent talks. */
export function notifyAgentActivity(agentId: string): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.motion.idleTimer = 0;
}

/** Main tick — call from GameView ticker. */
export function updateAgents(deltaMS: number): void {
  const dt = deltaMS / 1000;

  for (const [, agent] of agents) {
    const m = agent.motion;

    switch (m.state) {
      case "SITTING": {
        m.idleTimer += dt;
        if (m.idleTimer >= IDLE_BEFORE_COFFEE_S) {
          startWalking(agent, "coffee");
        }
        break;
      }

      case "WALKING": {
        m.lerpProgress += TILES_PER_SECOND * dt;

        // Flip sprite based on horizontal direction
        if (agent.animSprite) {
          const dx = m.toX - m.fromX;
          if (dx < 0) agent.animSprite.scale.x = -Math.abs(agent.animSprite.scale.x);
          else if (dx > 0) agent.animSprite.scale.x = Math.abs(agent.animSprite.scale.x);
        }

        if (m.lerpProgress >= 1) {
          // Arrived at current path node
          agent.container.x = m.toX;
          agent.container.y = m.toY;
          m.pathIndex++;

          if (m.pathIndex >= m.path.length) {
            // Arrived at destination
            m.state = "AT_DESTINATION";
            m.stateTimer = AT_DESTINATION_S;
            switchSprite(agent, "sit");
          } else {
            // Move to next path node
            m.lerpProgress -= 1;
            m.fromX = m.toX;
            m.fromY = m.toY;
            m.toX = (m.path[m.pathIndex].x + 0.5) * TILE;
            m.toY = (m.path[m.pathIndex].y + 0.5) * TILE;
          }
        } else {
          // Interpolate
          agent.container.x = Math.round(m.fromX + (m.toX - m.fromX) * m.lerpProgress);
          agent.container.y = Math.round(m.fromY + (m.toY - m.fromY) * m.lerpProgress);
        }

        // Update depth sorting
        agent.container.zIndex = 900 + Math.floor(agent.container.y);
        break;
      }

      case "AT_DESTINATION": {
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) {
          // Walk back to desk
          startWalking(agent, "desk");
        }
        break;
      }
    }
  }
}

/** Reset all module-level state. Call on GameView unmount. */
export function resetAgentState(): void {
  for (const [, sprite] of agents) {
    if (sprite.bubbleTimeout) clearTimeout(sprite.bubbleTimeout);
    if (sprite.zzzInterval) clearInterval(sprite.zzzInterval);
  }
  agents.clear();
  nextDeskIndex = 0;
}
