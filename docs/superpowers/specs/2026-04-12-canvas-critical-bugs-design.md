# Canvas Critical Bugs — Design Spec

> **Date:** 2026-04-12
> **Scope:** 3 critical bugs that make the product unusable

## Bug 1: Agent sprites disappear when navigating back to a company

### Root Cause

When leaving a company page, PixiJS canvas is destroyed (`app.destroy(true)`). When returning to the same company, the `useEffect` in GameView.tsx has `[companyId]` as dependency. Since `companyId` hasn't changed, React skips the effect. The canvas is never recreated, `officeRef.current` stays null, incoming `agent_joined` events queue in `pendingAgentsRef` but are never flushed.

### Fix

Add a `key` prop to the GameView component in the company page that forces a full remount on every navigation. Use `useId()` or a pathname-based key so React treats each visit as a new component instance.

**File:** `web/src/app/company/[id]/_content.tsx`

Change the GameView render from:
```tsx
<GameView companyId={id} />
```
To:
```tsx
<GameView key={pathname} companyId={id} />
```

Where `pathname` comes from `usePathname()`. Since Next.js reuses the component on back-navigation, this forces a clean remount every time.

If `usePathname()` returns the same value (same company), use a counter ref that increments on mount:

```tsx
const mountId = useRef(0);
useEffect(() => { mountId.current++; }, []);
// ...
<GameView key={`${id}-${mountId.current}`} companyId={id} />
```

This ensures every visit to the company page creates a fresh GameView with a fresh canvas.

## Bug 2: Agents stop talking after launch

### Root Cause

Agent processes crash or go silent because:
1. No kickoff message — agents only respond to messages, they don't initiate
2. If all agents are waiting for someone else to talk, silence is permanent

### Fix

Add a kickoff mechanism to the launcher. After all agents are spawned and connected (15s delay), the launcher sends a kickoff message to `#general` via WebSocket using the first PM agent's API key.

**File:** `agents/lib/launcher.ts`

After the spawn loop and healthcheck setup, add:

```typescript
// Send kickoff message after 15s to start conversations
setTimeout(async () => {
  const pmAgent = team.agents.find(a => a.role === "pm") || team.agents[0];
  const pmKey = keys.agents[pmAgent.name];
  if (!pmKey) return;

  const wsUrl = process.env.HIVE_URL || "ws://localhost:3000/agent";
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", api_key: pmKey }));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === "auth_ok") {
      const ch = d.channels?.find((c: { name: string }) => c.name === "#general") || d.channels?.[0];
      if (ch) {
        ws.send(JSON.stringify({
          type: "send_message",
          channel: ch.name,
          content: `Hey team, ${pmAgent.name} here. What are we working on today? Let's align on priorities.`,
        }));
        console.log(`[kickoff] ${pmAgent.name} sent to ${ch.name}`);
      }
      setTimeout(() => ws.close(), 2000);
    }
  };
}, 15_000);
```

This runs once per launcher start. The PM agent sends a generic kickoff that triggers responses from other agents.

## Bug 3: Chat doesn't auto-scroll to latest messages

### Root Cause

ChatPanel.tsx uses `scrollRef.current.scrollTop = scrollRef.current.scrollHeight` but the ref points to the content div inside shadcn's `ScrollArea`. The actual scrollable viewport is a different DOM element created by ScrollArea internally.

### Fix

Replace direct `scrollTop` manipulation with a sentinel element pattern:

**File:** `web/src/components/ChatPanel.tsx`

1. Add a ref for the bottom sentinel:
```tsx
const bottomRef = useRef<HTMLDivElement>(null);
```

2. Replace the scroll effect:
```tsx
useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: "smooth" });
}, [feedItems]);
```

3. Add the sentinel div after the last message in the scroll container:
```tsx
{feedItems.map((item) => (
  // ... existing message rendering
))}
<div ref={bottomRef} />
```

This works regardless of ScrollArea's internal DOM structure because `scrollIntoView` finds the nearest scrollable ancestor automatically.

## Acceptance Criteria

- [ ] Navigating away from a company and back shows agent sprites on the canvas
- [ ] Launching agents produces a kickoff message in #general after 15s
- [ ] New messages in chat auto-scroll to the bottom
- [ ] Existing scroll behavior preserved (user can still scroll up to read history)
