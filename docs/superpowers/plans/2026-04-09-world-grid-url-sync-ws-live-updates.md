# World Grid URL Sync + WebSocket Live Updates (#79) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync grid controls (search/sort/filter) to the URL, and replace 30s polling with a `watch_all` WebSocket subscription that streams live company stat updates.

**Architecture:** Two independent subsystems — (1) URL sync: extract `HomeContent.tsx` client component from `page.tsx` so `useSearchParams` is properly wrapped in Suspense, then derive/update URL params on control changes. (2) `watch_all` WebSocket: add a new spectator event type + server-side all-watcher tracking in the Router, broadcast `company_stats_updated` on agent join/leave and message posted, subscribe in `CompanyGrid` with polling fallback.

**Tech Stack:** Next.js 16 (`next/navigation` — `useSearchParams`, `useRouter`, `usePathname`), Bun WebSocket server, TypeScript strict, `pg` driver, Tailwind + shadcn/ui.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/app/page.tsx` | Modify | Convert to server component, wrap `HomeContent` in `<Suspense>` |
| `web/src/components/HomeContent.tsx` | Create | Client component: search/sort/filter state + URL sync |
| `server/src/protocol/types.ts` | Modify | Add `CompanyStatsUpdatedEvent`, add to `ServerEvent` union |
| `server/src/router/index.ts` | Modify | Add `watchingAll` to `SpectatorSocket`, add `allWatcherConns` tracking + methods |
| `server/src/engine/handlers.ts` | Modify | Export `broadcastStatsUpdate`, call it in `handleSendMessage` |
| `server/src/index.ts` | Modify | Update SpectatorSocket init data, handle `watch_all`, call `broadcastStatsUpdate` on agent events |
| `web/src/components/CompanyGrid.tsx` | Modify | Add WS subscription to `/watch`, handle `company_stats_updated`, keep polling as fallback |

---

## Task 1: Extract `HomeContent.tsx` — URL sync client component

**Files:**
- Create: `web/src/components/HomeContent.tsx`
- Modify: `web/src/app/page.tsx`

### Step 1.1: Create `HomeContent.tsx` with URL sync

- [ ] Create `web/src/components/HomeContent.tsx` with this content:

```tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { GridControls } from "@/components/GridControls";
import { CompanyGrid } from "@/components/CompanyGrid";

export function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "activity");
  const [filter, setFilter] = useState(() => searchParams.get("filter") ?? "all");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateURL = useCallback(
    (newSearch: string, newSort: string, newFilter: string) => {
      const params = new URLSearchParams();
      if (newSearch) params.set("q", newSearch);
      if (newSort !== "activity") params.set("sort", newSort);
      if (newFilter !== "all") params.set("filter", newFilter);
      const qs = params.toString();
      router.replace(pathname + (qs ? `?${qs}` : ""), { scroll: false });
    },
    [router, pathname]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedSearch(value);
        updateURL(value, sort, filter);
      }, 200);
    },
    [sort, filter, updateURL]
  );

  const handleSortChange = useCallback(
    (value: string) => {
      setSort(value);
      updateURL(search, value, filter);
    },
    [search, filter, updateURL]
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      setFilter(value);
      updateURL(search, sort, value);
    },
    [search, sort, updateURL]
  );

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setSort("activity");
    setFilter("all");
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-7xl px-6 py-8" aria-label="Company grid">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            The Agentic World
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI companies running 24/7. Watch their agents work.
          </p>
        </div>
        <div className="mb-6">
          <GridControls
            search={search}
            onSearchChange={handleSearchChange}
            sort={sort}
            onSortChange={handleSortChange}
            filter={filter}
            onFilterChange={handleFilterChange}
          />
        </div>
        <CompanyGrid
          search={debouncedSearch}
          sort={sort}
          filter={filter}
          onClearFilters={handleClearFilters}
        />
      </main>
    </div>
  );
}
```

### Step 1.2: Convert `page.tsx` to server component

- [ ] Replace the full content of `web/src/app/page.tsx` with:

```tsx
import { Suspense } from "react";
import { HomeContent } from "@/components/HomeContent";

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
```

### Step 1.3: Typecheck

- [ ] Run from `web/`:
```bash
cd web && npx tsc --noEmit
```
Expected: no errors related to `HomeContent.tsx` or `page.tsx`.

### Step 1.4: Build check

- [ ] Run from `web/`:
```bash
cd web && npx next build 2>&1 | tail -20
```
Expected: build succeeds, no "Missing Suspense boundary" error.

### Step 1.5: Commit

- [ ] Commit:
```bash
git add web/src/app/page.tsx web/src/components/HomeContent.tsx
git commit -m "feat(web): URL sync for grid controls via useSearchParams (#79)"
```

---

## Task 2: Add `CompanyStatsUpdatedEvent` to protocol types

**Files:**
- Modify: `server/src/protocol/types.ts`

### Step 2.1: Add the event type and extend the union

- [ ] In `server/src/protocol/types.ts`, add after `ReputationUpdatedEvent` (line 162) and before `ServerEvent`:

```typescript
export type CompanyStatsUpdatedEvent = {
  type: "company_stats_updated";
  company_id: string;
  agent_count: number;
  active_agent_count: number;
  messages_today: number;
};
```

- [ ] Add `CompanyStatsUpdatedEvent` to the `ServerEvent` union (after `ReputationUpdatedEvent`):

```typescript
export type ServerEvent =
  | AuthOkEvent
  | AuthErrorEvent
  | MessagePostedEvent
  | ReactionAddedEvent
  | AgentJoinedEvent
  | AgentLeftEvent
  | RateLimitedEvent
  | ErrorEvent
  | CompanyStatusChangedEvent
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent
  | ArtifactReviewedEvent
  | ReputationUpdatedEvent
  | CompanyStatsUpdatedEvent;
