# URL Sync for Grid Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the grid page's search/sort/filter controls to URL query params (`?q=`, `?sort=`, `?filter=`) so state is preserved on refresh, shareable by link, and navigable via browser back/forward.

**Architecture:** Extract current `page.tsx` logic into a new `HomeContent.tsx` client component that reads state from `useSearchParams` instead of `useState`. `page.tsx` becomes a thin server component wrapping `HomeContent` in a `<Suspense>` boundary — required by Next.js 16 for production builds. Sort/filter changes use `router.push` (creates history entries). Search debounces 200ms then uses `router.replace` (no history per keystroke). Concurrent sort/filter changes during a pending search debounce are resolved by flushing the timer immediately.

**Tech Stack:** Next.js 16 App Router, `next/navigation` (`useSearchParams`, `useRouter`, `usePathname`), React 19, TypeScript strict.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `web/src/components/HomeContent.tsx` | Client component — all URL state logic, handlers, JSX |
| MODIFY | `web/src/app/page.tsx` | Server component — `<Suspense>` wrapper only |
| UNCHANGED | `web/src/components/GridControls.tsx` | Controlled inputs — no changes needed |
| UNCHANGED | `web/src/components/CompanyGrid.tsx` | Grid + fetch — no changes needed (already has AbortController) |

---

## Reference: Current `page.tsx`

The file to gut and replace. Read this once so you know what you're migrating:

```tsx
// web/src/app/page.tsx (current — 66 lines)
"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { NavBar } from "@/components/NavBar";
import { GridControls } from "@/components/GridControls";
import { CompanyGrid } from "@/components/CompanyGrid";

export default function HomePage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("activity");
  const [filter, setFilter] = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 200);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-7xl px-6 py-8" aria-label="Company grid">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">The Agentic World</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI companies running 24/7. Watch their agents work.</p>
        </div>
        <div className="mb-6">
          <GridControls search={search} onSearchChange={handleSearchChange}
            sort={sort} onSortChange={setSort} filter={filter} onFilterChange={setFilter} />
        </div>
        <CompanyGrid search={debouncedSearch} sort={sort} filter={filter}
          onClearFilters={() => { setSearch(""); setDebouncedSearch(""); setSort("activity"); setFilter("all"); }} />
      </main>
    </div>
  );
}
```

---

## Task 1: Create `HomeContent.tsx`

**Files:**
- Create: `web/src/components/HomeContent.tsx`

### Why `updateParamsRef` exists

`handleSearchChange` uses a 200ms `setTimeout`. The callback inside it would capture a stale `updateParams` closure if sort/filter change during that window. Storing `updateParams` in a ref and keeping it current via `useEffect` ensures the debounced callback always writes to the latest URL state.

### Why sort/filter flush the debounce

If the user types "acme" and immediately clicks a sort button (before the 200ms fires), two URL writes would race. The fix: sort/filter handlers clear the pending debounce timer and immediately apply both the current `search` value and the new sort/filter in a single `router.push`. No state is lost.

- [ ] **Step 1: Create the file with constants and types**

```tsx
// web/src/components/HomeContent.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { GridControls } from "@/components/GridControls";
import { CompanyGrid } from "@/components/CompanyGrid";

const DEFAULTS = { q: "", sort: "activity", filter: "all" } as const;
const VALID_SORTS = new Set(["activity", "agents", "newest"]);
const VALID_FILTERS = new Set(["all", "active", "forming"]);
```

- [ ] **Step 2: Add the `updateParams` helper**

Append to `HomeContent.tsx` (replace `// ... rest of component` placeholders as you go):

```tsx
export function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read + validate URL params — invalid values fall back to defaults
  const rawSort = searchParams.get("sort") ?? DEFAULTS.sort;
  const sort = VALID_SORTS.has(rawSort) ? rawSort : DEFAULTS.sort;
  const rawFilter = searchParams.get("filter") ?? DEFAULTS.filter;
  const filter = VALID_FILTERS.has(rawFilter) ? rawFilter : DEFAULTS.filter;
  const urlSearch = searchParams.get("q") ?? DEFAULTS.q;

  // Local state for search: instant input + debounced URL write
  const [search, setSearch] = useState(urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(urlSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync URL → local state when user navigates back/forward
  useEffect(() => {
    setSearch(urlSearch);
    setDebouncedSearch(urlSearch);
  }, [urlSearch]);

  // Build new URL with updated params; omit defaults for clean URLs
  const updateParams = useCallback(
    (updates: Partial<Record<keyof typeof DEFAULTS, string>>, method: "push" | "replace" = "push") => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === DEFAULTS[key as keyof typeof DEFAULTS]) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      router[method](pathname + (qs ? `?${qs}` : ""), { scroll: false });
    },
    [searchParams, pathname, router],
  );

  // Stable ref so the debounce callback always calls the latest updateParams
  const updateParamsRef = useRef(updateParams);
  useEffect(() => {
    updateParamsRef.current = updateParams;
  }, [updateParams]);
```

- [ ] **Step 3: Add event handlers**

Continue appending to `HomeContent.tsx`:

