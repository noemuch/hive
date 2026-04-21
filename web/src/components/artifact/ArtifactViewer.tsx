"use client";

import { cn } from "@/lib/utils";
import type { ArtifactViewModel, ArtifactType } from "./types";
import { TextRenderer } from "./renderers/TextRenderer";
import { DiffRenderer } from "./renderers/DiffRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { ReportRenderer } from "./renderers/ReportRenderer";
import { FallbackRenderer } from "./renderers/FallbackRenderer";

// Static renderer identifiers — pickRenderer returns one of these so callers
// can route without creating a new component reference during render
// (react-hooks/static-components requires stable component identity).
export const RENDERER_IDS = [
  "text",
  "diff",
  "image",
  "report",
  "fallback",
] as const;

export type RendererId = (typeof RENDERER_IDS)[number];

// Legacy text artefact types that predate A4 — they all render as markdown.
const LEGACY_TEXT_TYPES: ReadonlySet<string> = new Set([
  "ticket",
  "spec",
  "decision",
  "component",
  "pr",
  "document",
  "message",
]);

// Types we explicitly route to a fallback "Preview unavailable — download"
// surface. Shipped at launch per #235 acceptance criteria.
const FALLBACK_TYPES: ReadonlySet<string> = new Set([
  "audio",
  "video",
  "action_trace",
  "structured_json",
  "embedding",
]);

export function pickRenderer(type: ArtifactType): RendererId {
  const t = String(type);
  if (LEGACY_TEXT_TYPES.has(t)) return "text";
  if (t === "code_diff") return "diff";
  if (t === "image") return "image";
  if (t === "report") return "report";
  if (FALLBACK_TYPES.has(t)) return "fallback";
  // Unknown future type — degrade gracefully.
  return "fallback";
}

export type ArtifactViewerProps = {
  artifact: ArtifactViewModel;
  className?: string;
};

export function ArtifactViewer({ artifact, className }: ArtifactViewerProps) {
  // Private content (privacy gate blocked content) — show the standard
  // "private content" empty state consistent with /artifact/[id] legacy behavior.
  if (artifact.content === undefined && !artifact.media_url) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground",
          className
        )}
        data-testid="artifact-private"
      >
        <p className="font-medium text-foreground">Private content</p>
        <p className="mt-1 max-w-sm">
          This artifact&apos;s author keeps content private. Only the author&apos;s
          builder and teammates in the same company can read it.
        </p>
      </div>
    );
  }

  const rendererId = pickRenderer(artifact.type);
  return (
    <div className={cn("flex flex-col gap-3", className)} data-artifact-type={artifact.type}>
      {rendererId === "text" && <TextRenderer artifact={artifact} />}
      {rendererId === "diff" && <DiffRenderer artifact={artifact} />}
      {rendererId === "image" && <ImageRenderer artifact={artifact} />}
      {rendererId === "report" && <ReportRenderer artifact={artifact} />}
      {rendererId === "fallback" && <FallbackRenderer artifact={artifact} />}
      <ArtifactFooter artifact={artifact} />
    </div>
  );
}

function ArtifactFooter({ artifact }: { artifact: ArtifactViewModel }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{String(artifact.type)}</span>
      {artifact.media_mime && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{artifact.media_mime}</span>
      )}
    </div>
  );
}
