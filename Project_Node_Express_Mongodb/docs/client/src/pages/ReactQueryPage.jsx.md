# `client/src/pages/ReactQueryPage.jsx`

> ⭐ The same data as `TasksPage`, with far less code — and the file that carries the project's most important frontend idea.

**Lines:** 305 · **Concept blocks:** 8 · **Route:** `/react-query` (lazy)

## ⭐ Server state vs client state

The framing that matters, and the strongest available answer to "Context or Redux?"

| | **Client state** | **Server state** |
|---|---|---|
| Owned by | Your app | **A database elsewhere** |
| Timing | Synchronous | **Asynchronous** — loading/error states unavoidable |
| Writers | You only | **Shared** — others change it without telling you |
| Freshness | Always current | ⭐ **Potentially stale the instant you receive it** |
| Needs | `useState`/Context/Zustand | **Caching, dedup, revalidation, retries** |

⭐ **The core insight: MOST OF WHAT PEOPLE PUT IN REDUX IS SERVER STATE**, and a general-purpose state container is the wrong tool — you end up **hand-writing a cache with none of the hard parts solved.**

**React Query is a CACHE, not a state manager.** Once server state moves there, the genuinely global *client* state left over is usually small enough that Context or Zustand is plenty.

## The comparison, concretely

Put this file next to [`TasksPage`](./TasksPage.jsx.md) + [`TaskContext`](../context/TaskContext.jsx.md) + [`useFetch`](../hooks/useFetch.js.md). Those three hand-roll loading state, error state, a reducer, race-condition guards and optimistic updates. **This one file does all of it, plus caching, in ~40 lines of logic.**

| Feature | Manual (Context + useEffect) | React Query |
|---|---|---|
| Loading / error state | A reducer with 5 action types | **Free** |
| Caching | ❌ none | **Free** |
| Request deduplication | ❌ none | **Free** |
| Race conditions | Manual ignore flag + AbortController | **Free** |
| Retry with backoff | ❌ none | Free (configurable) |
| Refetch on focus / reconnect | ❌ none | **Free** |
| Optimistic update + rollback | Hand-written snapshot logic | A standard 3-callback pattern |

*(That table is rendered in the page itself, in a collapsible block.)*

## ⭐ The `queryKey` IS the cache key

The most important concept in React Query. A serialisable array that uniquely identifies this data. Everything follows from it:

| | |
|---|---|
| Change the key | → a different cache entry → a fetch |
| Same key in ten components | → **ONE** request, ten subscribers |
| Invalidate a key | → marked stale → refetch |
| ⭐ Keys are **hierarchical** | Invalidating `['tasks']` invalidates `['tasks',{page:1}]` **and** `['tasks',{page:2}]` — matching is by **prefix**. That's how one mutation refreshes every page. |

⚠️ **Every value the query depends on MUST be in the key.** Omit `page` and page 2 would serve page 1's cached data — ⭐ **the same class of bug as an incomplete [server-side cache key](../../../server/utils/cache.js.md), where it's a security issue.**

## ⭐ `staleTime` vs `gcTime` — the two timers people confuse

| | What it controls | Default |
|---|---|---|
| **`staleTime`** | How long data is considered **FRESH**. While fresh, React Query will **NOT refetch** — even on remount or window focus. | **0** — which is why newcomers see "it refetches constantly" |
| **`gcTime`** (was `cacheTime`) | How long an **unused** entry stays in memory after the last component using it unmounts. **This is what makes going back to a page instant.** | 5 min |

⭐ **They're independent: data can be STALE but still CACHED.** That combination is what enables **stale-while-revalidate** — show the stale data instantly, refetch in the background, swap it in.

Set here to 30s / 5min.

## ⭐ `isLoading` vs `isFetching`

A frequent point of confusion:

| | Meaning | Show |
|---|---|---|
| `isLoading` | **No data yet** | A skeleton/spinner |
| `isFetching` | A request is in flight, **but you may already have cached data** | A subtle indicator, **not** a full-page spinner |

