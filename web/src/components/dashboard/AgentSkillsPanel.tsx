"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/providers/auth-provider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { capitalize } from "@/lib/utils";
import {
  SkillsBrowser,
  type MarketplaceEntry,
  type SkillOrToolKind,
} from "./SkillsBrowser";

type AttachedItem = MarketplaceEntry;

export function AgentSkillsPanel({
  agentId,
  agentName,
  open,
  onOpenChange,
}: {
  agentId: string | null;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<SkillOrToolKind>("skill");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 overflow-hidden p-0"
      >
        <SheetHeader className="border-b p-5">
          <SheetTitle>Configure {agentName}</SheetTitle>
          <SheetDescription>
            Attach skills and tools. Changes apply on the next agent restart.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SkillOrToolKind)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="border-b px-5 py-3">
            <TabsList>
              <TabsTrigger value="skill">Skills</TabsTrigger>
              <TabsTrigger value="tool">Tools</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="skill" className="min-h-0 flex-1 overflow-y-auto">
            <AttachedList agentId={agentId} kind="skill" />
          </TabsContent>
          <TabsContent value="tool" className="min-h-0 flex-1 overflow-y-auto">
            <AttachedList agentId={agentId} kind="tool" />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function AttachedList({
  agentId,
  kind,
}: {
  agentId: string | null;
  kind: SkillOrToolKind;
}) {
  const { authFetch } = useAuth();
  const [items, setItems] = useState<AttachedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiMissing, setApiMissing] = useState(false);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  const kindLabel = kind === "skill" ? "skills" : "tools";
  const kindLabelSingular = kind === "skill" ? "skill" : "tool";
  const listPath =
    kind === "skill"
      ? `/api/agents/${agentId}/skills`
      : `/api/agents/${agentId}/tools`;

  const fetchItems = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const res = await authFetch(listPath);
      if (res.status === 404) {
        setApiMissing(true);
        setItems([]);
        return;
      }
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items?: AttachedItem[] };
      setApiMissing(false);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [agentId, authFetch, listPath]);

  // Sync attached-list state with external `agentId` prop.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!agentId) {
      setItems(null);
      return;
    }
    fetchItems();
  }, [agentId, fetchItems]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleDetach(item: AttachedItem) {
    if (!agentId) return;
    setDetachingId(item.id);
    try {
      const res = await authFetch(
        `${listPath}/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
        toast.success(`Detached ${item.name}`);
      } else if (res.status === 404) {
        toast.error(`${kindLabel} API not available yet`);
      } else {
        toast.error(`Failed to detach ${kindLabelSingular}`);
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setDetachingId(null);
    }
  }

  const attachedIds = useMemo(() => new Set((items ?? []).map((i) => i.id)), [items]);
  const count = items?.length ?? 0;

  return (
    <div className="flex h-full flex-col gap-0">
      <div className="flex-1 p-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Attached {kindLabel}
          {items && ` (${count})`}
        </p>

        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : apiMissing ? (
          <EmptyState
            title={`${capitalize(kindLabel)} coming soon`}
            body={`The ${kindLabel} registry is not available yet. This UI is ready — it will work automatically once the API ships.`}
          />
        ) : !items || items.length === 0 ? (
          <EmptyState
            title={`No ${kindLabel} attached`}
            body={`Browse the marketplace to attach your first ${kindLabelSingular}.`}
          />
        ) : (
          <ul className="flex flex-col divide-y">
            {items.map((item) => {
              const detaching = detachingId === item.id;
              return (
                <li
                  key={item.id}
                  className="group flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    {item.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                    {item.tags && item.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.tags.slice(0, 3).map((tag) => (
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
                    variant="ghost"
                    disabled={detaching}
                    onClick={() => handleDetach(item)}
                    aria-label={`Detach ${item.name}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                  >
                    {detaching ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <XIcon className="size-3.5" />
                    )}
                    Detach
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t p-5">
        <Button
          variant="outline"
          className="w-full"
          disabled={apiMissing}
          onClick={() => setBrowserOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Browse {kindLabel} marketplace
        </Button>
      </div>

      {agentId && (
        <SkillsBrowser
          open={browserOpen}
          onOpenChange={setBrowserOpen}
          agentId={agentId}
          kind={kind}
          attachedIds={attachedIds}
          onAttached={fetchItems}
        />
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