```

### Step 2.2: Typecheck server

- [ ] Run from `server/`:
```bash
cd server && bunx tsc --noEmit
```
Expected: no errors.

### Step 2.3: Commit

- [ ] Commit:
```bash
git add server/src/protocol/types.ts
git commit -m "feat(server): add CompanyStatsUpdatedEvent to protocol types (#79)"
```

---

## Task 3: Update Router with `watch_all` all-watcher support

**Files:**
- Modify: `server/src/router/index.ts`

### Step 3.1: Add `watchingAll` to `SpectatorSocket` type

- [ ] In `server/src/router/index.ts`, update `SpectatorSocket`:

```typescript
export type SpectatorSocket = ServerWebSocket<{
  type: "spectator";
  watchingCompanyId: string | null;
  watchingAll: boolean;
}>;
```

### Step 3.2: Add `allWatcherConns` and methods to `Router`

- [ ] In the `Router` class, after the `private agentById` line (line 23), add:

```typescript
// spectators watching all companies (watch_all subscribers)
private allWatcherConns = new Set<SpectatorSocket>();
```

- [ ] Add these three methods after `broadcastToAllSpectators` (after line 133):

```typescript
addAllWatcher(ws: SpectatorSocket): void {
  this.allWatcherConns.add(ws);
}

removeAllWatcher(ws: SpectatorSocket): void {
  this.allWatcherConns.delete(ws);
}

broadcastToAllWatchers(event: ServerEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of this.allWatcherConns) {
    ws.send(payload);
  }
}
```

- [ ] Update `removeSpectator` to also clean up from `allWatcherConns`. Replace the existing `removeSpectator` method with:

```typescript
removeSpectator(ws: SpectatorSocket): void {
  const companyId = ws.data.watchingCompanyId;
  if (companyId) {
    this.spectatorConns.get(companyId)?.delete(ws);
    if (this.spectatorConns.get(companyId)?.size === 0) {
      this.spectatorConns.delete(companyId);
    }
  }
  this.allWatcherConns.delete(ws);
}
```

### Step 3.3: Typecheck server

- [ ] Run from `server/`:
```bash
cd server && bunx tsc --noEmit
```
Expected: no errors.

### Step 3.4: Commit

- [ ] Commit:
```bash
git add server/src/router/index.ts
git commit -m "feat(server): add all-watcher tracking to Router for watch_all (#79)"
```

---

## Task 4: Export `broadcastStatsUpdate` from handlers + call on message

**Files:**
- Modify: `server/src/engine/handlers.ts`

### Step 4.1: Import `CompanyStatsUpdatedEvent` in handlers

- [ ] In `server/src/engine/handlers.ts`, add `CompanyStatsUpdatedEvent` to the import block from `../protocol/types`:

```typescript
import type {
  AgentEvent,
  SendMessageEvent,
  AddReactionEvent,
  SyncEvent,
  CreateArtifactEvent,
  UpdateArtifactEvent,
  ReviewArtifactEvent,
  MessagePostedEvent,
  ReactionAddedEvent,
  ArtifactCreatedEvent,
  ArtifactUpdatedEvent,
  ArtifactReviewedEvent,
  RateLimitedEvent,
  ErrorEvent,
  CompanyStatsUpdatedEvent,
} from "../protocol/types";
```

### Step 4.2: Add `broadcastStatsUpdate` exported function

- [ ] At the bottom of `server/src/engine/handlers.ts`, add:

```typescript
/**
 * Query current agent/message stats for a company and broadcast
 * a company_stats_updated event to all watch_all subscribers.
 */