⚠️ **Using `isFetching` for the main loading state is what causes the "it flashes a spinner every time I focus the tab" complaint.**

Both are surfaced in the page's perf bar, along with `isPlaceholderData` and `dataUpdatedAt`.

## `placeholderData: keepPreviousData`

A big pagination UX win. Without it, clicking "next page" **blanks the list and shows a spinner** — the whole layout jumps. With it, the **previous page stays on screen** (flagged via `isPlaceholderData`) until the new one arrives. No layout shift, no flicker.

## Retry — but not blindly

```js
retry: (failureCount, err) => {
  const status = err?.response?.status;
  if (status && status >= 400 && status < 500) return false;   // ⚠️
  return failureCount < 3;
},
retryDelay: attempt => Math.min(1000 * 2 ** attempt, 30_000),
```

⚠️ **Retrying a 404 or 403 is pointless** — those will never succeed. Blindly retrying 4xx **wastes requests and can trip your own [rate limiter](../../../server/middleware/rateLimiter.js.md).** Only 5xx and network failures are retried, with exponential backoff.

## ⭐ Optimistic updates with automatic rollback

```js
onMutate:  async (id) => {
  await queryClient.cancelQueries({ queryKey: ['tasks'] });   // ⚠️ essential
  const previous = queryClient.getQueryData(['tasks', params]);
  queryClient.setQueryData(['tasks', params], old => /* remove it */);
  return { previous };                    // → becomes `context` in onError
},
onError:   (_e, _id, context) => queryClient.setQueryData(['tasks', params], context.previous),
onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
```

Compare with the [hand-rolled version](../context/TaskContext.jsx.md), where you manually snapshot and manually re-add. Here the pattern is formalised: **apply → roll back on error → reconcile either way.**

⚠️ **`cancelQueries` in `onMutate` is the subtle, essential bit:** without it, an **in-flight refetch can land AFTER your optimistic update** and overwrite it with pre-mutation data — ⭐ **making the change appear to revert itself.** A genuinely confusing bug.

## `useMutation` + invalidation

`onSuccess` invalidates the affected keys and React Query refetches. ⭐ **That's the client-side mirror of the [server-side cache invalidation](../../../server/utils/cache.js.md)** — the exact same problem ("my write isn't visible") solved at a different layer.

## What to try in the browser

1. Navigate away and back — **instant from cache**, then a background revalidation
2. Search for something, clear it, search the same term again — **instant**, because that `queryKey` is still cached
3. Switch tabs and come back — watch the focus refetch
4. Click "next page" — the previous page stays visible

## Interview questions

- **"What does React Query give you that `useEffect` doesn't?"** → The seven-row table.
- **"Is React Query a state manager?"** → No — a **cache**. Then the server-vs-client-state reframing. ⭐ This is the answer that stands out.
- **"What's in a `queryKey`?"** → Everything the query depends on. Prefix matching enables bulk invalidation.
- **"`staleTime` or `gcTime`?"** → Freshness vs retention. Independent — data can be stale but cached.
- **"Why does my page flash a spinner on tab focus?"** → Using `isFetching` instead of `isLoading`.
- **"How do optimistic updates roll back?"** → Snapshot in `onMutate`, restore in `onError`, reconcile in `onSettled` — and cancel in-flight queries first.
- **"Should you retry every failed request?"** → No. 4xx won't succeed and you may trip your own rate limiter.

## Related

- [`TasksPage.jsx`](./TasksPage.jsx.md) — the manual version
- [`hooks/useFetch.js`](../hooks/useFetch.js.md) — ⭐ the gap list this closes
- [`context/TaskContext.jsx`](../context/TaskContext.jsx.md) — hand-rolled optimistic updates
- [`store/taskStore.js`](../store/taskStore.js.md) — the third strategy
- [`App.jsx`](../App.jsx.md) — the QueryClient, and why it must live outside render
- [`server/utils/cache.js`](../../../server/utils/cache.js.md) — the same invalidation problem server-side
