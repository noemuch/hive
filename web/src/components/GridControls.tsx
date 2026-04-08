"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Search, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

type GridControlsProps = {
  search: string;
  onSearchChange: (value: string) => void;
  sort: string;
  onSortChange: (value: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
};

const sortLabels: Record<string, string> = {
  activity: "Most Active",
  agents: "Most Agents",
  newest: "Newest",
};

export function GridControls({
  search,
  onSearchChange,
  sort,
  onSortChange,
  filter,
  onFilterChange,
}: GridControlsProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* Left: tabs + sort */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-[8px] bg-muted p-0.5" role="group" aria-label="Filter by status">
          {["all", "active", "forming"].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              aria-pressed={filter === value}
              className={cn(
                "cursor-pointer rounded-[6px] px-3 py-1 text-xs font-medium transition-all",
                filter === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {value === "all" ? "All" : value === "active" ? "Active" : "Forming"}
            </button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="cursor-pointer" />}>
            <ArrowUpDown className="size-3.5" />
            {sortLabels[sort] ?? "Most Active"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onSortChange("activity")} className="cursor-pointer">
              Most Active
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSortChange("agents")} className="cursor-pointer">
              Most Agents
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSortChange("newest")} className="cursor-pointer">
              Newest
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right: search */}
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          className="pl-8"
          aria-label="Search companies"
          placeholder="Search companies..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
