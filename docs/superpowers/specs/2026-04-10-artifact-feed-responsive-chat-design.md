# Issue #72 — Artifact Feed + Responsive ChatPanel

**Date:** 2026-04-10

**Issue:** https://github.com/noemuch/hive/issues/72
**Status:** Design approved

---

## Overview

Two changes to the web frontend:
1. **Live feed enrichi** — show artifact events (created/updated/reviewed) and system events (agent_joined/agent_left) in the ChatPanel alongside regular messages
2. **Responsive ChatPanel** — sidebar on desktop, bottom sheet on mobile

**Not in scope:** artifact visuals on canvas, company profile panel, REST endpoint for artifacts, reputation_updated events, tooltip, animations.

## 1. Live Feed Enrichi

### Event types to handle

All events come via WebSocket through `useCompanyEvents`. Three new handler types need to be added.

| WS Event | Display | Icon | Color |
|----------|---------|------|-------|
| `artifact_created` | "{author_name} created {type} **{title}**" | FileText | `--text-muted` |
| `artifact_updated` | "{author_name} updated **{title}** -> {new_status}" | FileText | `--text-muted` |
| `artifact_reviewed` | "{reviewer_name} {verdict} **{title}**" | CheckCircle / XCircle | green (approve) / red (reject) / amber (request_changes) |
| `agent_joined` | "{name} joined the office" | UserPlus | `#33CC66` |
| `agent_left` | "{name} left the office" | UserMinus | `--text-muted` |

### Data model

Unify messages and events into a single feed item type:

```ts
type FeedItem =
  | { kind: "message"; id: string; author: string; authorId: string; content: string; channel: string; timestamp: number }
  | { kind: "artifact_created"; id: string; authorName: string; artifactType: string; title: string; timestamp: number }
  | { kind: "artifact_updated"; id: string; authorName: string; title: string; oldStatus: string; newStatus: string; timestamp: number }
  | { kind: "artifact_reviewed"; id: string; reviewerName: string; title: string; verdict: string; timestamp: number }
  | { kind: "agent_joined"; id: string; name: string; role: string; timestamp: number }
  | { kind: "agent_left"; id: string; name: string; timestamp: number };
```

### Where it lives

- `FeedItem` type and rendering logic in `ChatPanel.tsx` (no rename — avoid breaking imports)
- GameView passes new events to ChatPanel via existing props pattern (add `feedItems` or extend `messages`)
- Keep last 100 items total (same cap as current messages)

### Rendering

- Regular messages: keep current style (author name colored by role, content below)
- System events (join/leave): single line, italic, muted color, icon on the left
- Artifact events: single line, italic, muted color, icon on the left, title in bold

### WebSocket extension

Add 3 new handlers to `useCompanyEvents` in `web/src/hooks/useWebSocket.ts`:
- `onArtifactCreated`
- `onArtifactUpdated`
- `onArtifactReviewed`

The `agent_joined` and `agent_left` events are already handled — just need to emit feed items from the existing handlers in GameView.

## 2. Responsive ChatPanel

### Desktop (>= 768px)
- Current layout: `absolute right-0 top-0 h-full w-80` sidebar
- No changes needed

### Mobile (< 768px)
- Switch to bottom sheet: `absolute bottom-0 left-0 right-0 h-[40vh]` with rounded top corners
- Collapsed state: thin bar at bottom instead of small button at top-right
- Swipe hint: small drag handle at top center (2px x 32px rounded bar)

### Implementation
- CSS-only with Tailwind responsive prefixes (`md:` for desktop breakpoint)
- Collapsed toggle adapts position accordingly
- No JS media query detection needed

## Decisions

1. **Single mixed feed** (not separate tabs) — more lively for demo, everything visible at once
2. **CSS-only responsive** (not Sheet component) — ChatPanel already works, just adapt classes
3. **No canvas artifacts** — doesn't fit the pixel art aesthetic
4. **No ChatPanel rename** — avoid import churn for no functional gain
5. **Join/leave events from existing handlers** — no new WS subscription needed, just emit feed items from the already-handled events

## Server-side changes

None. All artifact WS events (artifact_created, artifact_updated, artifact_reviewed) are already implemented and broadcast by the server. We only consume them on the frontend.
