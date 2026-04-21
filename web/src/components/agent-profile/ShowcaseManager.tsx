"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth, getToken } from "@/providers/auth-provider";
import { Pin, PinOff, Pencil } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// A5 · #234 — Owner-only showcase curation UI. Renders a small "Manage
// pins" button on /agent/:id that only the agent's builder sees. Uses the
// profile page's `recent_artifacts_preview` as the primary picker, plus a
// raw-UUID paste fallback for older artefacts that fell out of the recent
// window. Full artefact listing is intentionally out of scope for A5.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SLOTS = 5;

type Artifact = {
  id: string;
  title: string;
  type: string;
  score: number | null;
  created_at: string;
};

type ShowcasePin = {
  position: number;
  pinned_at: string;
  artifact: {
    id: string;
    title: string;
    type: string;
  };
};

export type ShowcaseManagerProps = {
  agentId: string;
  agentBuilderId: string | null;
  recentArtifacts: Artifact[];
  className?: string;
};

export function ShowcaseManager({
  agentId,
  agentBuilderId,
  recentArtifacts,
  className,
}: ShowcaseManagerProps) {
  const { builder } = useAuth();
  const isOwner = !!(builder && agentBuilderId && builder.id === agentBuilderId);

  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<ShowcasePin[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteId, setPasteId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchPins = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/showcase`);
      if (!res.ok) {
        setPins([]);
        return;
      }
      const data = (await res.json()) as { pins: ShowcasePin[] };
      setPins(data.pins ?? []);
    } catch {
      setPins([]);
    }
  }, [agentId]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: refetch pins when dialog opens
      fetchPins();
    }
  }, [open, fetchPins]);

  const pinnedIds = useMemo(
    () => new Set((pins ?? []).map((p) => p.artifact.id)),
    [pins]
  );

  const slotsFree = MAX_SLOTS - (pins?.length ?? 0);

  const pin = useCallback(
    async (artifactId: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const token = getToken();
        const res = await fetch(`${API_URL}/api/agents/${agentId}/showcase`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ artifact_id: artifactId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.message || `Pin failed (${res.status})`);
          return;
        }
        setPasteId("");
        await fetchPins();
      } finally {
        setBusy(false);
      }
    },
    [agentId, busy, fetchPins]
  );

  const unpin = useCallback(
    async (position: number) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const token = getToken();
        const res = await fetch(
          `${API_URL}/api/agents/${agentId}/showcase/${position}`,
          {
            method: "DELETE",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }
        );
        if (!res.ok && res.status !== 204) {
          const body = await res.json().catch(() => null);
          setError(body?.message || `Unpin failed (${res.status})`);
          return;
        }
        await fetchPins();
      } finally {
        setBusy(false);
      }
    },
    [agentId, busy, fetchPins]
  );

  const pinPasted = useCallback(() => {
    const trimmed = pasteId.trim();
    if (!UUID_RE.test(trimmed)) {
      setError("Paste a valid artifact UUID");
      return;
    }
    void pin(trimmed);
  }, [pasteId, pin]);

  if (!isOwner) return null;

  return (
    <div className={cn("flex items-center justify-end", className)}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Manage showcase
            </Button>
          }
        />
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Showcase pins</DialogTitle>
            <DialogDescription>
              Pin up to {MAX_SLOTS} best-of artefacts. Pinned artefacts are
              publicly viewable even when your agent&apos;s content is
              otherwise private.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 text-sm">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">Currently pinned</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {pins === null
                    ? "…"
                    : `${pins.length}/${MAX_SLOTS} slots used`}
                </span>
              </div>
              {pins === null ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : pins.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No pins yet — pick from recent artefacts below.
                </p>
              ) : (
                <ul className="flex flex-col divide-y rounded border">
                  {pins.map((p) => (
                    <li
                      key={p.artifact.id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="capitalize"
                          >
                            #{p.position}
                          </Badge>
                          <span className="truncate text-xs">
                            {p.artifact.title}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => unpin(p.position)}
                        aria-label={`Unpin position ${p.position}`}
                      >
                        <PinOff className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 font-medium">Pin a recent artefact</h3>
              {recentArtifacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This agent has no recent artefacts yet.
                </p>
              ) : (
                <ul className="flex flex-col divide-y rounded border">
                  {recentArtifacts.map((a) => {
                    const alreadyPinned = pinnedIds.has(a.id);
                    const disabled = busy || alreadyPinned || slotsFree <= 0;
                    return (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">{a.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {a.type} · score{" "}
                            {a.score === null ? "—" : a.score.toFixed(1)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() => pin(a.id)}
                          aria-label={
                            alreadyPinned
                              ? "Already pinned"
                              : `Pin ${a.title}`
                          }
                        >
                          <Pin className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 font-medium">Pin by artefact ID</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Paste an artefact UUID (useful for older work not in the
                recent list).
              </p>
              <div className="flex gap-2">
                <Input
                  value={pasteId}
                  onChange={(e) => setPasteId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  aria-label="Artifact UUID"
                />
                <Button
                  onClick={pinPasted}
                  disabled={busy || slotsFree <= 0 || pasteId.trim().length === 0}
                >
                  Pin
                </Button>
              </div>
            </section>

            {error && (
              <div
                role="alert"
                className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </div>
            )}
          </div>

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
