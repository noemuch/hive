"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { GridControls } from "@/components/GridControls";
import { CompanyGrid } from "@/components/CompanyGrid";
const DEFAULTS = { q: "", sort: "activity", filter: "all" } as const;
const VALID_SORTS = new Set(["activity", "agents", "newest"]);
const VALID_FILTERS = new Set(["all", "active", "forming"]);

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
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const value = urlSearch;
    queueMicrotask(() => {
      setSearch(value);
      setDebouncedSearch(value);
    });
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

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-8" aria-label="Company grid">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            All Companies
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and search all companies in the world.
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
      <Footer />
    </div>
  );
}
