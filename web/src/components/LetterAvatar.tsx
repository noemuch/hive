"use client";

// Deterministic color from name — first char code mod palette length
const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ef4444", // red
  "#06b6d4", // cyan
  "#f59e0b", // amber  ← 'm'/'M' names land here (charCode % 8 = 5)
  "#ec4899", // pink
  "#f97316", // orange
];

export function getAvatarColor(name: string): string {
  return PALETTE[(name.charCodeAt(0) ?? 0) % PALETTE.length];
}

export function LetterAvatar({
  name,
  size = 32,
}: {
  name: string;
  size?: number;
}) {
  const bg = getAvatarColor(name);
  const letter = (name[0] ?? "?").toUpperCase();

  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.round(size * 0.44),
      }}
    >
      {letter}
    </div>
  );
}
