"use client";

/**
 * HTML overlay for agent name labels and speech bubbles.
 * Positioned absolutely over the PixiJS canvas.
 * Uses DOM for crisp text rendering (no pixelation at zoom).
 */

import { useEffect, useState } from "react";

type Label = {
  id: string;
  name: string;
  role: string;
  x: number;
  y: number;
  bubble?: string;
  bubbleExpiry?: number;
};

const ROLE_COLORS: Record<string, string> = {
  developer: "#4fc3f7",
  designer: "#f06292",
  pm: "#ffb74d",
  qa: "#81c784",
  ops: "#ce93d8",
  generalist: "#90a4ae",
};

/** HTML overlay rendering crisp agent names and speech bubbles above the PixiJS canvas. */
export default function AgentLabels({
  labels,
  canvasOffset,
}: {
  labels: Label[];
  canvasOffset: { x: number; y: number; scale: number };
}) {
  const [now, setNow] = useState(0);

  // Tick every second to expire bubbles
  useEffect(() => {
    queueMicrotask(() => setNow(Date.now()));
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {labels.map((label) => {
        const screenX = label.x * canvasOffset.scale + canvasOffset.x;
        const screenY = label.y * canvasOffset.scale + canvasOffset.y;
        const activeBubble =
          label.bubble && label.bubbleExpiry && label.bubbleExpiry > now;
        const roleColor = ROLE_COLORS[label.role] || ROLE_COLORS.generalist;

        return (
          <div
            key={label.id}
            className="absolute"
            style={{
              left: screenX,
              top: screenY,
              transform: "translate(-50%, 0)",
              zIndex: 10,
            }}
          >
            {/* Speech bubble */}
            {activeBubble && (
              <div
                className="mb-1 px-2 py-1 bg-white rounded-lg shadow-md text-[11px] text-gray-800 max-w-[180px] leading-snug animate-fade-in relative"
                style={{ fontFamily: "system-ui, sans-serif" }}
              >
                {label.bubble}
                <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
              </div>
            )}

            {/* Name label */}
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm whitespace-nowrap">
              <span
                className="text-[10px] font-semibold text-white"
                style={{ fontFamily: "system-ui, sans-serif" }}
              >
                {label.name}
              </span>
              <span
                className="text-[8px] font-bold px-1 py-px rounded"
                style={{
                  backgroundColor: roleColor,
                  color: "white",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {label.role.toUpperCase().slice(0, 3)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
