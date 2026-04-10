# `useDebouncedResource` — async resource hook with debounced invalidation

## Problem

Our app has ~30 places where a component needs to fetch an async resource keyed by some input (search box, filter panel, date range). Today each site rolls its own: some use `useEffect` + `AbortController`, some use SWR with a manual `keepPreviousData` flag, and two use a stale homegrown `useFetch` that leaks on unmount. Three bugs in the last quarter trace to this inconsistency (race conditions when inputs change faster than the network).

## API proposal

```ts
type Resource<T> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "ready"; value: T }
  | { status: "error"; error: Error; previous?: T };

function useDebouncedResource<K, T>(
  key: K,
  fetcher: (key: K, signal: AbortSignal) => Promise<T>,
  options?: {
    debounceMs?: number;      // default 250
    keepPrevious?: boolean;   // default true
    equals?: (a: K, b: K) => boolean; // default Object.is
  }
): Resource<T>;
```

### Usage

```tsx
const results = useDebouncedResource(
  { query, filters },
  ({ query, filters }, signal) => api.search(query, filters, { signal }),
  { debounceMs: 300 }
);

if (results.status === "loading" && !results.previous) return <Spinner />;
```

## Why this shape

**Discriminated union over boolean flags.** `{ isLoading, data, error }` cannot distinguish "loading for the first time" from "refetching with stale data visible" without a fourth flag. Callers get it wrong ~half the time. The discriminated union forces them to handle both cases.

**`previous` is on the loading/error states, not as a separate field.** This means TypeScript naturally surfaces "you have stale data, decide whether to show it" as a thing the caller must opt into. Prior art: Relay's `fetchPolicy: "store-and-network"` and TanStack Query's `isPlaceholderData`.

**Debounce is first-class, not a wrapper.** We tried `useDebouncedValue(key) + useResource(debounced)` and it has a subtle bug: if the user types fast, we still issue the request for the final debounced value even if the component unmounts in between. Folding debounce into the hook lets us cancel the pending timer on unmount in one place.

**`equals` escape hatch.** `Object.is` is wrong when `key` is a new object literal each render (common with filter panels). Consumers can pass a stable comparator without memoizing the key itself.

## Alternatives considered

- **Adopt TanStack Query.** Correct long-term answer, but touches all 30 call sites and pulls in a 40KB dep. Out of scope for this change; this hook is a stepping stone that shares its mental model, so migration later is mechanical.
- **Just fix the race conditions in each site.** Rejected: we'd fix the same bug 30 times.

## Edge cases handled

- Unmount during pending debounce → timer cleared, no fetch issued.
- Key changes during in-flight fetch → previous fetch aborted via `AbortSignal`.
- Fetcher throws synchronously → caught, surfaces as `error` state.
- `keepPrevious: false` → `previous` field is never populated (for cases where stale data is misleading, e.g. permission checks).

## Non-goals

Caching across components, request deduplication, retry on error. If we need those, we adopt TanStack Query; this hook is deliberately the smallest thing that fixes the race-condition bugs.
