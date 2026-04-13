"use client";

import { useEffect, useRef } from "react";
import { type FeedItem, type AgentInfo } from "./GameView";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle,
  UserPlus,
  UserMinus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LetterAvatar } from "@/components/LetterAvatar";

const ROLE_COLORS: Record<string, string> = {
  developer: "#4fc3f7",
  designer: "#f06292",
  pm: "#ffb74d",
  qa: "#81c784",
  ops: "#ce93d8",
  generalist: "#90a4ae",
};

const VERDICT_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  approve: { icon: CheckCircle, color: "#33CC66" },
  reject: { icon: XCircle, color: "#D94040" },
  request_changes: { icon: AlertCircle, color: "#E89B1C" },
};

function buildGroups(
  items: FeedItem[],
): Array<{ item: FeedItem; isGrouped: boolean }> {
  return items.map((item, i) => {
    if (item.kind !== "message") return { item, isGrouped: false };
    const prev = items[i - 1];
    const isGrouped =
      !!prev &&
      prev.kind === "message" &&
      prev.authorId === item.authorId &&
      item.timestamp - prev.timestamp < 2 * 60 * 1000;
    return { item, isGrouped };
  });
}

export default function ChatPanel({
  feedItems,
  agents,
  open,
  onClose,
  onUnreadChange,
}: {
  feedItems: FeedItem[];
  agents: AgentInfo[];
  open: boolean;
  onClose: () => void;
  onUnreadChange?: (updater: (prev: number) => number) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feedItems, open]);

  // Increment unread count when closed and new messages arrive
  useEffect(() => {
    const msgCount = feedItems.filter((f) => f.kind === "message").length;
    if (!open && msgCount > prevMsgCountRef.current) {
      const delta = msgCount - prevMsgCountRef.current;
      onUnreadChange?.((c) => c + delta);
    }
    prevMsgCountRef.current = msgCount;
  }, [feedItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset unread count on open
  useEffect(() => {
    if (open) {
      onUnreadChange?.(() => 0);
      prevMsgCountRef.current = feedItems.filter((f) => f.kind === "message").length;
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = buildGroups(feedItems);

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
        <span className="text-sm font-semibold">Chat</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="p-1 rounded-md hover:bg-muted/30 text-muted-foreground cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-2">
          {feedItems.length === 0 ? (
            <p className="text-muted-foreground text-xs text-center py-8">
              Waiting for activity...
            </p>
          ) : (
            groups.map(({ item, isGrouped }, i) => {
              if (item.kind === "message") {
                const agentRole =
                  agents.find((a) => a.id === item.authorId)?.role ?? "generalist";

                if (isGrouped) {
                  return (
                    <div key={`${item.id}-${i}`} className="pl-[42px]">
                      <p className="text-foreground/80 text-xs leading-relaxed">
                        {item.content}
                      </p>
                    </div>
                  );
                }

                return (
                  <div key={`${item.id}-${i}`} className="flex gap-2.5 items-start">
                    <LetterAvatar name={item.author} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-xs font-semibold"
                          style={{
                            color: ROLE_COLORS[agentRole] ?? ROLE_COLORS.generalist,
                          }}
                        >
                          {item.author}
                        </span>
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-auto shrink-0">
                          {agentRole}
                        </Badge>
                        <span className="text-muted-foreground/50 text-[10px]">
                          {new Date(item.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-foreground/80 text-xs leading-relaxed mt-0.5">
                        {item.content}
                      </p>
                    </div>
                  </div>
                );
              }

              if (item.kind === "agent_joined") {
                return (
                  <div
                    key={`join-${item.id}-${i}`}
                    className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground"
                  >
                    <UserPlus className="size-3 shrink-0 text-green-500" />
                    <span>
                      <span className="text-foreground/70 font-medium not-italic">
                        {item.name}
                      </span>{" "}
                      joined the office
                    </span>
                  </div>
                );
              }

              if (item.kind === "agent_left") {
                return (
                  <div
                    key={`leave-${item.id}-${i}`}
                    className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground"
                  >
                    <UserMinus className="size-3 shrink-0" />
                    <span>
                      <span className="text-foreground/70 font-medium not-italic">
                        {item.name}
                      </span>{" "}
                      left the office
                    </span>
                  </div>
                );
              }

              if (item.kind === "artifact_created") {
                return (
                  <div
                    key={`ac-${item.id}-${i}`}
                    className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground"
                  >
                    <FileText className="size-3 shrink-0" />
                    <span>
                      <span className="text-foreground/70 font-medium not-italic">
                        {item.authorName}
                      </span>{" "}
                      created {item.artifactType}{" "}
                      <span className="font-semibold text-foreground/70 not-italic">
                        {item.title}
                      </span>
                    </span>
                  </div>
                );
              }

              if (item.kind === "artifact_updated") {
                return (
                  <div
                    key={`au-${item.id}-${i}`}
                    className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground"
                  >
                    <FileText className="size-3 shrink-0" />
                    <span>
                      <span className="text-foreground/70 font-medium not-italic">
                        {item.authorName}
                      </span>{" "}
                      updated{" "}
                      <span className="font-semibold text-foreground/70 not-italic">
                        {item.title}
                      </span>{" "}
                      → {item.newStatus}
                    </span>
                  </div>
                );
              }

              if (item.kind === "artifact_reviewed") {
                const cfg =
                  VERDICT_CONFIG[item.verdict] ?? VERDICT_CONFIG.request_changes;
                const Icon = cfg.icon;
                return (
                  <div
                    key={`ar-${item.id}-${i}`}
                    className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground"
                  >
                    <Icon className="size-3 shrink-0" style={{ color: cfg.color }} />
                    <span>
                      <span className="text-foreground/70 font-medium not-italic">
                        {item.reviewerName}
                      </span>{" "}
                      {item.verdict.replaceAll("_", " ")}{" "}
                      <span className="font-semibold text-foreground/70 not-italic">
                        {item.title}
                      </span>
                    </span>
                  </div>
                );
              }

              return null;
            })
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
