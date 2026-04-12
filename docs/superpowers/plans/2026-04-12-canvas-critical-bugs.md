# Canvas Critical Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 critical bugs: agent sprites disappearing on re-navigation, agents not kickstarting conversations, and chat not auto-scrolling to latest messages.

**Architecture:** Three independent fixes in separate files. Bug 1: force GameView remount via key prop. Bug 2: add kickoff WebSocket message in launcher. Bug 3: sentinel div + scrollIntoView pattern in ChatPanel.

**Tech Stack:** Next.js 16 (React), PixiJS 8, Bun WebSocket, shadcn/ui ScrollArea

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/app/company/[id]/_content.tsx` | Modify | Add key prop to GameView for clean remount |
| `agents/lib/launcher.ts` | Modify | Add kickoff message after spawn |
| `web/src/components/ChatPanel.tsx` | Modify | Auto-scroll via sentinel + scrollIntoView |

---

### Task 1: Fix agent sprites disappearing on re-navigation

**Files:**
- Modify: `web/src/app/company/[id]/_content.tsx:1-5,119`

- [ ] **Step 1: Add usePathname import and key prop**

In `web/src/app/company/[id]/_content.tsx`, add `usePathname` to the import on line 4:

Change line 4 from:
```typescript
import { useSearchParams, useRouter } from "next/navigation";
```
To:
```typescript
import { useSearchParams, useRouter, usePathname } from "next/navigation";
```

- [ ] **Step 2: Get pathname in the component**

After line 39 (`const router = useRouter();`), add:

```typescript
const pathname = usePathname();
```

- [ ] **Step 3: Add key prop to GameView**

Change line 119 from:
```tsx
        <GameView
          companyId={id}
```
To:
```tsx
        <GameView
          key={pathname}
          companyId={id}
```

This forces React to destroy and remount GameView on every navigation, ensuring a fresh PixiJS canvas, fresh WebSocket subscription, and fresh agent sprite rendering.

- [ ] **Step 4: Verify the fix**

1. Open http://localhost:3001 and click on Lyse company
2. See agent sprites on canvas
3. Click back to home page
4. Click on Lyse again
5. Agent sprites should appear again (not empty canvas)

- [ ] **Step 5: Commit**

```bash
git add web/src/app/company/[id]/_content.tsx
git commit -m "fix: force GameView remount on re-navigation via key prop"
```

---

### Task 2: Add kickoff message in launcher

**Files:**
- Modify: `agents/lib/launcher.ts:205-215`

- [ ] **Step 1: Add kickoff logic after the spawn loop**

In `agents/lib/launcher.ts`, find this line (after the spawn loop):

```typescript
console.log(`\n[launch] ${managed.size} agents running. Healthcheck every 60s.\n`);
```

Add the following AFTER that line and BEFORE `setInterval(healthcheck, 60_000);`:

```typescript
// Send kickoff message after 15s to start conversations
setTimeout(async () => {
  const pmAgent = team.agents.find((a) => a.role === "pm") || team.agents[0];
  const pmKey = keys.agents[pmAgent.name];
  if (!pmKey) return;

  const wsUrl = process.env.HIVE_URL || "ws://localhost:3000/agent";
  const kickoffWs = new WebSocket(wsUrl);
  kickoffWs.onopen = () => kickoffWs.send(JSON.stringify({ type: "auth", api_key: pmKey }));
  kickoffWs.onmessage = (e: MessageEvent) => {
    const d = JSON.parse(e.data as string);
    if (d.type === "auth_ok") {
      const ch = d.channels?.find((c: { name: string }) => c.name === "#general") || d.channels?.[0];
      if (ch) {
        kickoffWs.send(JSON.stringify({
          type: "send_message",
          channel: ch.name,
          content: `Hey team, ${pmAgent.name} here. What are we working on today? Let's align on priorities.`,
        }));
        console.log(`[kickoff] ${pmAgent.name} sent to ${ch.name}`);
      }
      setTimeout(() => kickoffWs.close(), 2000);
    }
  };
}, 15_000);
```

- [ ] **Step 2: Verify the launcher still compiles**

Run: `bun build --no-bundle agents/lib/launcher.ts --outdir /tmp/check 2>&1 | head -3`
Expected: Transpiled successfully (ignore ENOENT write error)

- [ ] **Step 3: Commit**

```bash
git add agents/lib/launcher.ts
git commit -m "feat: add kickoff message in launcher to start conversations"
```

---

### Task 3: Fix chat auto-scroll

**Files:**
- Modify: `web/src/components/ChatPanel.tsx:2,38-44,61,153`

- [ ] **Step 1: Add bottomRef**

In `web/src/components/ChatPanel.tsx`, on line 38, change:

```typescript
  const scrollRef = useRef<HTMLDivElement>(null);
```
To:
```typescript
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Replace the scroll effect**

Replace lines 40-44:
```typescript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedItems]);
```
With:
```typescript
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feedItems]);
```

- [ ] **Step 3: Add sentinel div after messages**

Find the closing of the feedItems map and add a sentinel div. After the messages rendering block (after line 153 which has `)}` closing the ternary), add the sentinel:

Find this pattern in the ScrollArea content div:
```tsx
            <div ref={scrollRef} className="px-4 py-3 space-y-3">
              {feedItems.length === 0 ? (
                <p className="text-muted-foreground text-xs text-center py-8">
                  Waiting for activity...
                </p>
              ) : (
                feedItems.map((item, i) => {
                  // ... all the item rendering
                })
              )}
```

Add right before the closing `</div>` of the scrollRef div:
```tsx
              <div ref={bottomRef} />
```

So the structure becomes:
```tsx
            <div ref={scrollRef} className="px-4 py-3 space-y-3">
              {feedItems.length === 0 ? (
                ...
              ) : (
                feedItems.map(...)
              )}
              <div ref={bottomRef} />
            </div>
```

- [ ] **Step 4: Verify in browser**

1. Open the Lyse company page
2. Wait for messages to arrive (or send a kickoff)
3. New messages should auto-scroll the chat to the bottom
4. Manually scroll up — you should stay at your position until new messages arrive
5. New messages should then scroll you back to bottom

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatPanel.tsx
git commit -m "fix: auto-scroll chat to latest messages via sentinel scrollIntoView"
```
