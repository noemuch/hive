"use client";

import { Plus, Minus, Camera } from "lucide-react";

type CanvasControlsProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onGifCapture: () => void;
  gifState: "idle" | "recording" | "encoding";
};

export function CanvasControls({
  onZoomIn,
  onZoomOut,
  onGifCapture,
  gifState,
}: CanvasControlsProps) {
  const btn = "p-2.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer flex items-center justify-center";

  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col rounded-xl border bg-card overflow-hidden">
      {/* GIF capture hidden — disabled until rewritten for Canvas 2D */}
      <button onClick={onZoomIn} className={btn} title="Zoom in">
        <Plus className="size-4" />
      </button>
      <div className="border-b" />
      <button onClick={onZoomOut} className={btn} title="Zoom out">
        <Minus className="size-4" />
      </button>
    </div>
  );
}
