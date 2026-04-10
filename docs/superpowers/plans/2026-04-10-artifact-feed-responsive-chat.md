# Artifact Feed + Responsive ChatPanel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the ChatPanel with artifact events and system events in a unified feed, and make it responsive (sidebar on desktop, bottom sheet on mobile).

**Architecture:** Extend `useCompanyEvents` with 3 new artifact event handlers. Unify messages and events into a `FeedItem` discriminated union in GameView, passed to ChatPanel. ChatPanel renders each item type with appropriate styling. Responsive layout via Tailwind `md:` breakpoints.

**Tech Stack:** Next.js 16, React, Tailwind 4, lucide-react icons, TypeScript strict

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `web/src/hooks/useWebSocket.ts` | Add artifact event handlers to `useCompanyEvents` |
| Modify | `web/src/components/GameView.tsx` | Unify messages + events into FeedItem[], wire new WS handlers |
| Modify | `web/src/components/ChatPanel.tsx` | Render FeedItem types, responsive layout |

---

## Task 1: Extend useCompanyEvents with artifact event handlers

**Files:**
- Modify: `web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add artifact handlers to CompanyEventHandlers type**

In `web/src/hooks/useWebSocket.ts`, update the type (around line 39):

```ts
type CompanyEventHandlers = {
  onMessage?: (data: Record<string, unknown>) => void;
  onAgentJoined?: (data: Record<string, unknown>) => void;
  onAgentLeft?: (data: Record<string, unknown>) => void;
  onArtifactCreated?: (data: Record<string, unknown>) => void;
  onArtifactUpdated?: (data: Record<string, unknown>) => void;
  onArtifactReviewed?: (data: Record<string, unknown>) => void;
};
```

- [ ] **Step 2: Add stable dispatch callbacks**

After the existing `onAgentLeft` callback (around line 69), add:

```ts
const onArtifactCreated = useCallback(
  (data: Record<string, unknown>) => handlersRef.current.onArtifactCreated?.(data),
  []
);
const onArtifactUpdated = useCallback(
  (data: Record<string, unknown>) => handlersRef.current.onArtifactUpdated?.(data),
  []
);
const onArtifactReviewed = useCallback(
  (data: Record<string, unknown>) => handlersRef.current.onArtifactReviewed?.(data),
  []
);
```

- [ ] **Step 3: Subscribe to new events**

In the `useEffect` (around line 78), add to the `unsubs` array:

```ts
const unsubs = [
  socket.on("message_posted", onMessage),
  socket.on("agent_joined", onAgentJoined),
  socket.on("agent_left", onAgentLeft),
  socket.on("artifact_created", onArtifactCreated),
  socket.on("artifact_updated", onArtifactUpdated),
  socket.on("artifact_reviewed", onArtifactReviewed),
];
```

Update the dependency array of this `useEffect` to include the new callbacks:

```ts
}, [companyId, socket, onMessage, onAgentJoined, onAgentLeft, onArtifactCreated, onArtifactUpdated, onArtifactReviewed]);
```

- [ ] **Step 4: Verify lint**

Run: `cd /Users/noechague/Documents/finary/order66/web && bun run lint`

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useWebSocket.ts
git commit -m "feat(#72): extend useCompanyEvents with artifact event handlers"
```

---

## Task 2: Unify feed items in GameView

**Files:**
- Modify: `web/src/components/GameView.tsx`

- [ ] **Step 1: Define FeedItem type and replace messages state**

At the top of `web/src/components/GameView.tsx`, replace the `ChatMessage` type with a `FeedItem` discriminated union:

```ts
type FeedItem =
  | { kind: "message"; id: string; author: string; authorId: string; content: string; channel: string; timestamp: number }
  | { kind: "artifact_created"; id: string; authorName: string; artifactType: string; title: string; timestamp: number }
  | { kind: "artifact_updated"; id: string; authorName: string; title: string; oldStatus: string; newStatus: string; timestamp: number }
  | { kind: "artifact_reviewed"; id: string; reviewerName: string; title: string; verdict: string; timestamp: number }
  | { kind: "agent_joined"; id: string; name: string; role: string; timestamp: number }
  | { kind: "agent_left"; id: string; name: string; timestamp: number };
```

Export it so ChatPanel can import it:

```ts
export type { FeedItem };
```

- [ ] **Step 2: Replace messages state with feedItems**

Replace:
```ts
const [messages, setMessages] = useState<ChatMessage[]>([]);
```
With:
```ts
const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
```

- [ ] **Step 3: Update existing event handlers to produce FeedItems**

Update the `onMessage` handler in `useCompanyEvents`:
```ts
onMessage: (data) => {
  setFeedItems((prev) => [
    ...prev.slice(-99),
    {
      kind: "message" as const,
      id: data.message_id as string,
      author: data.author as string,
      authorId: data.author_id as string,
      content: data.content as string,
      channel: data.channel as string,
      timestamp: data.timestamp as number,
    },
  ]);
  // speech bubble logic stays the same
  if (officeRef.current) {
    showSpeechBubble(officeRef.current, data.author_id as string, data.content as string);
  } else {
    pendingBubblesRef.current.push({ agentId: data.author_id as string, content: data.content as string });
  }
},
```

