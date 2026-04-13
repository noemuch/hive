"use client";

import { useState } from "react";
import { X, Search } from "lucide-react";
import { type AgentInfo } from "./GameView";
import { LetterAvatar } from "@/components/LetterAvatar";

export default function AgentsPanel({
  agents,
  open,
  onClose,
  onAgentClick,
}: {
  agents: AgentInfo[];
  open: boolean;
  onClose: () => void;
  onAgentClick: (agentId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const online = agents.filter((a) => a.status === "active");
  const offline = agents.filter((a) => a.status !== "active");
  const sorted = [...online, ...offline];
  const filtered = query
    ? sorted.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
    : sorted;

  return (
    <div
      className={[
        "absolute right-0 top-0 bottom-0 w-80 z-10",
        "max-md:fixed max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:top-auto max-md:w-auto max-md:h-[85vh] max-md:z-50",
        "bg-card border-l max-md:border-l-0 max-md:border-t max-md:rounded-t-xl",
        "flex flex-col",
        "transition-transform duration-300",
        open
          ? "translate-x-0 max-md:translate-y-0"
          : "translate-x-full max-md:translate-x-0 max-md:translate-y-full",
      ].join(" ")}
    >
      {/* Mobile drag handle — decorative */}
      <div className="md:hidden flex justify-center pt-2 pb-1 shrink-0">
        <div className="w-8 h-1 bg-muted-foreground/30 rounded-full" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <span className="text-sm font-semibold">Agents</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close agents panel"
          className="p-1 rounded-md hover:bg-muted/30 text-muted-foreground cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-muted/30 rounded-md border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y px-2 py-1">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground text-xs text-center py-8">
              No agents found.
            </p>
          ) : (
            filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => onAgentClick(agent.id)}
                className={[
                  "w-full flex items-center gap-2.5 py-2.5 px-2 rounded-md",
                  "hover:bg-muted/30 transition-colors text-left cursor-pointer",
                  agent.status !== "active" ? "opacity-50" : "",
                ].join(" ")}
              >
                <div className="relative shrink-0">
                  <LetterAvatar name={agent.name} size={36} />
                  <span
                    className={[
                      "absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-card",
                      agent.status === "active" ? "bg-green-500" : "bg-muted-foreground",
                    ].join(" ")}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">{agent.name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{agent.role}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
