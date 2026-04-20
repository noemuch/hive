"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/providers/auth-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, SearchIcon } from "lucide-react";
import { toast } from "sonner";

export type SkillOrToolKind = "skill" | "tool";

export type MarketplaceEntry = {
  id: string;
  name: string;
  description: string;
  tags?: string[];
};

const SEARCH_DEBOUNCE_MS = 300;

export function SkillsBrowser({
  open,
  onOpenChange,
  agentId,
  kind,
  attachedIds,
  onAttached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  kind: SkillOrToolKind;
  /** Ids already attached — shown as disabled "Attached" in results. */
  attachedIds: Set<string>;
  /** Called after a successful attach so the parent can refresh. */
  onAttached: () => void;
}) {
  const { authFetch } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketplaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [apiMissing, setApiMissing] = useState(false);

  const kindLabel = kind === "skill" ? "skills" : "tools";
  const kindLabelSingular = kind === "skill" ? "skill" : "tool";
  const marketplacePath = kind === "skill" ? "/api/skills" : "/api/tools";
  const attachPath =
    kind === "skill"
      ? `/api/agents/${agentId}/skills`
      : `/api/agents/${agentId}/tools`;

  // Reset on close — hydrate internal state from external `open` signal.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(null);
      setApiMissing(false);
      setLoading(false);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Debounced search — sync results with external `query` input.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }

    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await authFetch(
          `${marketplacePath}?q=${encodeURIComponent(trimmed)}`,
          { signal: ac.signal },
        );
        if (res.status === 404) {
          setApiMissing(true);
          setResults([]);
          return;
        }
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { items?: MarketplaceEntry[] };
        setResults(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [query, open, marketplacePath, authFetch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleAttach = useCallback(
    async (entry: MarketplaceEntry) => {
      setAttachingId(entry.id);
      try {
        const res = await authFetch(attachPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id }),
        });
        if (res.ok) {
          toast.success(`Attached ${entry.name}`);
          onAttached();
        } else if (res.status === 404) {
          toast.error(`${kindLabel} API not available yet`);
        } else if (res.status === 409) {
          toast.info(`${entry.name} is already attached`);
        } else {
          toast.error(`Failed to attach ${kindLabelSingular}`);
        }
      } catch {
        toast.error("Network error. Please try again.");
      } finally {
        setAttachingId(null);
      }
    },
    [attachPath, authFetch, kindLabel, kindLabelSingular, onAttached],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-full flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Browse {kindLabel}</DialogTitle>
          <DialogDescription>
            Search the marketplace and attach to this agent.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b p-4">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${kindLabel}...`}
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {apiMissing ? (
            <EmptyState
              title={`${capitalize(kindLabel)} marketplace coming soon`}
              body={`The ${kindLabel} registry API is not available yet.`}
            />
          ) : !query.trim() ? (
            <EmptyState
              title={`Search ${kindLabel}`}
              body={`Type to search the ${kindLabel} marketplace.`}
            />
          ) : loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : !results || results.length === 0 ? (
            <EmptyState
              title="No results"
              body={`No ${kindLabel} matched "${query.trim()}".`}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((entry) => {
                const already = attachedIds.has(entry.id);
                const attaching = attachingId === entry.id;
                return (
                  <li
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {entry.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {entry.description}
                      </p>
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {entry.tags.slice(0, 4).map((tag) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={already ? "secondary" : "default"}
                      disabled={already || attaching}
                      onClick={() => handleAttach(entry)}
                      className="shrink-0"
                    >
                      {attaching && <Loader2 className="size-3.5 animate-spin" />}
                      {already ? "Attached" : "Attach"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
