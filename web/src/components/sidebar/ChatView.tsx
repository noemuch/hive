"use client";

import { useEffect, useRef } from "react";
import { type FeedItem, type AgentInfo } from "@/components/GameView";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import { seedBg } from "@/components/sidebar/utils";

function buildGroups(items: FeedItem[]): Array<{ item: FeedItem; isGrouped: boolean }> {
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

function getTopMargin(
  item: FeedItem,
  prev: FeedItem | undefined,
  isGrouped: boolean,
): string {
  if (!prev) return "0px";
  if (isGrouped) return "3px";
  if (prev.kind !== "message" || item.kind !== "message") return "10px";
  return "14px";
}

export default function ChatView({
  feedItems,
  agents,
  bureauName,
  onlineCount,
}: {
  feedItems: FeedItem[];
  agents: AgentInfo[];
  bureauName: string;
  onlineCount: number;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feedItems]);

  const groups = buildGroups(feedItems);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Panel header */}
      <div style={{
        padding: "11px 14px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
          {bureauName}
        </span>
        {onlineCount > 0 && (
          <span style={{
            fontSize: 10,
            color: "var(--accent-green)",
            background: "rgba(116,196,130,0.08)",
            padding: "2px 7px",
            borderRadius: 20,
            border: "1px solid rgba(116,196,130,0.15)",
          }}>
            ● {onlineCount} online
          </span>
        )}
      </div>

      {/* Feed */}
      <div className="scrollbar-subtle" style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        {feedItems.length === 0 ? (
          <p style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", marginTop: 32 }}>
            Waiting for activity...
          </p>
        ) : (
          groups.map(({ item, isGrouped }, i) => {
            const prev = i > 0 ? groups[i - 1].item : undefined;
            const marginTop = getTopMargin(item, prev, isGrouped);

            if (item.kind === "message") {
              const role = agents.find((a) => a.id === item.authorId)?.role ?? "generalist";

              if (isGrouped) {
                return (
                  <div key={item.id + i} style={{ paddingLeft: 34, marginTop }}>
                    <p style={{ fontSize: 11, color: "var(--foreground)", opacity: 0.85, margin: 0, lineHeight: 1.55 }}>
                      {item.content}
                    </p>
                  </div>
                );
              }

              return (
                <div key={item.id + i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop }}>
                  <div style={{ marginTop: 1, flexShrink: 0, width: 26, height: 26, borderRadius: "50%", overflow: "hidden", background: seedBg(item.author) }}>
                    <PixelAvatar seed={item.author} size={26} className="rounded-full" />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>{item.author}</span>
                      <Badge variant="secondary" style={{ fontSize: 9, padding: "1px 5px", lineHeight: 1.4 }}>
                        {role}
                      </Badge>
                      <span style={{ fontSize: 9, color: "var(--muted-foreground)" }}>
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: "var(--foreground)", opacity: 0.85, margin: 0, lineHeight: 1.55 }}>
                      {item.content}
                    </p>
                  </div>
                </div>
              );
            }

            if (item.kind === "agent_joined") {
              return (
                <div key={item.id + i} style={{ borderLeft: "2px solid rgba(255,255,255,0.15)", padding: "2px 0 2px 9px", marginTop }}>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                    <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{item.name}</span>
                    {" "}joined office
                  </span>
                </div>
              );
            }

            if (item.kind === "agent_left") {
              return (
                <div key={item.id + i} style={{ borderLeft: "2px solid var(--border)", padding: "2px 0 2px 9px", marginTop }}>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                    <span style={{ fontWeight: 600 }}>{item.name}</span>
                    {" "}left office
                  </span>
                </div>
              );
            }

            if (item.kind === "artifact_created") {
              return (
                <div key={item.id + i} style={artifactCardStyle(marginTop)}>
                  <FileText size={13} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)" }}>{item.title}</span>
                    <span style={{ fontSize: 9, color: "var(--border)" }}> · created by {item.authorName} · {item.artifactType}</span>
                  </div>
                </div>
              );
            }

            if (item.kind === "artifact_updated") {
              return (
                <div key={item.id + i} style={artifactCardStyle(marginTop)}>
                  <RefreshCw size={13} style={{ color: "#f59e0b", flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)" }}>{item.title}</span>
                    <span style={{ fontSize: 9, color: "var(--border)" }}> · {item.oldStatus} → {item.newStatus}</span>
                  </div>
                </div>
              );
            }

            if (item.kind === "artifact_reviewed") {
              const { icon: Icon, color } = VERDICT_CONFIG[item.verdict] ?? VERDICT_CONFIG.request_changes;
              return (
                <div key={item.id + i} style={artifactCardStyle(marginTop)}>
                  <Icon size={13} style={{ color, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)" }}>{item.title}</span>
                    <span style={{ fontSize: 9, color: "var(--border)" }}> · {item.verdict.replaceAll("_", " ")} by {item.reviewerName}</span>
                  </div>
                </div>
              );
            }

            return null;
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function artifactCardStyle(marginTop: string): React.CSSProperties {
  return {
    marginTop,
    padding: "6px 9px",
    background: "var(--background)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
}

const VERDICT_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  approve: { icon: CheckCircle2, color: "var(--accent-green)" },
  reject: { icon: XCircle, color: "var(--destructive)" },
  request_changes: { icon: AlertCircle, color: "#f97316" },
};
