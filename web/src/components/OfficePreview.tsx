/**
 * Deterministic pixel-art office preview for company cards.
 * Generates a 6x4 grid of colored "desk" and "screen" pixels based on company ID hash.
 * No runtime canvas rendering — pure CSS + inline styles.
 */

const FLOOR_COLORS = ["#2a1f14", "#1a2a1f", "#1f1a2a", "#2a1a1a", "#1a1f2a"];
const WALL_COLORS = ["#1e293b", "#1e1e2e", "#1b2e2e", "#2e1e1e", "#1e2e1b"];
const ACCENT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899"];
const SCREEN_COLORS = ["#38bdf8", "#34d399", "#a78bfa", "#fb923c", "#f472b6"];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

type Props = {
  companyId: string;
  className?: string;
};

export function OfficePreview({ companyId, className = "" }: Props) {
  const h = hash(companyId);
  const rand = seededRandom(h);
  const floor = FLOOR_COLORS[h % FLOOR_COLORS.length];
  const wall = WALL_COLORS[h % WALL_COLORS.length];
  const accent = ACCENT_COLORS[h % ACCENT_COLORS.length];
  const screenColor = SCREEN_COLORS[(h >> 3) % SCREEN_COLORS.length];

  // Generate deterministic desk positions (6x4 grid, some cells are furniture)
  const COLS = 6;
  const ROWS = 4;
  const cells: { type: "empty" | "desk" | "screen" | "plant" | "chair" }[] = [];

  for (let i = 0; i < COLS * ROWS; i++) {
    const r = rand();
    if (r < 0.25) cells.push({ type: "desk" });
    else if (r < 0.35) cells.push({ type: "screen" });
    else if (r < 0.4) cells.push({ type: "plant" });
    else if (r < 0.5) cells.push({ type: "chair" });
    else cells.push({ type: "empty" });
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ backgroundColor: floor, imageRendering: "pixelated" }}
    >
      {/* Wall strip at top */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: "30%", backgroundColor: wall }}
      />

      {/* Pixel grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "12px 12px",
        }}
      />

      {/* Furniture dots */}
      <div
        className="absolute inset-0 p-[12%]"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          gap: "4px",
        }}
      >
        {cells.map((cell, i) => {
          if (cell.type === "empty") return <div key={i} />;
          const colors: Record<string, string> = {
            desk: accent + "40",
            screen: screenColor,
            plant: "#22c55e60",
            chair: accent + "20",
          };
          const sizes: Record<string, string> = {
            desk: "80%",
            screen: "45%",
            plant: "35%",
            chair: "50%",
          };
          return (
            <div key={i} className="flex items-center justify-center">
              <div
                style={{
                  width: sizes[cell.type],
                  aspectRatio: cell.type === "desk" ? "2/1" : "1",
                  backgroundColor: colors[cell.type],
                  borderRadius: cell.type === "plant" ? "50%" : "2px",
                  boxShadow: cell.type === "screen" ? `0 0 4px ${screenColor}60` : undefined,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Subtle vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
    </div>
  );
}
