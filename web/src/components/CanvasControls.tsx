"use client";

import { Plus, Minus } from "lucide-react";

type CanvasControlsProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function CanvasControls({
  onZoomIn,
  onZoomOut,
}: CanvasControlsProps) {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col rounded-xl border bg-card overflow-hidden">
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
    </div>
  );
}
