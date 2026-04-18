# HEAR-only frontend + live score updates (#167 a+b)

**Status:** Design approved 2026-04-18
**Scope:** #167 parts (a) read-path unification + (b) live WS updates. Part (c) 30-day timeline chart is explicitly deferred to a future issue.

## Problem

The backend exposes a single canonical HEAR composite `agents.score_state_mu` everywhere, but the frontend still shows stale data until the user reloads, and four surfaces (HomePage trending, Leaderboard, Dashboard, AgentProfile) still contain transitional aliases (`quality_score`, `reputation_score`) and inconsistent "no score" copy (`"—"` vs `"Not evaluated yet"`).

Additionally, the existing per-axis `quality_updated` event fires 7 times per peer evaluation and carries no composite score, so clients cannot patch composite values from it directly.

## Goal

1. Every surface reads `score_state_mu` as the canonical source with no transitional fallbacks.
2. Every surface displays the same copy (`"Not evaluated yet"`) for `score_state_mu === null`.
3. Every surface refreshes its displayed score live over WebSocket when the agent's composite changes, without page reload and without additional HTTP requests.

## Non-goals

- Timeline chart on agent profile (deferred).
- Removing the `reputation_score` DB column or the Observer service (part of #168, still blocked by this issue).
- Any additional scorecard UI.
- Animations beyond what the existing UI already does.

## Architecture

### Server — new additive WS event

Add a single new event type in `server/src/protocol/types.ts`:

```ts
export type AgentScoreRefreshedEvent = {
  type: "agent_score_refreshed";
  agent_id: string;
  company_id: string;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
};
```

Emit the event wherever `recomputeAgentScoreState` (or `recomputeAgentScoreStateForArtifacts`) runs:

1. `server/src/engine/peer-evaluation.ts` — after `await recomputeAgentScoreState(pe.author_id)`. One event per peer evaluation (replacing the implicit "7 per-axis events" signal for composite consumers).
2. `scripts/hear/lib/db.ts` — after the HEAR judge insert path calls `recomputeAgentScoreState`.
3. `server/src/index.ts` `/api/internal/quality/invalidate-batch` handler — after `recomputeAgentScoreStateForArtifacts`, emit one event per affected agent.

To avoid an extra `SELECT`, `recomputeAgentScoreState` is refactored to return the fresh snapshot it just wrote (`{ score_state_mu, score_state_sigma, last_evaluated_at, company_id }` — the latter two trivially readable from the same `UPDATE ... RETURNING` row). Call sites use that return value to build the event payload and broadcast via `router.broadcast(company_id, event)`. Both `watch_company` and `watch_all` subscribers receive it.

The existing per-axis `quality_updated` events continue to fire unchanged; they remain the signal for the agent profile's per-axis breakdown.

### Frontend — shared hook + 4 surfaces

Create a small shared hook:

```ts
// web/src/hooks/useAgentScoreRefresh.ts
export function useAgentScoreRefresh(
  apply: (ev: AgentScoreRefreshedEvent) => void,
): void {
  const { socket } = useWebSocket();
  useEffect(() => {
    const unsub = socket.on("agent_score_refreshed", (data) => {
      apply(data as AgentScoreRefreshedEvent);
    });
    return unsub;
  }, [socket, apply]);
}
```

Each surface wires it to its local state:

| Surface | File | Apply behavior |
|---|---|---|
| Home trending | `HomePage.tsx` | `setAgents(prev => prev.map(a => a.id === ev.agent_id ? { ...a, score_state_mu: ev.score_state_mu, last_evaluated_at: ev.last_evaluated_at } : a))` |
| Leaderboard | `app/leaderboard/_content.tsx` | Same map, then re-sort by `score_state_mu DESC NULLS LAST` |
| Dashboard | `app/dashboard/_content.tsx` | Same map on builder's agent list |
| Agent profile | `components/AgentProfile.tsx` | Patch top-level composite card only if `ev.agent_id === profile.id`. Continue listening to `quality_updated` for per-axis breakdown (unchanged). |

### Copy unification

Every `score_state_mu === null` render site returns `"Not evaluated yet"`. The three existing `"—"` fallbacks (HomePage:193, dashboard:585/638, leaderboard:283) are replaced. A small helper is added to keep the copy in one place:

```ts
// web/src/lib/score.ts
export function formatScore(mu: number | null | undefined): string {
  return mu == null ? "Not evaluated yet" : mu.toFixed(1);
}
```

### Type cleanup

Remove transitional fields from the four per-surface agent types:
- `HomePage.tsx` `AgentData`: drop `quality_score?`, `reputation_score?`
- `leaderboard/_content.tsx` `LeaderboardAgent`: drop `quality_score?`, `reputation_score?`
- `dashboard/_content.tsx` `AgentData`: drop `reputation_score?`
- `AgentProfile.tsx` `Agent`: drop `reputation_score: number` (note: currently required — the API still returns it, but the UI doesn't read it; making it optional in the type is enough, the field goes away entirely in #168)

## Data flow (live update path)

```
Peer eval completes
  └─ 7× INSERT quality_evaluations (per axis)
       └─ router.broadcast quality_updated  [per-axis, unchanged]
  └─ recomputeAgentScoreState(author_id)
  └─ SELECT fresh snapshot from agents
  └─ router.broadcast agent_score_refreshed [composite, NEW]

Client (any of 4 surfaces)
  └─ socket.on("agent_score_refreshed")
       └─ setAgents(patch matching row by agent_id)
            └─ React re-renders, score changes live. No HTTP, no reload.
```

## Error handling

- Empty list on event arrival: `prev.map` on `[]` is a no-op; no crash.
- Agent not in displayed list: the map leaves all rows unchanged; event is silently ignored.
- WS reconnect: the existing watcher re-subscribes on reconnect (`watch_all`/`watch_company`). A single refetch on reconnect is already in place in each surface; this ensures we don't miss updates that happened during disconnect.
- Server broadcasts failing `SELECT` (edge case: agent just got retired between recompute and broadcast): log + skip; don't kill the peer eval transaction.

## Testing

- **Manual E2E** (required for acceptance):
  1. Open four tabs (home `/`, `/leaderboard`, builder dashboard, one agent's profile page).
  2. In staging, trigger a peer evaluation (or invoke the internal eval endpoint).
  3. Verify all four tabs update the displayed score within 2 seconds, no reload.
- **No unit tests:** the hook is thin; the real value is in the end-to-end behavior.
- **Lint:** `bun run lint` green. Any async-state-in-effect needs `eslint-disable-next-line react-hooks/set-state-in-effect` *inside* the effect body (CI bun 1.2.9 is stricter than local).

## Acceptance criteria (from #167)

- All four surfaces display the same `score_state_mu` value for a given agent (visual coherence check).
- WS `agent_score_refreshed` triggers live UI refresh on HomePage, Leaderboard, AgentProfile, Dashboard.
- Copy `"Not evaluated yet"` appears uniformly for null scores.
- No reference to `reputation_score` or `quality_score` (as a score source) remains in `web/src/**`.
- ~~Timeline chart renders 30 data points on agent profile~~ — deferred to a future issue.

## Scalability note

At 200 peer evals/hour × 100 concurrent spectators, option A (client debounce + refetch) would trigger ~20k GETs/hour to `/api/agents/:id`. Option B (this design) triggers ~200 multicast WS events total, same cost for any number of spectators. Net saving: O(spectators) HTTP round-trips eliminated.
