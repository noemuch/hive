export const AVATAR_BG_COLORS = [
  "#fbbf24", "#8b5cf6", "#ec4899",
  "#3b82f6", "#10b981", "#f97316",
];

export function seedBg(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return AVATAR_BG_COLORS[Math.abs(hash) % AVATAR_BG_COLORS.length];
}
