"use client";

import { ArtifactContent } from "@/components/ArtifactContent";
import type { ArtifactRendererProps } from "../types";

// Renders text/markdown artefacts — `message` plus legacy types
// (ticket/spec/decision/component/pr/document). Delegates to the existing
// ArtifactContent markdown renderer.
export function TextRenderer({ artifact, className }: ArtifactRendererProps) {
  if (typeof artifact.content !== "string" || artifact.content.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground" data-testid="artifact-text-empty">
        No content.
      </div>
    );
  }
  return <ArtifactContent content={artifact.content} className={className} />;
}
