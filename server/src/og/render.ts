import { Resvg } from "@resvg/resvg-js";
import { buildAvatarSvg } from "./avatar";

// Canonical OG card dimensions (Twitter/LinkedIn/Discord summary_large_image).
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const AVATAR_SIZE = 240;
// Layout-safe max character counts — keep the one-line name and role-at-bureau
// segment from overflowing their columns. Chosen empirically for the current
// font size + x=360 text-column origin. Defensive truncation for role and
// llm_provider even though both are usually short enums — caller-provided
// strings shouldn't be able to break the card layout.
const MAX_NAME_CHARS = 28;
const MAX_BUREAU_CHARS = 24;
const MAX_ROLE_CHARS = 20;
const MAX_PROVIDER_CHARS = 20;
// Background gradient mirrors the site's dark oklch theme — same visual
// identity as the rest of the app. Approximated in sRGB for SVG.
const BG_FROM = "#1a1a24";
const BG_TO = "#2a1f3d";
const FG_PRIMARY = "#f5f5f5";
const FG_MUTED = "#a5a5b5";
const ACCENT = "#8b7cff";

export type AgentOgInput = {
  name: string;
  role: string;
  avatar_seed: string;
  score_state_mu: number | null;
  bureau_name: string | null;
  llm_provider: string | null;
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Truncate a string to `max` chars with an ellipsis — used so long agent names
// or bureau names don't overflow the card layout.
function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// Build the 1200×630 SVG for an agent's OG card. Layout:
//   - full-bleed gradient background
//   - avatar at (80, 195), 240×240 (vertically centred)
//   - text column starting at x=360, top-aligned with avatar
//   - large score badge on the right (x≈950)
export function buildAgentSvg(input: AgentOgInput): string {
  const name = escapeXml(truncate(input.name, MAX_NAME_CHARS));
  const role = escapeXml(truncate(input.role, MAX_ROLE_CHARS));
  const bureauLine = input.bureau_name
    ? `${role} @ ${escapeXml(truncate(input.bureau_name, MAX_BUREAU_CHARS))}`
    : role;
  const scoreText = input.score_state_mu === null
    ? "—"
    : input.score_state_mu.toFixed(1);
  const scoreLabel = input.score_state_mu === null ? "Not evaluated yet" : "HEAR score";
  const providerLine = input.llm_provider
    ? `Powered by ${escapeXml(truncate(input.llm_provider, MAX_PROVIDER_CHARS))}`
    : "";

  // Avatar: embed the DiceBear SVG as a nested <svg> so its viewBox scales
  // into our target box without a round-trip through a data URI (keeps the
  // rendered bytes lean and avoids double base64 encoding).
  const avatarSvg = buildAvatarSvg(input.avatar_seed, AVATAR_SIZE);
  const avatarInner = avatarSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const avatarViewBoxMatch = avatarSvg.match(/viewBox="([^"]+)"/);
  const avatarViewBox = avatarViewBoxMatch ? avatarViewBoxMatch[1] : `0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BG_FROM}"/>
      <stop offset="100%" stop-color="${BG_TO}"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <rect x="80" y="${OG_HEIGHT - 8}" width="${OG_WIDTH - 160}" height="4" fill="${ACCENT}" opacity="0.7"/>

  <svg x="80" y="${(OG_HEIGHT - AVATAR_SIZE) / 2}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" viewBox="${avatarViewBox}" preserveAspectRatio="xMidYMid meet">
    ${avatarInner}
  </svg>

  <text x="360" y="260" font-family="sans-serif" font-size="72" font-weight="700" fill="${FG_PRIMARY}">${name}</text>
  <text x="360" y="320" font-family="sans-serif" font-size="32" fill="${FG_MUTED}">${bureauLine}</text>
  ${providerLine ? `<text x="360" y="370" font-family="sans-serif" font-size="24" fill="${FG_MUTED}">${providerLine}</text>` : ""}

  <g transform="translate(950, 250)">
    <circle cx="80" cy="80" r="80" fill="${ACCENT}" opacity="0.15"/>
    <circle cx="80" cy="80" r="80" fill="none" stroke="${ACCENT}" stroke-width="3"/>
    <text x="80" y="95" font-family="sans-serif" font-size="56" font-weight="700" fill="${FG_PRIMARY}" text-anchor="middle">${scoreText}</text>
    <text x="80" y="195" font-family="sans-serif" font-size="18" fill="${FG_MUTED}" text-anchor="middle">${scoreLabel}</text>
  </g>

  <text x="80" y="80" font-family="sans-serif" font-size="24" font-weight="700" fill="${ACCENT}" letter-spacing="4">HIVE</text>
</svg>`;
}

// Rasterise to PNG via resvg. `loadSystemFonts: true` picks up whatever
// sans-serif is on the host (DejaVu / Liberation on typical Linux images).
// Deterministic-enough for social cards; fonts don't need to be bundled.
export function renderAgentOg(input: AgentOgInput): Uint8Array {
  const svg = buildAgentSvg(input);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "sans-serif",
    },
  });
  return resvg.render().asPng();
}
