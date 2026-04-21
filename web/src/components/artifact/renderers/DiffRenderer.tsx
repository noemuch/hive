"use client";

import { cn } from "@/lib/utils";
import type { ArtifactRendererProps } from "../types";

// Line kind for unified-diff rendering. `meta` covers the file header
// (---/+++), hunk header (@@ ... @@), and `diff --git` preambles.
type DiffLineKind = "add" | "remove" | "context" | "meta";

type DiffLine = { kind: DiffLineKind; text: string };

// Classify a single diff line. Order matters: `---` and `+++` must be
// matched BEFORE the single-char add/remove prefixes.
function classifyLine(raw: string): DiffLine {
  if (raw.startsWith("+++") || raw.startsWith("---")) return { kind: "meta", text: raw };
  if (raw.startsWith("@@")) return { kind: "meta", text: raw };
  if (raw.startsWith("diff --git")) return { kind: "meta", text: raw };
  if (raw.startsWith("index ") || raw.startsWith("similarity index")) return { kind: "meta", text: raw };
  if (raw.startsWith("+")) return { kind: "add", text: raw };
  if (raw.startsWith("-")) return { kind: "remove", text: raw };
  return { kind: "context", text: raw };
}

export function parseUnifiedDiff(source: string): DiffLine[] {
  return source.split("\n").map(classifyLine);
}

// Cap to keep mobile rendering responsive. Large diffs beyond this threshold
// are truncated with a footer note; the full source stays in `artifact.content`
// and users can still download it via the API.
const MAX_DIFF_LINES = 2000;

const LINE_STYLES: Record<DiffLineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-300",
  remove: "bg-rose-500/10 text-rose-300",
  context: "text-foreground/80",
  meta: "bg-muted/60 text-muted-foreground",
};

export function DiffRenderer({ artifact, className }: ArtifactRendererProps) {
  const source = typeof artifact.content === "string" ? artifact.content : "";
  if (source.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground" data-testid="artifact-diff-empty">
        No diff content.
      </div>
    );
  }
  const allLines = parseUnifiedDiff(source);
  const truncated = allLines.length > MAX_DIFF_LINES;
  const lines = truncated ? allLines.slice(0, MAX_DIFF_LINES) : allLines;
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border bg-background font-mono text-xs leading-relaxed",
        className
      )}
      data-testid="artifact-diff"
      role="region"
      aria-label="Code diff"
    >
      <pre className="min-w-full">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn("whitespace-pre px-4 py-0.5", LINE_STYLES[line.kind])}
          >
            {line.text.length === 0 ? " " : line.text}
          </div>
        ))}
      </pre>
      {truncated && (
        <div
          className="border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground"
          data-testid="artifact-diff-truncated"
        >
          Truncated — showing {MAX_DIFF_LINES} of {allLines.length} lines. Download the artifact to view the full diff.
        </div>
      )}
    </div>
  );
}
