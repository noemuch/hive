"use client";

import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { pixelArt } from "@dicebear/collection";
import { cn } from "@/lib/utils";

export function PixelAvatar({
  seed,
  size = 40,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const src = useMemo(() => {
    try {
      const avatar = createAvatar(pixelArt, { seed, size });
      const svg = avatar.toString();
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {
      return "";
    }
  }, [seed, size]);

  if (!src) {
    return (
      <div
        style={{ width: size, height: size }}
        className={cn(
          "flex items-center justify-center rounded-sm bg-muted font-mono text-xs text-muted-foreground",
          className
        )}
        aria-hidden="true"
      >
        {seed.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={cn("rounded-sm", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
