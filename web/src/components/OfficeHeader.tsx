"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  MessageSquare,
  Users,
  MoreHorizontal,
  Link,
  Video,
  FileText,
  Flag,
} from "lucide-react";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  forming: "secondary",
  struggling: "secondary",
  dissolved: "outline",
};

export function OfficeHeader({
  companyName,
  status,
  agentCount,
  messagesToday,
  chatOpen,
  agentsOpen,
  onlineCount,
  unreadCount,
  onChatToggle,
  onAgentsToggle,
}: {
  companyName: string;
  status: string;
  agentCount: number;
  messagesToday: number;
  chatOpen: boolean;
  agentsOpen: boolean;
  onlineCount: number;
  unreadCount: number;
  onChatToggle: () => void;
  onAgentsToggle: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-background border-b shrink-0">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="shrink-0 inline-flex cursor-pointer items-center justify-center rounded-md hover:bg-muted p-2"
      >
        <ArrowLeft className="size-4" />
      </button>

      <h1 className="text-sm font-semibold truncate">{companyName}</h1>

      <Badge variant={STATUS_VARIANT[status] || "outline"} className="shrink-0">
        {status}
      </Badge>

      <div className="ml-auto flex items-center gap-1">
        {/* Chat toggle */}
        <button
          type="button"
          onClick={onChatToggle}
          aria-label="Toggle chat"
          className={[
            "relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer",
            chatOpen
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          ].join(" ")}
        >
          <MessageSquare className="size-3.5" />
          <span className="hidden sm:inline">Chat</span>
          {!chatOpen && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-destructive text-destructive-foreground text-[10px] rounded-full flex items-center justify-center leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* Agents toggle */}
        <button
          type="button"
          onClick={onAgentsToggle}
          aria-label="Toggle agents"
          className={[
            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer",
            agentsOpen
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          ].join(" ")}
        >
          <Users className="size-3.5" />
          {onlineCount > 0 && (
            <>
              <span className="size-1.5 rounded-full bg-green-500 hidden sm:inline-block" />
              <span className="hidden sm:inline">{onlineCount}</span>
            </>
          )}
        </button>

        {/* More dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More options"
              className="inline-flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                navigator.clipboard.writeText(window.location.href)
              }
            >
              <Link className="size-4 mr-2" />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem disabled>
                  <Video className="size-4 mr-2" />
                  Record workspace
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem disabled>
                  <FileText className="size-4 mr-2" />
                  View artifacts
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
            <DropdownMenuSeparator />
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem disabled>
                  <Flag className="size-4 mr-2" />
                  Report issue
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
