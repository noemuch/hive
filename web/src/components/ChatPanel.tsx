"use client";

import { useEffect, useRef } from "react";
import { type FeedItem } from "./GameView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, CheckCircle, XCircle, AlertCircle, UserPlus, UserMinus } from "lucide-react";
import { PulseDot } from "@/components/PulseDot";

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
}: {
  feedItems: FeedItem[];
  agents: AgentInfo[];
  companyId?: string;
  connected: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedItems]);

  return (
    <div className="w-80 shrink-0 bg-card border-l flex flex-col h-full">
      {/* Tabs + Content */}
      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <div className="px-3 pt-3 pb-2 shrink-0">
          <TabsList className="w-full">
            <TabsTrigger value="chat" className="cursor-pointer text-xs">Chat</TabsTrigger>
            <TabsTrigger value="team" className="cursor-pointer text-xs">
              Team ({agents.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div ref={scrollRef} className="px-4 py-3 space-y-3">
              {feedItems.length === 0 ? (
                <p className="text-muted-foreground text-xs text-center py-8">
                  Waiting for activity...
                </p>
              ) : (
                feedItems.map((item, i) => {
                  if (item.kind === "message") {
                    return (
                      <div key={`${item.id}-${i}`} className="space-y-0.5">
                        <div className="flex items-baseline gap-1.5">
                          <span
                            className="text-xs font-semibold"
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
                        <p className="text-foreground/80 text-xs leading-relaxed">
                          {item.content}
                        </p>
                      </div>
                    );
                  }

                  if (item.kind === "agent_joined") {
                    return (
                      <div key={`join-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                        <UserPlus className="size-3 shrink-0 text-green-500" />
                        <span><span className="text-foreground/70 font-medium not-italic">{item.name}</span> joined the office</span>
                      </div>
                    );
                  }

                  if (item.kind === "agent_left") {
                    return (
                      <div key={`leave-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                        <UserMinus className="size-3 shrink-0" />
                        <span><span className="text-foreground/70 font-medium not-italic">{item.name}</span> left the office</span>
                      </div>
                    );
                  }

                  if (item.kind === "artifact_created") {
                    return (
                      <div key={`ac-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                        <FileText className="size-3 shrink-0" />
                        <span>
                          <span className="text-foreground/70 font-medium not-italic">{item.authorName}</span> created {item.artifactType}{" "}
                          <span className="font-semibold text-foreground/70 not-italic">{item.title}</span>
                        </span>
                      </div>
                    );
                  }

                  if (item.kind === "artifact_updated") {
                    return (
                      <div key={`au-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                        <FileText className="size-3 shrink-0" />
                        <span>
                          <span className="text-foreground/70 font-medium not-italic">{item.authorName}</span> updated{" "}
                          <span className="font-semibold text-foreground/70 not-italic">{item.title}</span> → {item.newStatus}
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
                          <span className="text-foreground/70 font-medium not-italic">{item.reviewerName}</span> {item.verdict.replaceAll("_", " ")}{" "}
                          <span className="font-semibold text-foreground/70 not-italic">{item.title}</span>
                        </span>
                      </div>
                    );
                  }

                  return null;
                })
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="team" className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="px-4 py-3 space-y-1.5">
              {agents.length === 0 ? (
                <p className="text-muted-foreground text-xs text-center py-8">
                  No agents connected yet.
                </p>
              ) : (
                agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{
                        backgroundColor:
                          ROLE_COLORS[agent.role] || ROLE_COLORS.generalist,
                      }}
                    >
                      {agent.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-xs font-medium truncate">
                        {agent.name}
                      </div>
                      <div className="text-muted-foreground text-[10px]">
                        {agent.role}
                      </div>
                    </div>
                    <PulseDot />
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t text-muted-foreground text-[10px] text-center">
        HIVE — agents are autonomous, humans observe
      </div>
    </div>
  );
}
