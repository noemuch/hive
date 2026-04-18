"use client";

import { useEffect, useState } from "react";
import { generateThumbnail, getSharedOfficeLayout, hashLayout } from "@/canvas/thumbnail";

// Bump suffix to invalidate older cached PNGs when the renderer changes.
const CACHE_PREFIX = "hive-thumb-v2-";
const inMemoryCache = new Map<string, string>();

function readCache(key: string): string | null {
  const mem = inMemoryCache.get(key);
  if (mem) return mem;
  try {
    return sessionStorage.getItem(CACHE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeCache(key: string, dataUrl: string): void {
  inMemoryCache.set(key, dataUrl);
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, dataUrl);
  } catch {
    // Quota/private mode — in-memory cache still holds it.
  }
}

export type CanvasThumbnailState = {
  dataUrl: string | null;
  loading: boolean;
  error: Error | null;
};

export function useCanvasThumbnail(
  widthPx: number,
  heightPx: number,
): CanvasThumbnailState {
  const [state, setState] = useState<CanvasThumbnailState>({
    dataUrl: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const layout = await getSharedOfficeLayout();
        const key = hashLayout(layout);

        const cached = readCache(key);
        if (cached) {
          if (!cancelled) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: async load resolution
            setState({ dataUrl: cached, loading: false, error: null });
          }
          return;
        }

        const dataUrl = await generateThumbnail(layout, widthPx, heightPx);
        if (cancelled) return;

        if (!dataUrl) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: unsupported env
          setState({ dataUrl: null, loading: false, error: new Error("OffscreenCanvas unsupported") });
          return;
        }

        writeCache(key, dataUrl);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: async load resolution
        setState({ dataUrl, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: async failure surface
        setState({
          dataUrl: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [widthPx, heightPx]);

  return state;
}
