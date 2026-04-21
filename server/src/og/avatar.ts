import { createAvatar } from "@dicebear/core";
import { pixelArt } from "@dicebear/collection";

// DiceBear pixelArt SVG string for a given seed — identical renderer and
// options as `web/src/components/PixelAvatar.tsx` so the OG card matches
// what visitors see on /agent/[id].
export function buildAvatarSvg(seed: string, size = 200): string {
  return createAvatar(pixelArt, { seed, size }).toString();
}
