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
import { TILE, DESK_POSITIONS, collisionGrid, POI, OFFICE_W, OFFICE_H } from "./office";
import { findPath, type Point } from "./pathfinding";

TextureSource.defaultOptions.scaleMode = "nearest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = "active" | "idle" | "sleeping";

export type AgentMovementState = "SITTING" | "WALKING" | "AT_DESTINATION";

export type AgentMotion = {
  state: AgentMovementState;
  path: { x: number; y: number }[];
  pathIndex: number;
  lerpProgress: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  destination: "whiteboard" | "coffee" | "desk";
  stateTimer: number;
  idleTimer: number;
  homeDeskX: number;
  homeDeskY: number;
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

let onAgentClickCallback: ((agentId: string) => void) | null = null;

export function setOnAgentClick(cb: ((agentId: string) => void) | null) {
  onAgentClickCallback = cb;
}

// Loaded textures: characterName -> { sit: Texture[], idleAnim: Texture[] }
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
      const idleAnimFrames = extractFrames(idleAnimSource, Math.floor(idleAnimSource.width / FRAME_W), 0, 2);

      // Load walk spritesheet for movement animation
      let walkFrames: Texture[] = [];
      try {
        const walkUrl = `${basePath}/${name}_walk_16x16.png`;
        const walkTex = await Assets.load(walkUrl);
        const walkSource = walkTex.source as TextureSource;
        walkFrames = extractFrames(walkSource, Math.floor(walkSource.width / FRAME_W), 0, 4);
      } catch {
        walkFrames = idleAnimFrames; // fallback
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
// Sprite switching (sit ↔ walk)
// ---------------------------------------------------------------------------

function switchAgentSprite(agent: AgentSprite, mode: "sit" | "walk"): void {
  if (!agent.animSprite) return;

  const { characterName } = getCharacterForAgent(agent.id);
  const charTextures = characterTextureMap.get(characterName);
  if (!charTextures) return;

  const frames = mode === "walk" ? charTextures.walk : charTextures.sit;
  if (frames.length === 0) return;

  const textures = frames.length === 1 ? [...frames, ...frames] : frames;
  agent.animSprite.textures = textures;

  if (mode === "walk") {
    agent.animSprite.animationSpeed = 0.15;
    agent.animSprite.play();
  } else {
    agent.animSprite.animationSpeed = 0.02;
    agent.animSprite.gotoAndStop(0);
  }
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
  // Center horizontally in the tile. For Y, the sprite anchor is bottom-center,
  // so we place at the bottom of the chair tile (desk.y + 1).
  // But the chairs are already in "front" position (below the desk), so
  // we DON'T add extra offset — just center in the chair tile.
  container.x = (desk.x + 0.5) * TILE;
  container.y = (desk.y + 0.5) * TILE; // center of chair tile

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
    animSprite.animationSpeed = 0.02; // Very slow — barely perceptible breathing
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

  // --- Name label with dark semi-transparent background style ---
  const labelY = 4;
  const labelFontSize = 6;
  const labelPadH = 4;
  const labelPadV = 2;

  const nameLabel = new Text({
    text: name,
    style: new TextStyle({
      fontSize: labelFontSize,
      fontFamily: "monospace",
      fill: 0xffffff,
      fontWeight: "bold",
    }),
  });
  nameLabel.anchor.set(0.5, 0);

  // Measure text width (approximate for monospace)
  const labelWidth = name.length * (labelFontSize * 0.6) + labelPadH * 2;
  const labelHeight = labelFontSize + labelPadV * 2;

  const labelBg = new Graphics();
  labelBg.roundRect(
    -labelWidth / 2,
    labelY,
    labelWidth,
    labelHeight,
    3
  );
  labelBg.fill({ color: 0x000000, alpha: 0.65 });
  container.addChild(labelBg);

  nameLabel.y = labelY + labelPadV;
  container.addChild(nameLabel);

  // --- Role badge with color ---
  const badgeY = labelY + labelHeight + 1;
  const badgeFontSize = 4;
  const badgePadH = 3;
  const badgePadV = 1;
  const roleText = role.toUpperCase();
  const badgeWidth = roleText.length * (badgeFontSize * 0.6) + badgePadH * 2;
  const badgeHeight = badgeFontSize + badgePadV * 2;

  const roleBg = new Graphics();
  roleBg.roundRect(-badgeWidth / 2, badgeY, badgeWidth, badgeHeight, 2);
  roleBg.fill({ color, alpha: 0.85 });
  container.addChild(roleBg);

  const roleBadge = new Text({
    text: roleText,
    style: new TextStyle({
      fontSize: badgeFontSize,
      fontFamily: "monospace",
      fill: 0xffffff,
      fontWeight: "bold",
    }),
  });
  roleBadge.anchor.set(0.5, 0);
  roleBadge.y = badgeY + badgePadV;
  container.addChild(roleBadge);

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
      homeDeskX: desk.x,
      homeDeskY: desk.y,
    },
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
// Movement system
// ---------------------------------------------------------------------------

const AGENT_TILES_PER_SECOND = 2;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const DESTINATION_DURATION_MS: Record<string, number> = { whiteboard: 8000, coffee: 6000 };

function tileToPixel(tx: number, ty: number): { px: number; py: number } {
  return { px: (tx + 0.5) * TILE, py: (ty + 0.5) * TILE };
}

function pixelToTile(px: number, py: number): { tx: number; ty: number } {
  return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) };
}

