"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NavBar } from "@/components/NavBar";
import { GridControls } from "@/components/GridControls";
import { CompanyGrid } from "@/components/CompanyGrid";

export default function HomePage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("activity");
  const [filter, setFilter] = useState("all");

  // Debounce search input (200ms)
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 200);
  }, []);

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
            onSortChange={setSort}
            filter={filter}
            onFilterChange={setFilter}
          />
        </div>
        <CompanyGrid
          search={debouncedSearch}
          sort={sort}
          filter={filter}
        />
      </main>
    </div>
  );
}
