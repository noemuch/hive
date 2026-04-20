"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SlidersHorizontal, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { LLM_PROVIDERS, LLM_PROVIDER_LABEL } from "@/lib/llmProviders";
import { MIN_SCORE_OPTIONS } from "./types";

type FilterState = {
  roles: string[];
  providers: string[];
  minScore: number;
  evaluatedOnly: boolean;
};

type FilterHandlers = {
  onToggleRole: (role: string) => void;
  onToggleProvider: (provider: string) => void;
  onMinScoreChange: (score: number) => void;
  onEvaluatedToggle: (v: boolean) => void;
  onReset: () => void;
};

function FilterBody({
  state,
  availableRoles,
  handlers,
}: {
  state: FilterState;
  availableRoles: string[];
  handlers: FilterHandlers;
}) {
  const hasActive =
    state.roles.length > 0 ||
    state.providers.length > 0 ||
    state.minScore > 0 ||
    state.evaluatedOnly;

  return (
    <div className="flex flex-col gap-6 text-sm">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium">Min HEAR score</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MIN_SCORE_OPTIONS.map((score) => (
            <button
              type="button"
              key={score}
              onClick={() => handlers.onMinScoreChange(score)}
              aria-pressed={state.minScore === score}
              className={cn(
                "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                state.minScore === score
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
            >
              {score === 0 ? "Any" : `≥ ${score}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={state.evaluatedOnly}
            onCheckedChange={(v) => handlers.onEvaluatedToggle(v === true)}
          />
          <span className="text-sm">Evaluated only</span>
        </label>
      </div>

      {availableRoles.length > 0 && (
        <div>
          <h3 className="mb-2 font-medium">Role</h3>
          <div className="flex flex-col gap-1.5">
            {availableRoles.map((role) => (
              <Label key={role} className="cursor-pointer font-normal">
                <Checkbox
                  checked={state.roles.includes(role)}
                  onCheckedChange={() => handlers.onToggleRole(role)}
                />
                <span className="truncate">{role}</span>
              </Label>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 font-medium">LLM provider</h3>
        <div className="flex flex-col gap-1.5">
          {LLM_PROVIDERS.map((provider) => (
            <Label key={provider} className="cursor-pointer font-normal">
              <Checkbox
                checked={state.providers.includes(provider)}
                onCheckedChange={() => handlers.onToggleProvider(provider)}
              />
              <span>{LLM_PROVIDER_LABEL[provider]}</span>
            </Label>
          ))}
        </div>
      </div>

      {hasActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handlers.onReset}
          className="self-start cursor-pointer"
        >
          Reset filters
        </Button>
      )}
    </div>
  );
}

export function MarketplaceFilters({
  state,
  availableRoles,
  handlers,
  activeCount,
}: {
  state: FilterState;
  availableRoles: string[];
  handlers: FilterHandlers;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-20 hidden h-fit md:block">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Filters</h2>
        </div>
        <FilterBody
          state={state}
          availableRoles={availableRoles}
          handlers={handlers}
        />
      </aside>

      {/* Mobile drawer trigger */}
      <div className="md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" size="sm" className="cursor-pointer">
                <Filter className="size-3.5" aria-hidden="true" />
                Filters
                {activeCount > 0 && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {activeCount}
                  </span>
                )}
              </Button>
            }
          />
          <SheetContent side="left" className="w-[85%] max-w-sm overflow-y-auto p-6">
            <SheetHeader className="px-0">
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <FilterBody
              state={state}
              availableRoles={availableRoles}
              handlers={handlers}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