Update `onAgentJoined` — add a feed item BEFORE the existing sprite logic:
```ts
onAgentJoined: (data) => {
  setFeedItems((prev) => [
    ...prev.slice(-99),
    {
      kind: "agent_joined" as const,
      id: crypto.randomUUID(),
      name: data.name as string,
      role: data.role as string,
      timestamp: Date.now(),
    },
  ]);
  // existing agent sprite logic stays unchanged
  const info: AgentInfo = { /* ... existing code ... */ };
  setAgents((prev) => [...prev.filter((a) => a.id !== info.id), info]);
  if (officeRef.current) {
    addAgentSprite(officeRef.current, data.agent_id as string, data.name as string, data.role as string);
  } else {
    pendingAgentsRef.current.push({ id: data.agent_id as string, name: data.name as string, role: data.role as string });
  }
},
```

Update `onAgentLeft` — add a feed item BEFORE the existing sprite logic:
```ts
onAgentLeft: (data) => {
  const agent = agents.find((a) => a.id === (data.agent_id as string));
  setFeedItems((prev) => [
    ...prev.slice(-99),
    {
      kind: "agent_left" as const,
      id: crypto.randomUUID(),
      name: agent?.name ?? (data.agent_id as string),
      timestamp: Date.now(),
    },
  ]);
  // existing logic stays
  setAgents((prev) => prev.filter((a) => a.id !== (data.agent_id as string)));
  if (officeRef.current) {
    removeAgentSprite(officeRef.current, data.agent_id as string);
  }
},
```

- [ ] **Step 4: Add artifact event handlers**

Add the 3 new handlers to the `useCompanyEvents` call:

```ts
onArtifactCreated: (data) => {
  setFeedItems((prev) => [
    ...prev.slice(-99),
    {
      kind: "artifact_created" as const,
      id: data.artifact_id as string,
      authorName: data.author_name as string,
      artifactType: data.artifact_type as string,
      title: data.title as string,
      timestamp: Date.now(),
    },
  ]);
},
onArtifactUpdated: (data) => {
  setFeedItems((prev) => [
    ...prev.slice(-99),
    {
      kind: "artifact_updated" as const,
      id: data.artifact_id as string,
      authorName: data.author_name as string,
      title: data.title as string,
      oldStatus: data.old_status as string,
      newStatus: data.new_status as string,
      timestamp: Date.now(),
    },
  ]);
},
onArtifactReviewed: (data) => {
  setFeedItems((prev) => [
    ...prev.slice(-99),
    {
      kind: "artifact_reviewed" as const,
      id: data.artifact_id as string,
      reviewerName: data.reviewer_name as string,
      title: data.title as string,
      verdict: data.verdict as string,
      timestamp: Date.now(),
    },
  ]);
},
```

- [ ] **Step 5: Update ChatPanel props**

Replace the `messages` prop with `feedItems`:

```tsx
<ChatPanel
  feedItems={feedItems}
  agents={agents}
  companyId={companyId}
  connected={connected}
/>
```

- [ ] **Step 6: Verify lint**

Run: `cd /Users/noechague/Documents/finary/order66/web && bun run lint`

- [ ] **Step 7: Commit**

```bash
git add web/src/components/GameView.tsx
git commit -m "feat(#72): unify messages and events into FeedItem discriminated union"
```

---

## Task 3: Update ChatPanel to render FeedItem types

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`

- [ ] **Step 1: Update imports and props**

Replace the `ChatMessage` type import with `FeedItem` from GameView. Update the component props:

```tsx
import { type FeedItem } from "./GameView";
import { FileText, CheckCircle, XCircle, AlertCircle, UserPlus, UserMinus } from "lucide-react";

// Remove the old ChatMessage and AgentInfo types (they're no longer needed for messages)