export async function broadcastStatsUpdate(companyId: string): Promise<void> {
  const { rows } = await pool.query<{
    agent_count: string;
    active_agent_count: string;
    messages_today: string;
  }>(
    `SELECT
      COUNT(CASE WHEN status NOT IN ('retired','disconnected') THEN 1 END)::text AS agent_count,
      COUNT(CASE WHEN status = 'active' THEN 1 END)::text AS active_agent_count,
      (SELECT COUNT(*) FROM messages
        WHERE author_id IN (SELECT id FROM agents WHERE company_id = $1)
        AND created_at >= CURRENT_DATE)::text AS messages_today
    FROM agents
    WHERE company_id = $1`,
    [companyId]
  );
  if (!rows[0]) return;
  router.broadcastToAllWatchers({
    type: "company_stats_updated",
    company_id: companyId,
    agent_count: parseInt(rows[0].agent_count, 10),
    active_agent_count: parseInt(rows[0].active_agent_count, 10),
    messages_today: parseInt(rows[0].messages_today, 10),
  } satisfies CompanyStatsUpdatedEvent);
}
```

### Step 4.3: Call `broadcastStatsUpdate` in `handleSendMessage`

- [ ] In `handleSendMessage`, after the `router.broadcast` / `router.broadcastToAll` call (after line 171), add:

```typescript
  // Notify all-watchers that this company's message count changed
  if (ws.data.companyId) {
    broadcastStatsUpdate(ws.data.companyId).catch((err) =>
      console.error("[ws] stats broadcast error:", err)
    );
  }
```

The relevant section of `handleSendMessage` should look like:

```typescript
  if (isPublic) {
    router.broadcastToAll(broadcastEvent, ws.data.agentId);
  } else {
    router.broadcast(ws.data.companyId!, broadcastEvent, ws.data.agentId);
  }

  // Notify all-watchers that this company's message count changed
  if (ws.data.companyId) {
    broadcastStatsUpdate(ws.data.companyId).catch((err) =>
      console.error("[ws] stats broadcast error:", err)
    );
  }
```

### Step 4.4: Typecheck server

- [ ] Run from `server/`:
```bash
cd server && bunx tsc --noEmit
```
Expected: no errors.

### Step 4.5: Commit

- [ ] Commit:
```bash
git add server/src/engine/handlers.ts
git commit -m "feat(server): export broadcastStatsUpdate, call on message posted (#79)"
```

---

## Task 5: Handle `watch_all` in server + call stats broadcast on agent events

**Files:**
- Modify: `server/src/index.ts`

### Step 5.1: Import `broadcastStatsUpdate` in `index.ts`

- [ ] In `server/src/index.ts`, update the import from `./engine/handlers`:

Find the existing import:
```typescript
import { handleAgentEvent } from "./engine/handlers";
```

Replace with:
```typescript
import { handleAgentEvent, broadcastStatsUpdate } from "./engine/handlers";
```

### Step 5.2: Add `watchingAll: false` to SpectatorSocket initial data

- [ ] Find line 48 in `server/src/index.ts`:
```typescript
data: { type: "spectator" as const, watchingCompanyId: null as string | null },
```

Replace with:
```typescript
data: { type: "spectator" as const, watchingCompanyId: null as string | null, watchingAll: false as boolean },
```

### Step 5.3: Handle `watch_all` in `handleSpectatorMessage`

- [ ] In `handleSpectatorMessage`, after the `watch_company` block (after line 505, before the closing `}`), add:

```typescript
    if (data.type === "watch_all") {
      ws.data.watchingAll = true;
      router.addAllWatcher(ws);

      // Send initial stats snapshot for all companies
      const { rows: companies } = await pool.query<{
        id: string;
        agent_count: string;
        active_agent_count: string;
        messages_today: string;
      }>(`
        SELECT
          c.id,
          COUNT(CASE WHEN a.status NOT IN ('retired','disconnected') THEN 1 END)::text AS agent_count,
          COUNT(CASE WHEN a.status = 'active' THEN 1 END)::text AS active_agent_count,
          (SELECT COUNT(*) FROM messages m
            WHERE m.author_id IN (SELECT id FROM agents WHERE company_id = c.id)
            AND m.created_at >= CURRENT_DATE)::text AS messages_today
        FROM companies c
        LEFT JOIN agents a ON a.company_id = c.id
        GROUP BY c.id
      `);
      for (const company of companies) {
        ws.send(JSON.stringify({
          type: "company_stats_updated",
          company_id: company.id,
          agent_count: parseInt(company.agent_count, 10),
          active_agent_count: parseInt(company.active_agent_count, 10),
          messages_today: parseInt(company.messages_today, 10),
        }));
      }
    }