```tsx
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      updateParamsRef.current({ q: value }, "replace");
    }, 200);
  }, []);

  // Flush pending search debounce before applying sort/filter to avoid URL race
  const handleSortChange = useCallback(
    (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        setDebouncedSearch(search);
      }
      updateParams({ q: search, sort: value }, "push");
    },
    [updateParams, search],
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        setDebouncedSearch(search);
      }
      updateParams({ q: search, filter: value }, "push");
    },
    [updateParams, search],
  );

  const handleClearFilters = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setSearch("");
    setDebouncedSearch("");
    router.push(pathname, { scroll: false });
  }, [router, pathname]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
```

- [ ] **Step 4: Add the JSX return and close the function**

Continue appending to `HomeContent.tsx`:

```tsx
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

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/maxime/hive/web && npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: no errors. If you see "Cannot find module '@/components/HomeContent'", that's fine — it's not imported yet (Task 2 does that).

- [ ] **Step 6: Commit**

```bash
cd /Users/maxime/hive
git add web/src/components/HomeContent.tsx
git commit -m "feat: add HomeContent with useSearchParams URL sync"
```

---

## Task 2: Rewrite `page.tsx` as server component with Suspense

**Files:**
- Modify: `web/src/app/page.tsx`

Next.js 16 requires a `<Suspense>` boundary around any client component that calls `useSearchParams`. Without it, the production build fails with a "Missing Suspense boundary with useSearchParams" error. The `HomeSkeleton` fallback renders the shell (header text) immediately while the client component hydrates.

- [ ] **Step 1: Replace `page.tsx` entirely**

```tsx
// web/src/app/page.tsx
import { Suspense } from "react";
import { HomeContent } from "@/components/HomeContent";
import { NavBar } from "@/components/NavBar";

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeSkeleton() {
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
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
cd /Users/maxime/hive/web && npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```bash
cd /Users/maxime/hive/web && bun run lint 2>&1 | tail -20
```

Expected: no errors or warnings related to the modified files.

- [ ] **Step 4: Run production build**

```bash
cd /Users/maxime/hive/web && bun run build 2>&1 | tail -30
```

Expected: build succeeds. The critical check is that Next.js does **not** print:
```
Error: Missing Suspense boundary with useSearchParams
```

If it does, the `<Suspense>` in `page.tsx` is not wrapping `HomeContent` correctly — re-read Task 2 Step 1.

- [ ] **Step 5: Manual smoke test**

Start dev server:
```bash
cd /Users/maxime/hive/web && bun dev
```

Open `http://localhost:3000` and verify each AC:

| AC | Test | Expected |
|----|------|----------|
| AC-1 | Navigate to `/?q=acme&sort=agents&filter=active` | Search input shows "acme", sort shows "Most Agents", filter tab "Active" is selected |
| AC-2 | Change sort to "Newest" | URL updates to `/?sort=newest`, browser Back is available |
| AC-3 | Type in search field rapidly | URL updates after ~200ms pause, address bar uses `replace` (no extra history per keystroke) |
| AC-4 | Apply filters, click "Clear filters" | URL returns to `/`, all controls reset to defaults |
| AC-5 | Apply sort/filter, click browser Back | Previous filter state restored |
| AC-E1 | Navigate to `/?sort=bogus` | Sort shows "Most Active" (default), no crash |
| AC-E2 | Navigate to `/?filter=invalid` | Filter shows "All" (default), no crash |
| AC-6 | Load page with defaults, inspect URL | Address bar shows `/` with no query params |

- [ ] **Step 6: Commit**

```bash
cd /Users/maxime/hive
git add web/src/app/page.tsx
git commit -m "feat: URL sync for grid filters via useSearchParams (#81)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| Replace local useState with useSearchParams | Task 1 — `HomeContent.tsx` |
| URL shape: `?q=`, `?sort=`, `?filter=` | Task 1 — `updateParams` |
| Defaults omitted from URL | Task 1 — `updateParams` deletes params matching DEFAULTS |
| Browser back/forward | Task 1 — sort/filter use `router.push`; search uses `router.replace` |
| Shareable links | Task 1 — state fully derived from URL on mount |
| Debounce preserved (200ms) | Task 1 — `handleSearchChange` + `debounceRef` |
| Clear filters resets URL | Task 1 — `handleClearFilters` → `router.push(pathname)` |
| Invalid URL params fall back | Task 1 — VALID_SORTS / VALID_FILTERS Set validation |
| Suspense boundary (production build) | Task 2 — `<Suspense fallback={<HomeSkeleton />}>` |
| Back/forward syncs local search state | Task 1 — `useEffect` on `urlSearch` |
| Concurrent debounce + sort race fix | Task 1 — sort/filter handlers flush `debounceRef` before pushing |

**Placeholder scan:** No TBDs, no "handle edge cases", all code blocks complete. ✓

**Type consistency:** `updateParams` defined in Task 1 Step 2, called in Steps 3 and 4 with the same signature `(updates: Partial<Record<keyof typeof DEFAULTS, string>>, method)`. `updateParamsRef.current` matches. ✓
