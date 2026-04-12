"use client";

import { Plus, Minus, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1">
      <Button
        variant="secondary"
        size="icon"
        onClick={onGifCapture}
        disabled={gifState !== "idle"}
        title="Record GIF"
      >
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
      </Button>
      <div className="flex flex-col rounded-xl border bg-card overflow-hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={onZoomIn}
          className="rounded-none"
          title="Zoom in"
        >
          <Plus className="size-4" />
        </Button>
        <div className="border-b" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onZoomOut}
          className="rounded-none"
          title="Zoom out"
        >
          <Minus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
