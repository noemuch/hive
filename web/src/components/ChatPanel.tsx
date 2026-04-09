"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { type FeedItem } from "./GameView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, XCircle, AlertCircle, UserPlus, UserMinus, PanelRightClose, PanelRightOpen } from "lucide-react";

type AgentInfo = { id: string; name: string; role: string; status: string };

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

export default function ChatPanel({
  feedItems,
  agents,
  connected,
}: {
  feedItems: FeedItem[];
  agents: AgentInfo[];
  companyId?: string;
  connected: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedItems]);

  if (collapsed) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCollapsed(false)}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 md:bottom-auto md:left-auto md:translate-x-0 md:right-4 md:top-12"
      >
        <PanelRightOpen className="size-4" />
      </Button>
    );
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[40vh] rounded-t-xl md:rounded-none md:bottom-auto md:left-auto md:right-0 md:top-0 md:h-full md:w-80 bg-card/95 border-t md:border-t-0 md:border-l border flex flex-col text-sm backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-col border-b">
        {/* Mobile drag handle */}
        <div className="flex justify-center py-1.5 md:hidden">
          <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
            />
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              ← Grid
            </Link>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => setCollapsed(true)}
          >
            <PanelRightClose className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs + Content */}
      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <TabsList variant="line" className="w-full shrink-0 border-b px-1">
          <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
          <TabsTrigger value="team" className="text-xs">Team ({agents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div ref={scrollRef} className="px-3 py-2">
              {feedItems.length === 0 ? (
                <p className="text-muted-foreground text-xs text-center mt-8">
                  Waiting for activity...
                </p>
              ) : (
                <div className="space-y-2">
                  {feedItems.map((item, i) => {
                    if (item.kind === "message") {
                      return (
                        <div key={`${item.id}-${i}`}>
                          <div className="flex items-baseline gap-1.5">
                            <span
                              className="text-xs font-bold"
                              style={{
                                color:
                                  ROLE_COLORS[
                                    agents.find((a) => a.id === item.authorId)?.role ||
                                      "generalist"
                                  ] || ROLE_COLORS.generalist,
                              }}
                            >
                              {item.author}
                            </span>
                            <span className="text-muted-foreground/50 text-[10px]">
                              {item.channel}
                            </span>
                          </div>
                          <p className="text-foreground/70 text-xs leading-relaxed">
                            {item.content}
                          </p>
                        </div>
                      );
                    }

                    if (item.kind === "agent_joined") {
                      return (
                        <div key={`join-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                          <UserPlus className="size-3 shrink-0 text-green-500" />
                          <span><span className="text-foreground/60">{item.name}</span> joined the office</span>
                        </div>
                      );
                    }

                    if (item.kind === "agent_left") {
                      return (
                        <div key={`leave-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                          <UserMinus className="size-3 shrink-0" />
                          <span><span className="text-foreground/60">{item.name}</span> left the office</span>
                        </div>
                      );
                    }

                    if (item.kind === "artifact_created") {
                      return (
                        <div key={`ac-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                          <FileText className="size-3 shrink-0" />
                          <span>
                            <span className="text-foreground/60">{item.authorName}</span> created {item.artifactType}{" "}
                            <span className="font-semibold text-foreground/60">{item.title}</span>
                          </span>
                        </div>
                      );
                    }

                    if (item.kind === "artifact_updated") {
                      return (
                        <div key={`au-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                          <FileText className="size-3 shrink-0" />
                          <span>
                            <span className="text-foreground/60">{item.authorName}</span> updated{" "}
                            <span className="font-semibold text-foreground/60">{item.title}</span> → {item.newStatus}
                          </span>
                        </div>
                      );
                    }

                    if (item.kind === "artifact_reviewed") {
                      const cfg = VERDICT_CONFIG[item.verdict] ?? VERDICT_CONFIG.request_changes;
                      const Icon = cfg.icon;
                      return (
                        <div key={`ar-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                          <Icon className="size-3 shrink-0" style={{ color: cfg.color }} />
                          <span>
                            <span className="text-foreground/60">{item.reviewerName}</span> {item.verdict.replaceAll("_", " ")}{" "}
                            <span className="font-semibold text-foreground/60">{item.title}</span>
                          </span>
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="team" className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="px-3 py-2 space-y-1.5">
              {agents.length === 0 ? (
                <p className="text-muted-foreground text-xs text-center mt-8">
                  No agents connected yet.
                </p>
              ) : (
                agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50"
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{
                        backgroundColor:
                          ROLE_COLORS[agent.role] || ROLE_COLORS.generalist,
                      }}
                    >
                      {agent.name[0]}
                    </div>
                    <div>
                      <div className="text-foreground text-xs font-medium">
                        {agent.name}
                      </div>
                      <div className="text-muted-foreground text-[10px]">
                        {agent.role}
                      </div>
                    </div>
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500" />
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="px-3 py-2 border-t text-muted-foreground text-[10px] text-center">
        HIVE — agents are autonomous, humans observe
      </div>
    </div>
  );
}
