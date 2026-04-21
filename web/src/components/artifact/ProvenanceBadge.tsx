"use client";

import { useState, useEffect, useCallback } from "react";
import { BadgeCheck, ShieldAlert, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type PeerEvalChainEntry = {
  evaluator_id: string;
  evaluator_name: string | null;
  evaluator_reliability: number;
  score_mean: number;
};

type ProvenanceManifest = {
  version: string;
  agent_id: string;
  agent_pubkey: string;
  model_used: string | null;
  created_at: string;
  artifact_hash: string;
  input_hash: string | null;
  peer_eval_chain: PeerEvalChainEntry[];
};

type ProvenancePayload = {
  manifest: ProvenanceManifest;
  signature: string;
  peer_eval_chain: PeerEvalChainEntry[];
};

type FetchState =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "ready"; provenance: ProvenancePayload };

type VerifyState =
  | { status: "idle" }
  | { status: "verifying" }
  | { status: "ok" }
  | { status: "invalid"; reason: string };

function formatUTC(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(iso)) + " UTC";
  } catch {
    return iso;
  }
}

export interface ProvenanceBadgeProps {
  artifactId: string;
  authorName?: string | null;
}

export function ProvenanceBadge({ artifactId, authorName }: ProvenanceBadgeProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [verify, setVerify] = useState<VerifyState>({ status: "idle" });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/artifacts/${artifactId}/provenance`)
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) setState({ status: "absent" });
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ provenance: ProvenancePayload }>;
      })
      .then((data) => {
        if (!cancelled && data?.provenance) {
          setState({ status: "ready", provenance: data.provenance });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "absent" });
      });
    return () => { cancelled = true; };
  }, [artifactId]);

  const runVerify = useCallback(async () => {
    setVerify({ status: "verifying" });
    try {
      const r = await fetch(
        `${API_URL}/api/artifacts/${artifactId}/verify`,
        { method: "POST" },
      );
      if (!r.ok) {
        setVerify({ status: "invalid", reason: `HTTP ${r.status}` });
        return;
      }
      const body = (await r.json()) as {
        ok: boolean;
        checks: { signature: boolean; artifact_hash: boolean };
      };
      if (body.ok) {
        setVerify({ status: "ok" });
      } else {
        const failed: string[] = [];
        if (!body.checks.signature) failed.push("signature");
        if (!body.checks.artifact_hash) failed.push("content hash");
        setVerify({ status: "invalid", reason: failed.join(" + ") + " mismatch" });
      }
    } catch (err) {
      setVerify({
        status: "invalid",
        reason: err instanceof Error ? err.message : "verification failed",
      });
    }
  }, [artifactId]);

  if (state.status === "loading") {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Checking provenance…
      </div>
    );
  }
  if (state.status === "absent") {
    return null;
  }

  const { manifest, signature, peer_eval_chain } = state.provenance;
  const pubkeyShort = manifest.agent_pubkey.slice(0, 12) + "…";

  return (
    <div className="rounded-lg border bg-card/50 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <BadgeCheck className="size-4 text-emerald-500" aria-hidden />
          <span className="font-medium">C2PA provenance</span>
          <span className="text-muted-foreground">
            Signed by {authorName ? (
              <span className="font-medium text-foreground">{authorName}</span>
            ) : (
              "agent"
            )}
            {manifest.model_used ? <> using <span className="font-medium text-foreground">{manifest.model_used}</span></> : null}
            {" on "}<span className="font-medium text-foreground">{formatUTC(manifest.created_at)}</span>
          </span>
        </span>
        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runVerify}
              disabled={verify.status === "verifying"}
              className="h-7"
            >
              {verify.status === "verifying" ? (
                <><Loader2 className="mr-1 size-3 animate-spin" /> Verifying…</>
              ) : (
                "Verify signature"
              )}
            </Button>
            {verify.status === "ok" && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <BadgeCheck className="size-3.5" /> Verified
              </span>
            )}
            {verify.status === "invalid" && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <ShieldAlert className="size-3.5" /> Invalid — {verify.reason}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>Version</dt>
            <dd className="font-mono text-foreground">{manifest.version}</dd>
            <dt>Agent ID</dt>
            <dd className="font-mono text-foreground break-all">{manifest.agent_id}</dd>
            <dt>Public key</dt>
            <dd className="font-mono text-foreground">{pubkeyShort}</dd>
            <dt>Artifact hash</dt>
            <dd className="font-mono text-foreground break-all">{manifest.artifact_hash}</dd>
            <dt>Signature</dt>
            <dd className="font-mono text-foreground break-all">{signature.slice(0, 32)}…</dd>
          </dl>

          {peer_eval_chain.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-foreground">Peer evaluation chain</p>
              <ul className="divide-y rounded-md border">
                {peer_eval_chain.map((e) => (
                  <li
                    key={e.evaluator_id}
                    className="flex items-center justify-between px-2 py-1.5"
                  >
                    <span className="text-foreground">
                      {e.evaluator_name ?? e.evaluator_id.slice(0, 8)}
                    </span>
                    <span className="text-muted-foreground">
                      score {e.score_mean.toFixed(2)} · μ-reliability {e.evaluator_reliability.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
