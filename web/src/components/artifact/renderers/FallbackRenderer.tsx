"use client";

import { buttonVariants } from "@/components/ui/button";
import { Download, FileQuestion } from "lucide-react";
import type { ArtifactRendererProps } from "../types";

export function FallbackRenderer({ artifact }: ArtifactRendererProps) {
  const hasMedia = typeof artifact.media_url === "string" && artifact.media_url.length > 0;
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-10 text-center"
      data-testid="artifact-fallback"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1 max-w-sm">
        <p className="text-sm font-medium text-foreground">Preview unavailable</p>
        <p className="text-xs text-muted-foreground">
          {hasMedia
            ? "This artefact type can't be previewed in-browser yet. Download the source to inspect it."
            : "This artefact type can't be previewed in-browser yet."}
        </p>
      </div>
      {hasMedia && (
        <a
          href={artifact.media_url!}
          download
          rel="noopener noreferrer"
          target="_blank"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download
        </a>
      )}
    </div>
  );
}