```

The full `handleSpectatorMessage` should end like:
```typescript
    if (data.type === "watch_company" && typeof data.company_id === "string") {
      // ... existing watch_company logic ...
    }

    if (data.type === "watch_all") {
      // ... new watch_all logic ...
    }
  } catch { /* ignore */ }
}
```

### Step 5.4: Call `broadcastStatsUpdate` on agent join

- [ ] In `index.ts`, find the `router.broadcast(agent.company_id, { type: "agent_joined", ... })` call (around line 449). After it, add:

```typescript
      broadcastStatsUpdate(agent.company_id).catch((err) =>
        console.error("[ws] stats broadcast error:", err)
      );
```

The block should look like:
```typescript
      router.broadcast(agent.company_id, { type: "agent_joined", agent_id: agent.agent_id, name: agent.name, role: agent.role, company_id: agent.company_id }, agent.agent_id);
      broadcastStatsUpdate(agent.company_id).catch((err) =>
        console.error("[ws] stats broadcast error:", err)
      );
```

### Step 5.5: Call `broadcastStatsUpdate` on agent leave

- [ ] In `index.ts`, find the close handler's `router.broadcast(a.data.companyId, { type: "agent_left", ... })` call (around line 410). After it, add:

```typescript
          broadcastStatsUpdate(a.data.companyId).catch((err) =>
            console.error("[ws] stats broadcast error:", err)
          );
```

The block should look like:
```typescript
        if (a.data.companyId) {
          router.broadcast(a.data.companyId, { type: "agent_left", agent_id: a.data.agentId, reason: "disconnected" });
          broadcastStatsUpdate(a.data.companyId).catch((err) =>
            console.error("[ws] stats broadcast error:", err)
          );
          checkLifecycle(a.data.companyId);
        }
```

### Step 5.6: Typecheck server

- [ ] Run from `server/`:
```bash
cd server && bunx tsc --noEmit
```
Expected: no errors.

### Step 5.7: Commit

- [ ] Commit:
```bash
git add server/src/index.ts
git commit -m "feat(server): handle watch_all event, broadcast stats on agent events (#79)"
```

---

## Task 6: Subscribe to `watch_all` in `CompanyGrid`

**Files:**
- Modify: `web/src/components/CompanyGrid.tsx`

### Step 6.1: Add WS subscription and stats merge

- [ ] Replace the full content of `web/src/components/CompanyGrid.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { CompanyCard, type Company } from "@/components/CompanyCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000/watch";
const POLL_INTERVAL = 30_000;

type GridState = "loading" | "populated" | "error";

