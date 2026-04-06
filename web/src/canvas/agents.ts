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
import { TILE, DESK_POSITIONS } from "./office";

TextureSource.defaultOptions.scaleMode = "nearest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = "active" | "idle" | "sleeping";

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
// Sit/idle sheets are single-row strips of 16-wide frames.
// The actual pixel height per frame varies but the content is 16x17
// (16 wide, up to 17 tall for sitting characters with hair).
// We use the full source height for each frame.
const FRAME_W = 16;

// Sit sheet: 12 frames = 4 directions x 3 frames each
// Direction order (LimeZu standard): front, back, left, right
// We want front-facing sit = first 3 frames
const SIT_FRAMES_PER_DIR = 3;
const SIT_FRONT_START = 0; // front direction is first row of frames

// Idle anim sheet: 24 frames = 4 directions x 6 frames each
const IDLE_ANIM_FRAMES_PER_DIR = 6;
const IDLE_ANIM_FRONT_START = 0;

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

// Loaded textures: characterName -> { sit: Texture[], idleAnim: Texture[] }
type CharacterTextures = {
  sit: Texture[];
  idleAnim: Texture[];
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

export async function loadCharacterTextures(): Promise<void> {
  characterTextureMap.clear();

  const basePath = "/tilesets/limezu/characters/animated";

  for (const name of CHARACTER_NAMES) {
    try {
      // Load sit spritesheet
      const sitTex = await Assets.load(`${basePath}/${name}_sit_16x16.png`);
      const sitSource = sitTex.source as TextureSource;
      const sitTotalFrames = Math.floor(sitSource.width / FRAME_W);
      const sitFrames = extractFrames(
        sitSource,
        sitTotalFrames,
        SIT_FRONT_START,
        SIT_FRAMES_PER_DIR
      );

      // Load idle anim spritesheet
      const idleTex = await Assets.load(
        `${basePath}/${name}_idle_anim_16x16.png`
      );
      const idleSource = idleTex.source as TextureSource;
      const idleTotalFrames = Math.floor(idleSource.width / FRAME_W);
      const idleAnimFrames = extractFrames(
        idleSource,
        idleTotalFrames,
        IDLE_ANIM_FRONT_START,
        IDLE_ANIM_FRAMES_PER_DIR
      );

      characterTextureMap.set(name, {
        sit: sitFrames,
        idleAnim: idleAnimFrames,
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
  zzz.x = 6;
  zzz.y = -20;

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

  // Position at chair (in front of desk)
  container.x = (desk.x + 1) * TILE;
  container.y = (desk.y + 2.5) * TILE;

  // Determine which character sprite to use
  const { characterName, tint } = getCharacterForAgent(id);
  const charTextures = characterTextureMap.get(characterName);

  let animSprite: AnimatedSprite | null = null;

  if (charTextures && charTextures.sit.length > 0) {
    // Use sitting animation for desk-bound agents
    animSprite = new AnimatedSprite(charTextures.sit);
    animSprite.animationSpeed = 0.06;
    animSprite.anchor.set(0.5, 1.0);
    animSprite.scale.set(1.5);
    animSprite.play();

    // Apply tint for variety
    if (tint !== 0xffffff) {
      animSprite.tint = tint;
    }

    container.addChild(animSprite);
  } else {
    // Fallback: colored circle with initial
    const body = new Graphics();
    body.circle(0, 0, TILE * 0.7);
    body.fill(color);
    body.stroke({ color: 0xffffff, width: 2 });
    container.addChild(body);

    const initial = new Text({
      text: name[0].toUpperCase(),
      style: new TextStyle({
        fontSize: 12,
        fontFamily: "monospace",
        fontWeight: "bold",
        fill: 0xffffff,
      }),
    });
    initial.anchor.set(0.5);
    container.addChild(initial);
  }

  // --- Name label with dark semi-transparent background (Gather.town style) ---
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
  };

  agents.set(id, sprite);
  return sprite;
}

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

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

export function showSpeechBubble(
  parent: Container,
  agentId: string,
  message: string
): void {
  const sprite = agents.get(agentId);
  if (!sprite) return;

  // Remove existing bubble
  if (sprite.bubble) {
    parent.removeChild(sprite.bubble);
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
    message.length > 50 ? message.slice(0, 47) + "..." : message;

  const bubble = new Container();
  bubble.x = sprite.container.x;
  bubble.y = sprite.container.y - TILE * 2;

  // Bubble text
  const text = new Text({
    text: truncated,
    style: new TextStyle({
      fontSize: 5,
      fontFamily: "monospace",
      fill: 0x222222,
      wordWrap: true,
      wordWrapWidth: 100,
      lineHeight: 7,
    }),
  });

  // Measure and build background
  const padding = 5;
  const bgWidth = Math.min(text.width + padding * 2, 115);
  const bgHeight = text.height + padding * 2;

  const bg = new Graphics();

  // Main bubble rect
  bg.roundRect(-bgWidth / 2, -bgHeight, bgWidth, bgHeight, 4);
  bg.fill({ color: 0xffffff, alpha: 0.95 });
  bg.stroke({ color: 0xcccccc, width: 0.5 });

  // Tail triangle
  bg.moveTo(-3, 0);
  bg.lineTo(0, 5);
  bg.lineTo(3, 0);
  bg.closePath();
  bg.fill({ color: 0xffffff, alpha: 0.95 });

  text.x = -bgWidth / 2 + padding;
  text.y = -bgHeight + padding;

  bubble.addChild(bg);
  bubble.addChild(text);
  parent.addChild(bubble);

  sprite.bubble = bubble;

  // Auto-dismiss after 6 seconds
  sprite.bubbleTimeout = setTimeout(() => {
    if (sprite.bubble === bubble) {
      parent.removeChild(bubble);
      sprite.bubble = null;
    }
  }, 6000);
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

export function removeAgentSprite(parent: Container, agentId: string): void {
  const sprite = agents.get(agentId);
  if (!sprite) return;

  parent.removeChild(sprite.container);
  if (sprite.bubble) {
    parent.removeChild(sprite.bubble);
  }
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

export function getAgents(): Map<string, AgentSprite> {
  return agents;
}
