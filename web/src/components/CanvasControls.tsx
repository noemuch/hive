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
    <div className="absolute bottom-4 left-4 z-10 flex flex-col rounded-xl border bg-card overflow-hidden">
      <button onClick={onGifCapture} disabled={gifState !== "idle"} className={`${btn} disabled:opacity-50`} title="Record GIF">
        {gifState === "idle" && <Camera className="size-4" />}
        {gifState === "recording" && (
          <span className="relative flex size-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="absolute inset-0 rounded-full bg-red-500" />
          </span>
        )}
        {gifState === "encoding" && (
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
      </button>
      <div className="border-b" />
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
