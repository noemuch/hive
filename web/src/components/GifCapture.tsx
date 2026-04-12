"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Application, Ticker } from "pixi.js";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { Camera, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECORD_DURATION_S = 4;
const TARGET_FPS = 10;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const MAX_GIF_WIDTH = 480;

type CaptureState = "idle" | "recording" | "encoding" | "preview";

type FrameData = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a frame is all zeros (black/empty — iOS Safari readPixels bug) */
function isZeroFrame(pixels: Uint8ClampedArray): boolean {
  // Sample every 1000th pixel for speed
  for (let i = 0; i < pixels.length; i += 4000) {
    if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GifCapture({
  app,
  companyName,
}: {
  app: Application | null;
  companyName: string;
}) {
  const [state, setState] = useState<CaptureState>("idle");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifBlob, setGifBlob] = useState<Blob | null>(null);

  const framesRef = useRef<FrameData[]>([]);
  const mountedRef = useRef(true);
  const tickerCallbackRef = useRef<((ticker: Ticker) => void) | null>(null);
  const gifUrlRef = useRef<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort recording if active
      if (tickerCallbackRef.current && app) {
        app.ticker.remove(tickerCallbackRef.current);
        tickerCallbackRef.current = null;
      }
      framesRef.current = [];
      // Revoke any lingering blob URL (unmount during preview state)
      if (gifUrlRef.current) {
        URL.revokeObjectURL(gifUrlRef.current);
        gifUrlRef.current = null;
      }
    };
  }, [app]);

  // Tab visibility — abort recording when tab hidden
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && state === "recording") {
        if (tickerCallbackRef.current && app) {
          app.ticker.remove(tickerCallbackRef.current);
          tickerCallbackRef.current = null;
        }
        framesRef.current = [];
        setState("idle");
        toast("Recording cancelled");
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [state, app]);

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  const startRecording = useCallback(() => {
    if (!app || state !== "idle") return;

    setState("recording");
    framesRef.current = [];

    let elapsed = 0;
    let totalElapsed = 0;
    const maxDuration = RECORD_DURATION_S * 1000;

    const tickerCallback = (ticker: Ticker) => {
      totalElapsed += ticker.deltaMS;
      elapsed += ticker.deltaMS;

      // Stop after duration
      if (totalElapsed >= maxDuration) {
        app.ticker.remove(tickerCallback);
        tickerCallbackRef.current = null;
        if (mountedRef.current) {
          encode();
        }
        return;
      }

      // Capture at target FPS
      if (elapsed >= FRAME_INTERVAL_MS) {
        elapsed -= FRAME_INTERVAL_MS;

        try {
          const extracted = app.renderer.extract.pixels({
            target: app.stage,
          });

          // Downscale to max 480px wide for smaller GIFs
          const srcW = extracted.width;
          const srcH = extracted.height;
          if (srcW > MAX_GIF_WIDTH) {
            const scale = MAX_GIF_WIDTH / srcW;
            const dstW = Math.round(srcW * scale);
            const dstH = Math.round(srcH * scale);
            const offscreen = new OffscreenCanvas(dstW, dstH);
            const ctx = offscreen.getContext("2d")!;
            const imgData = new ImageData(new Uint8ClampedArray(extracted.pixels.buffer as ArrayBuffer), srcW, srcH);
            const srcCanvas = new OffscreenCanvas(srcW, srcH);
            srcCanvas.getContext("2d")!.putImageData(imgData, 0, 0);
            ctx.drawImage(srcCanvas, 0, 0, dstW, dstH);
            const downscaled = ctx.getImageData(0, 0, dstW, dstH);

            if (!isZeroFrame(downscaled.data)) {
              framesRef.current.push({ pixels: downscaled.data, width: dstW, height: dstH });
            }
          } else {
            const { pixels, width, height } = extracted;
            if (!isZeroFrame(pixels)) {
              framesRef.current.push({ pixels, width, height });
            }
          }
        } catch {
          // CORS taint or other extract error — abort
          app.ticker.remove(tickerCallback);
          tickerCallbackRef.current = null;
          framesRef.current = [];
          if (mountedRef.current) {
            setState("idle");
            toast.error("Capture unavailable");
          }
          return;
        }
      }
    };

    tickerCallbackRef.current = tickerCallback;
    app.ticker.add(tickerCallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, state]);

  // -------------------------------------------------------------------------
  // Encoding
  // -------------------------------------------------------------------------

  const encode = useCallback(() => {
    if (!mountedRef.current) return;

    const frames = framesRef.current;

    if (frames.length === 0) {
      setState("idle");
      toast.error("Capture failed — try again");
      return;
    }

    setState("encoding");

    // Use requestAnimationFrame to let the UI update to "encoding" state before blocking
    requestAnimationFrame(() => {
      const { width, height } = frames[0];

      // Build shared palette from sampled frames [0, N/2, N-1]
      const sampleIndices = [
        0,
        Math.floor(frames.length / 2),
        frames.length - 1,
      ];
      const uniqueIndices = [...new Set(sampleIndices)];

      // Merge sampled frame pixels for quantization
      const totalSamplePixels = uniqueIndices.reduce(
        (sum, i) => sum + frames[i].pixels.length,
        0,
      );
      const mergedSample = new Uint8Array(totalSamplePixels);
      let offset = 0;
      for (const idx of uniqueIndices) {
        mergedSample.set(frames[idx].pixels, offset);
        offset += frames[idx].pixels.length;
      }

      const palette = quantize(mergedSample, 256, { format: "rgb444" });

      const gif = GIFEncoder();
      const delay = Math.round(1000 / TARGET_FPS);

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const index = applyPalette(frame.pixels, palette, "rgb444");

        gif.writeFrame(index, width, height, {
          palette: i === 0 ? palette : undefined,
          delay,
          dispose: 0,
        });

        // Free buffer immediately after encoding
        // @ts-expect-error - intentionally nulling for GC
        frames[i] = null;
      }

      gif.finish();
      framesRef.current = [];

      if (!mountedRef.current) return;

      const blob = new Blob([gif.bytes() as unknown as Uint8Array<ArrayBuffer>], { type: "image/gif" });
      const url = URL.createObjectURL(blob);

      gifUrlRef.current = url;
      setGifBlob(blob);
      setGifUrl(url);
      setState("preview");
    });
  }, []);

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  const downloadGif = useCallback(() => {
    if (!gifUrl || !gifBlob) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeName = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "office";
    const filename = `hive-${safeName}-${timestamp}.gif`;

    const a = document.createElement("a");
    a.href = gifUrl;
    a.download = filename;
    a.click();
  }, [gifUrl, gifBlob, companyName]);

  // -------------------------------------------------------------------------
  // Dialog close
  // -------------------------------------------------------------------------

  const closePreview = useCallback(() => {
    if (gifUrl) {
      URL.revokeObjectURL(gifUrl);
      gifUrlRef.current = null;
      setGifUrl(null);
    }
    setGifBlob(null);
    setState("idle");
  }, [gifUrl]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      {/* Capture button — bottom-right overlay */}
      <button
        onClick={startRecording}
        disabled={state !== "idle"}
        aria-label={
          state === "idle"
            ? "Record GIF (4 seconds)"
            : state === "recording"
              ? "Recording in progress"
              : "Encoding GIF"
        }
        className="absolute bottom-4 right-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-xl p-2.5 text-white/60 transition-colors hover:text-white hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
        style={{ backgroundColor: "rgba(26, 26, 46, 0.9)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {state === "idle" && (
          <>
            <Camera aria-hidden="true" className="h-3.5 w-3.5" />
            <span>GIF</span>
          </>
        )}
        {state === "recording" && (
          <>
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span>REC</span>
          </>
        )}
        {state === "encoding" && (
          <>
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 motion-safe:animate-spin" />
            <span>Encoding…</span>
          </>
        )}
      </button>

      {/* Preview Dialog */}
      <Dialog
        open={state === "preview"}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>GIF Preview</DialogTitle>
          </DialogHeader>

          {gifUrl && (
            <div className="flex justify-center rounded-lg bg-black/20 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gifUrl}
                alt="Captured GIF"
                className="max-h-[300px] rounded"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
          )}

          {gifBlob && (
            <p className="text-center text-xs text-muted-foreground">
              {(gifBlob.size / 1024).toFixed(0)} KB
            </p>
          )}

          <DialogFooter>
            <Button onClick={downloadGif} className="w-full sm:w-auto">
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
