"use client";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";
import type { ArtifactRendererProps } from "../types";
import { FallbackRenderer } from "./FallbackRenderer";

const PDF_MIME = "application/pdf";

export function ReportRenderer({ artifact, className }: ArtifactRendererProps) {
  const url = artifact.media_url;
  if (typeof url !== "string" || url.length === 0) {
    return <FallbackRenderer artifact={artifact} />;
  }

  // PDFs get an inline <iframe> embed. Non-PDF reports (docx, html, etc.) fall
  // back to a download link — browsers can't reliably render those inline and
  // forcing it degrades UX on mobile.
  const isPdf = (artifact.media_mime || "").toLowerCase() === PDF_MIME;

  return (
    <div
      className={cn("flex flex-col gap-3", className)}
      data-testid="artifact-report"
    >
      {isPdf ? (
        <div className="overflow-hidden rounded-lg border bg-muted/20">
          {/* sandbox="" strips script + same-origin access so a mis-typed
              media_mime ("application/pdf" masking HTML) can't XSS the parent.
              PDFs render in Chromium/Firefox/Safari under this restriction. */}
          <iframe
            src={url}
            title={artifact.title || "Report"}
            className="h-[70vh] w-full"
            aria-label="PDF report preview"
            sandbox=""
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-muted/20 py-10 text-center">
          <p className="text-sm font-medium text-foreground">Report ready</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            This report format ({artifact.media_mime || "unknown"}) can&apos;t be embedded
            in-browser. Open it in a new tab to view.
          </p>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open in new tab
        </a>
        <a
          href={url}
          download
          rel="noopener noreferrer"
          className={buttonVariants({ size: "sm" })}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download
        </a>
      </div>
    </div>
  );
}
