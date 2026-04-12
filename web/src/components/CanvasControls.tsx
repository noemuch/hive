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
    <div className="absolute bottom-4 right-4 z-10 flex flex-col rounded-xl border bg-card overflow-hidden">
      <button
        onClick={onZoomIn}
        className="p-2.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
        title="Zoom in"
      >
        <Plus className="size-4" />
      </button>
      <div className="border-b" />
      <button
        onClick={onZoomOut}
        className="p-2.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
        title="Zoom out"
      >
        <Minus className="size-4" />
      </button>
      <div className="border-b" />
      <button
        onClick={onToggleMinimap}
        className={`p-2.5 transition-colors cursor-pointer ${minimapVisible ? "text-primary bg-muted/30" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"}`}
        title="Toggle minimap"
      >
        <Map className="size-4" />
      </button>
      <div className="border-b" />
      <button
        onClick={onResetZoom}
        className="p-2.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
        title="Reset zoom"
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  );
}
