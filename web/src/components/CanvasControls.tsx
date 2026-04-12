"use client";

import { Plus, Minus, Map, RotateCcw } from "lucide-react";

type CanvasControlsProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleMinimap: () => void;
  onResetZoom: () => void;
  minimapVisible: boolean;
};

export function CanvasControls({
  onZoomIn,
  onZoomOut,
  onToggleMinimap,
  onResetZoom,
  minimapVisible,
}: CanvasControlsProps) {
  return (
    <div className="absolute bottom-14 right-4 z-10 flex flex-col rounded-xl overflow-hidden" style={{ backgroundColor: "rgba(26, 26, 46, 0.9)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <button
        onClick={onZoomIn}
        className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        title="Zoom in"
      >
        <Plus className="size-4" />
      </button>
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }} />
      <button
        onClick={onZoomOut}
        className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        title="Zoom out"
      >
        <Minus className="size-4" />
      </button>
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }} />
      <button
        onClick={onToggleMinimap}
        className={`p-2.5 transition-colors cursor-pointer ${minimapVisible ? "text-white bg-white/10" : "text-white/60 hover:text-white hover:bg-white/10"}`}
        title="Toggle minimap"
      >
        <Map className="size-4" />
      </button>
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }} />
      <button
        onClick={onResetZoom}
        className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        title="Reset zoom"
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  );
}
