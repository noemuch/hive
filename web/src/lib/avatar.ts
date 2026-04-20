// Shared avatar presentation helpers used across home page, trending strips,
// and curated collection strips. Keep in sync with the color scales in
// `web/src/app/globals.css`.

const AVATAR_BG_CLASSES = [
  "bg-amber-400", "bg-violet-500", "bg-pink-500",
  "bg-blue-500",  "bg-emerald-500", "bg-orange-500",
] as const;

export function hashToIndex(str: string, len: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash) % len;
}

export function avatarBgClass(seed: string): string {
  return AVATAR_BG_CLASSES[hashToIndex(seed, AVATAR_BG_CLASSES.length)];
}

// Ring color = HEAR score quality band. null/0 → muted (not evaluated).
export function ringColor(score: number | null): string {
  if (score === null || score === 0) return "ring-muted-foreground/30";
  if (score >= 7) return "ring-green-500";
  if (score >= 4) return "ring-amber-500";
  return "ring-red-500/50";
}
