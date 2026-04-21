"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileJson, Copy, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// Capability Manifest v1 viewer (issue #231). Collapsed `<details>` summary on
// the agent profile page — appeals to developers + exposes the proof that the
// agent data is machine-readable. Fetched lazily on open to keep the profile
// page fast.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const COPY_FLASH_MS = 1500;

export type ManifestViewerProps = {
  agentId: string;
  className?: string;
};

type Status = "idle" | "loading" | "ready" | "error";

export function ManifestViewer({ agentId, className }: ManifestViewerProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [manifest, setManifest] = useState<unknown>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    if (status === "loading" || status === "ready") return;
    setStatus("loading");
    setErrMsg("");
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/manifest`);
      if (!res.ok) {
        setErrMsg(`HTTP ${res.status}`);
        setStatus("error");
        return;
      }
      const json = await res.json();
      setManifest(json);
      setStatus("ready");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Network error");
      setStatus("error");
    }
  }, [agentId, status]);

  const onToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      if (e.currentTarget.open) void load();
    },
    [load]
  );

  const copy = useCallback(async () => {
    if (manifest === null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), COPY_FLASH_MS);
    } catch {
      // Clipboard blocked — silently ignore; user can select + copy manually.
    }
  }, [manifest]);

  const manifestUrl = `${API_URL}/api/agents/${agentId}/manifest`;

  return (
    <details
      className={cn("rounded-xl border bg-card overflow-hidden group", className)}
      onToggle={onToggle}
    >
      <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none border-b border-transparent group-open:border-border hover:bg-muted/30">
        <div className="flex items-center gap-2">
          <FileJson className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">Manifest (JSON)</span>
          <span className="text-xs text-muted-foreground">Capability Manifest v1</span>
        </div>
        <span className="text-xs text-muted-foreground group-open:hidden">Expand</span>
        <span className="text-xs text-muted-foreground hidden group-open:inline">Collapse</span>
      </summary>

      <div className="px-4 py-3">
        {status === "idle" && (
          <p className="text-xs text-muted-foreground">Loading manifest…</p>
        )}

        {status === "loading" && (
          <p className="text-xs text-muted-foreground">Loading manifest…</p>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <span>Failed to load manifest{errMsg ? `: ${errMsg}` : ""}.</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                setStatus("idle");
                void load();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {status === "ready" && manifest !== null && (
          <div className="space-y-2">
            <div className="flex items-center justify-end gap-2">
              <a
                href={manifestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Raw
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copy}
                aria-label="Copy manifest JSON"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <pre className="rounded-md border bg-muted/30 p-3 text-[11px] leading-snug overflow-auto max-h-96 font-mono">
              {JSON.stringify(manifest, null, 2)}
            </pre>
            <p className="text-[11px] text-muted-foreground">
              Capability Manifest v1 — schema documented in{" "}
              <code className="text-[11px] font-mono">docs/AGENT.md</code>.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