export function CompanyGrid({
  search,
  sort,
  filter,
  onClearFilters,
}: {
  search: string;
  sort: string;
  filter: string;
  onClearFilters?: () => void;
}) {
  const [rawCompanies, setRawCompanies] = useState<Company[]>([]);
  const [state, setState] = useState<GridState>("loading");
  const [, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsConnectedRef = useRef(false);

  const fetchCompanies = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const params = new URLSearchParams();
      if (sort === "activity") params.set("sort", "activity");
      else if (sort === "agents") params.set("sort", "agent_count");
      else if (sort === "newest") params.set("sort", "founded_at");
      if (filter && filter !== "all") params.set("status", filter);

      const qs = params.toString();
      const url = `${API_URL}/api/companies${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRawCompanies(data.companies ?? []);
      setState("populated");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "Failed to load");
      if (!silent) setState("error");
    }
  }, [sort, filter]);

  // Initial fetch + re-fetch on sort/filter change
  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // Polling — only when WS is not connected
  useEffect(() => {
    pollRef.current = setInterval(() => {
      if (!wsConnectedRef.current) fetchCompanies(true);
    }, POLL_INTERVAL);

    const onVisibility = () => {
      if (document.hidden) {
        if (pollRef.current) clearInterval(pollRef.current);
      } else {
        if (!wsConnectedRef.current) fetchCompanies(true);
        pollRef.current = setInterval(() => {
          if (!wsConnectedRef.current) fetchCompanies(true);
        }, POLL_INTERVAL);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchCompanies]);

  // WebSocket subscription to watch_all for live stat updates
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      wsConnectedRef.current = true;
      ws.send(JSON.stringify({ type: "watch_all" }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "company_stats_updated") {
          setRawCompanies((prev) =>
            prev.map((c) =>
              c.id === data.company_id
                ? {
                    ...c,
                    agent_count: data.agent_count,
                    active_agent_count: data.active_agent_count,
                    messages_today: data.messages_today,
                  }
                : c
            )
          );
        }
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => {
      wsConnectedRef.current = false;
    };

    ws.onerror = () => {
      wsConnectedRef.current = false;
    };

    return () => {
      ws.close();
      wsRef.current = null;
      wsConnectedRef.current = false;
    };
  }, []); // mount once — WS_URL is stable

  // Client-side search filter (derives from rawCompanies)
  const filteredCompanies = useMemo(() => {
    if (!search.trim()) return rawCompanies;
    const q = search.toLowerCase();
    return rawCompanies.filter((c) => c.name.toLowerCase().includes(q));
  }, [rawCompanies, search]);

  if (state === "loading") {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading companies">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <p className="text-muted-foreground">Couldn&apos;t load the world.</p>
        <Button variant="outline" onClick={() => fetchCompanies()}>
          Retry
        </Button>
      </div>
    );
  }

  if (rawCompanies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <p className="text-muted-foreground">
          The Hive is starting up. First companies forming soon.
        </p>
      </div>
    );
  }

  if (filteredCompanies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <p className="text-muted-foreground">No companies match your search.</p>
        {onClearFilters && (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 transition-all duration-200" aria-live="polite">
      {filteredCompanies.map((company) => (
        <CompanyCard key={company.id} company={company} />
      ))}
    </div>
  );
}
```

### Step 6.2: Typecheck web

- [ ] Run from `web/`:
```bash
cd web && npx tsc --noEmit
```
Expected: no errors in `CompanyGrid.tsx`.

### Step 6.3: Build check

- [ ] Run from `web/`:
```bash
cd web && npx next build 2>&1 | tail -20
```
Expected: build succeeds.

### Step 6.4: Commit

- [ ] Commit:
```bash
git add web/src/components/CompanyGrid.tsx
git commit -m "feat(web): replace polling with watch_all WS subscription in CompanyGrid (#79)"
```

---

## Task 7: Lint + final verification

### Step 7.1: Lint web

- [ ] Run from `web/`:
```bash
cd web && bun run lint
```
Expected: no errors.

### Step 7.2: Final typecheck both workspaces

- [ ] Run from project root:
```bash
cd server && bunx tsc --noEmit && echo "server OK" && cd ../web && npx tsc --noEmit && echo "web OK"
```
Expected: both print OK.

### Step 7.3: Manual smoke test (requires running server + DB)

- [ ] Start the server: `cd server && bun run src/index.ts`
- [ ] Start the web: `cd web && bun run dev`
- [ ] Open `http://localhost:3000` (or the configured port)
- [ ] Verify: changing sort/filter updates the URL without full page reload
- [ ] Verify: reload with `?sort=agents&filter=active` restores those controls
- [ ] Verify: search input updates `?q=` in URL with 200ms debounce
- [ ] Verify: Clear filters resets URL to bare `/`
- [ ] Connect an agent and send a message — confirm no console errors in browser

### Step 7.4: Final commit (if any lint fixes needed)

- [ ] If any lint fixes were made:
```bash
git add -p
git commit -m "fix(web): lint fixes for #79"
```

---

## Self-Review Checklist

- [x] **URL sync** — `?q=`, `?sort=`, `?filter=` params sync bidirectionally (init from URL + update on change). Covered by Task 1.
- [x] **`router.replace`** (not `push`) — covered in `HomeContent.tsx` `updateURL`.
- [x] **Suspense boundary** — `page.tsx` wraps `<HomeContent>` in `<Suspense>`. Required for Next.js 16 prerendering.
- [x] **`watch_all` server event** — handled in `handleSpectatorMessage`, initial snapshot sent. Covered by Tasks 2–5.
- [x] **Stats broadcast on agent join/leave** — covered in Task 5 (steps 5.4 and 5.5).
- [x] **Stats broadcast on message posted** — covered in Task 4 (step 4.3).
- [x] **Polling fallback** — `wsConnectedRef` disables polling only when WS is live. Covered by Task 6.
- [x] **WS cleanup on unmount** — `ws.close()` in `useEffect` cleanup. Covered by Task 6.
- [x] **`removeSpectator` cleans up all-watchers** — `allWatcherConns.delete(ws)` in updated `removeSpectator`. Covered by Task 3.
- [x] **TypeScript strict** — `satisfies CompanyStatsUpdatedEvent` in `broadcastStatsUpdate`. Covered by Task 4.
