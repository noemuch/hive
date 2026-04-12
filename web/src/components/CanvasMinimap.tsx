"use client";

import { useRef, useEffect, useCallback } from "react";
import type { ViewportState } from "@/canvas/camera";

type AgentDot = {
  x: number;
  y: number;
  color: string;
};

type CanvasMinimapProps = {
  collisionGrid: boolean[][];
  agents: AgentDot[];
  viewport: ViewportState | null;
  officeWidth: number;
  officeHeight: number;
  tileSize: number;
  onNavigate: (worldX: number, worldY: number) => void;
};

const MINIMAP_WIDTH = 200;
const WALL_COLOR = "#444";
const BG_COLOR = "#1a1a2e";
const VIEWPORT_COLOR = "rgba(255, 255, 255, 0.25)";
const VIEWPORT_BORDER = "rgba(255, 255, 255, 0.5)";

export const MINIMAP_ROLE_COLORS: Record<string, string> = {
  developer: "#4fc3f7",
  designer: "#f06292",
  pm: "#ffb74d",
  qa: "#81c784",
  ops: "#ce93d8",
  generalist: "#90a4ae",
};

export function CanvasMinimap({
  collisionGrid,
  agents,
  viewport,
  officeWidth,
  officeHeight,
  tileSize,
  onNavigate,
}: CanvasMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const minimapHeight = Math.round(MINIMAP_WIDTH * (officeHeight / officeWidth));
  const scaleX = MINIMAP_WIDTH / (officeWidth * tileSize);
  const scaleY = minimapHeight / (officeHeight * tileSize);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, MINIMAP_WIDTH, minimapHeight);

    // Draw walls
    ctx.fillStyle = WALL_COLOR;
    for (let y = 0; y < collisionGrid.length; y++) {
      for (let x = 0; x < (collisionGrid[y]?.length || 0); x++) {
        if (collisionGrid[y][x]) {
          ctx.fillRect(
            x * tileSize * scaleX,
            y * tileSize * scaleY,
            tileSize * scaleX + 0.5,
            tileSize * scaleY + 0.5
          );
        }
      }
    }

    // Draw agents
    for (const agent of agents) {
      ctx.fillStyle = agent.color;
      ctx.beginPath();
      ctx.arc(agent.x * scaleX, agent.y * scaleY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw viewport rectangle
    if (viewport) {
      ctx.strokeStyle = VIEWPORT_BORDER;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = VIEWPORT_COLOR;
      const vx = viewport.x * scaleX;
      const vy = viewport.y * scaleY;
      const vw = viewport.width * scaleX;
      const vh = viewport.height * scaleY;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.strokeRect(vx, vy, vw, vh);
      ctx.setLineDash([]);
    }
  }, [collisionGrid, agents, viewport, minimapHeight, scaleX, scaleY, tileSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = mx / scaleX;
    const worldY = my / scaleY;
    onNavigate(worldX, worldY);
  }

  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-xl border bg-card p-2 cursor-pointer">
      <canvas
        ref={canvasRef}
        width={MINIMAP_WIDTH}
        height={minimapHeight}
        onClick={handleClick}
        className="rounded-lg"
      />
    </div>
  );
}