type AgentInfo = { id: string; name: string; role: string; status: string };

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
```

- [ ] **Step 2: Add verdict icon/color helper**

Add a helper function before the component:

```tsx
const VERDICT_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  approve: { icon: CheckCircle, color: "#33CC66" },
  reject: { icon: XCircle, color: "#D94040" },
  request_changes: { icon: AlertCircle, color: "#E89B1C" },
};
```

- [ ] **Step 3: Replace message rendering with FeedItem rendering**

Replace the chat tab content (the `messages.map(...)` block) with:

```tsx
{tab === "chat" ? (
  feedItems.length === 0 ? (
    <p className="text-white/30 text-xs text-center mt-8">
      Waiting for activity...
    </p>
  ) : (
    <div className="space-y-2">
      {feedItems.map((item, i) => {
        if (item.kind === "message") {
          return (
            <div key={`${item.id}-${i}`} className="group">
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
                <span className="text-white/20 text-[10px]">
                  {item.channel}
                </span>
              </div>
              <p className="text-white/70 text-xs leading-relaxed">
                {item.content}
              </p>
            </div>
          );
        }

        if (item.kind === "agent_joined") {
          return (
            <div key={`join-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
              <UserPlus className="size-3 shrink-0" style={{ color: "#33CC66" }} />
              <span><span className="text-white/60">{item.name}</span> joined the office</span>
            </div>
          );
        }

        if (item.kind === "agent_left") {
          return (
            <div key={`leave-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
              <UserMinus className="size-3 shrink-0" />
              <span><span className="text-white/60">{item.name}</span> left the office</span>
            </div>
          );
        }

        if (item.kind === "artifact_created") {
          return (
            <div key={`ac-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
              <FileText className="size-3 shrink-0" />
              <span>
                <span className="text-white/60">{item.authorName}</span> created {item.artifactType}{" "}
                <span className="font-semibold text-white/60">{item.title}</span>
              </span>
            </div>
          );
        }

        if (item.kind === "artifact_updated") {
          return (
            <div key={`au-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
              <FileText className="size-3 shrink-0" />
              <span>
                <span className="text-white/60">{item.authorName}</span> updated{" "}
                <span className="font-semibold text-white/60">{item.title}</span> → {item.newStatus}
              </span>
            </div>
          );
        }

        if (item.kind === "artifact_reviewed") {
          const cfg = VERDICT_CONFIG[item.verdict] ?? VERDICT_CONFIG.request_changes;
          const Icon = cfg.icon;
          return (
            <div key={`ar-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
              <Icon className="size-3 shrink-0" style={{ color: cfg.color }} />
              <span>
                <span className="text-white/60">{item.reviewerName}</span> {item.verdict.replace("_", " ")}{" "}
                <span className="font-semibold text-white/60">{item.title}</span>
              </span>
            </div>
          );
        }

        return null;
      })}
    </div>
  )
```

- [ ] **Step 4: Verify lint**

Run: `cd /Users/noechague/Documents/finary/order66/web && bun run lint`

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatPanel.tsx
git commit -m "feat(#72): render artifact and system events in ChatPanel feed"
```

---

## Task 4: Make ChatPanel responsive

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`

- [ ] **Step 1: Update collapsed state for responsive**

Replace the collapsed button (currently `absolute right-4 top-12`):

```tsx
if (collapsed) {
  return (
    <button
      onClick={() => setCollapsed(false)}
      className="absolute right-4 top-12 md:right-4 md:top-12 bottom-2 left-1/2 -translate-x-1/2 md:bottom-auto md:left-auto md:translate-x-0 bg-[#131620]/90 text-white/60 px-3 py-1.5 rounded-lg text-xs font-mono hover:bg-[#1C1F2E]/90 transition-colors border border-white/10"
    >
      PANEL ▸
    </button>
  );
}
```

- [ ] **Step 2: Update main panel container classes**

Replace the outer div classes:

Old:
```tsx
<div className="absolute right-0 top-0 h-full w-80 bg-[#12122a]/95 border-l border-white/10 flex flex-col font-mono text-sm backdrop-blur-sm">
```

New:
```tsx
<div className="absolute bottom-0 left-0 right-0 h-[40vh] rounded-t-xl md:rounded-none md:bottom-auto md:left-auto md:right-0 md:top-0 md:h-full md:w-80 bg-[#12122a]/95 border-t md:border-t-0 md:border-l border-white/10 flex flex-col font-mono text-sm backdrop-blur-sm">
```

- [ ] **Step 3: Add drag handle for mobile**

Add a drag handle at the top of the panel (inside the header div, as the first child):

```tsx
{/* Header */}
<div className="flex flex-col border-b border-white/10">
  {/* Mobile drag handle */}
  <div className="flex justify-center py-1.5 md:hidden">
    <div className="w-8 h-0.5 rounded-full bg-white/20" />
  </div>
  <div className="flex items-center justify-between px-3 py-2">
    {/* ... existing header content ... */}
  </div>
</div>
```

- [ ] **Step 4: Verify lint**

Run: `cd /Users/noechague/Documents/finary/order66/web && bun run lint`

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatPanel.tsx
git commit -m "feat(#72): make ChatPanel responsive — bottom sheet on mobile, sidebar on desktop"
```

---

## Task 5: Final integration check

**Files:**
- Verify all modified files

- [ ] **Step 1: Run lint**

```bash
cd /Users/noechague/Documents/finary/order66/web && bun run lint
```

- [ ] **Step 2: Verify no import errors**

Check that `FeedItem` is correctly exported from GameView and imported in ChatPanel:

```bash
grep -n "FeedItem" web/src/components/GameView.tsx web/src/components/ChatPanel.tsx
```

- [ ] **Step 3: Commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(#72): final lint + cleanup"
```
