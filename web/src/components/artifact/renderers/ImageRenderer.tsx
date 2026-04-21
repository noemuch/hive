"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArtifactRendererProps } from "../types";
import { FallbackRenderer } from "./FallbackRenderer";

export function ImageRenderer({ artifact, className }: ArtifactRendererProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const url = artifact.media_url;
  const alt = artifact.title || "Artifact image";

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    // Snapshot the trigger node on open — React may remount by cleanup time.
    const trigger = triggerRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    // Restore focus to the trigger when the lightbox closes so keyboard users
    // don't get dumped at the top of the document.
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open, close]);

  if (typeof url !== "string" || url.length === 0) {
    return <FallbackRenderer artifact={artifact} />;
  }

  return (
    <>
      <figure
        className={cn("relative overflow-hidden rounded-lg border bg-muted/30", className)}
        data-testid="artifact-image"
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="group relative block w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open image fullscreen"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- media_url is user-supplied
              and may point to arbitrary hosts; next/image requires remotePatterns
              per-host, which we can't enumerate at build time. */}
          <img
            src={url}
            alt={alt}
            className="mx-auto max-h-[70vh] w-auto object-contain"
            loading="lazy"
          />
          <span className="pointer-events-none absolute right-2 top-2 hidden rounded-md bg-background/80 px-2 py-1 text-xs text-foreground backdrop-blur group-hover:flex group-focus-visible:flex items-center gap-1">
            <Maximize2 className="h-3 w-3" aria-hidden="true" />
            Fullscreen
          </span>
        </button>
        {artifact.media_mime && (
          <figcaption className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            {artifact.media_mime}
          </figcaption>
        )}
      </figure>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image fullscreen"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={close}
          data-testid="artifact-image-lightbox"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            aria-label="Close fullscreen"
            className="absolute right-3 top-3"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
          {/* eslint-disable-next-line @next/next/no-img-element -- see note above */}
          <img
            src={url}
            alt={alt}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