export function triggerAgentMove(agentId: string, destination: "whiteboard" | "coffee"): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  if (agent.motion.state !== "SITTING") return;

  const target: Point = destination === "whiteboard" ? POI.WHITEBOARD : POI.COFFEE;
  const currentTile = pixelToTile(agent.container.x, agent.container.y);

  const path = findPath(
    collisionGrid,
    { x: currentTile.tx, y: currentTile.ty },
    target,
    OFFICE_W,
    OFFICE_H
  );

  if (!path || path.length === 0) return;

  agent.motion.path = path;
  agent.motion.pathIndex = 0;
  agent.motion.lerpProgress = 0;
  agent.motion.destination = destination;
  agent.motion.state = "WALKING";

  agent.motion.fromX = agent.container.x;
  agent.motion.fromY = agent.container.y;
  const to = tileToPixel(path[0].x, path[0].y);
  agent.motion.toX = to.px;
  agent.motion.toY = to.py;

  switchAgentSprite(agent, "walk");
}

export function notifyAgentActivity(agentId: string): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.motion.idleTimer = 0;
}

export function updateAgents(deltaMS: number): void {
  const dt = deltaMS / 1000;

  for (const [, agent] of agents) {
    const m = agent.motion;

    switch (m.state) {
      case "SITTING": {
        m.idleTimer += deltaMS;
        if (m.idleTimer >= IDLE_THRESHOLD_MS) {
          m.idleTimer = 0;
          triggerAgentMove(agent.id, "coffee");
        }
        break;
      }

      case "WALKING": {
        m.lerpProgress += AGENT_TILES_PER_SECOND * dt;

        if (agent.animSprite) {
          const dx = m.toX - m.fromX;
          if (dx < 0) {
            agent.animSprite.scale.x = -Math.abs(agent.animSprite.scale.x);
          } else if (dx > 0) {
            agent.animSprite.scale.x = Math.abs(agent.animSprite.scale.x);
          }
        }

        if (m.lerpProgress >= 1) {
          const current = m.path[m.pathIndex];
          const { px, py } = tileToPixel(current.x, current.y);
          agent.container.x = px;
          agent.container.y = py;
          agent.container.zIndex = 900 + current.y;

          m.pathIndex++;

          if (m.pathIndex >= m.path.length) {
            if (m.destination === "desk") {
              m.state = "SITTING";
              switchAgentSprite(agent, "sit");
            } else {
              m.state = "AT_DESTINATION";
              m.stateTimer = DESTINATION_DURATION_MS[m.destination] || 6000;
              switchAgentSprite(agent, "sit");
            }
          } else {
            const next = m.path[m.pathIndex];
            m.fromX = px;
            m.fromY = py;
            const nextPos = tileToPixel(next.x, next.y);
            m.toX = nextPos.px;
            m.toY = nextPos.py;
            m.lerpProgress = m.lerpProgress - 1;
          }
        } else {
          agent.container.x = Math.round(m.fromX + (m.toX - m.fromX) * m.lerpProgress);
          agent.container.y = Math.round(m.fromY + (m.toY - m.fromY) * m.lerpProgress);
        }
        break;
      }

      case "AT_DESTINATION": {
        m.stateTimer -= deltaMS;
        if (m.stateTimer <= 0) {
          const home: Point = { x: m.homeDeskX, y: m.homeDeskY };
          const currentTile = pixelToTile(agent.container.x, agent.container.y);

          const path = findPath(
            collisionGrid,
            { x: currentTile.tx, y: currentTile.ty },
            home,
            OFFICE_W,
            OFFICE_H
          );

          if (path && path.length > 0) {
            m.path = path;
            m.pathIndex = 0;
            m.lerpProgress = 0;
            m.destination = "desk";
            m.state = "WALKING";

            m.fromX = agent.container.x;
            m.fromY = agent.container.y;
            const to = tileToPixel(path[0].x, path[0].y);
            m.toX = to.px;
            m.toY = to.py;

            switchAgentSprite(agent, "walk");
          } else {
            const { px, py } = tileToPixel(m.homeDeskX, m.homeDeskY);
            agent.container.x = px;
            agent.container.y = py;
            m.state = "SITTING";
            switchAgentSprite(agent, "sit");
          }
        }
        break;
      }
    }
  }
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
