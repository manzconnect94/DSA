# `client/src/hooks/useFetch.js`

> ⭐ A hand-rolled fetching hook — and the race condition almost every first version has.

**Lines:** 144 · **Concept blocks:** 4

## ⭐ The race condition

### ❌ The buggy version everyone writes first

```js
useEffect(() => {
  setLoading(true);
  axios.get(url).then(res => {
    setData(res.data);        // ← the bug lives here
    setLoading(false);
  });
}, [url]);
```

### The race, step by step

The user types "a", then quickly "ab":

| Time | Event |
|---|---|
| 0ms | `request("a")` starts |
| 50ms | `request("ab")` starts |
| 100ms | `request("ab")` **resolves** → `setData(results for "ab")` ✅ |
| 300ms | `request("a")` **resolves** → `setData(results for "a")` ❌ |

⭐ **The slower, OLDER request finishes LAST and overwrites the correct data.** The input says "ab" and the list shows results for "a".

⚠️ It's **intermittent**, it depends on network timing, and it **almost never reproduces on localhost** — which is exactly why it reaches production.

## The two fixes (both applied)

### ✅ Fix 1 — the ignore flag

A local boolean captured by the effect's closure. The cleanup sets it to `true`, so a response arriving **after** the effect re-ran is discarded.

```js
let ignore = false;
// ...
if (ignore) return;        // ⭐ THE GUARD — throw away the stale response
setData(res.data);
// ...
return () => { ignore = true; };
```

Simple, works for **any** async operation, and doesn't require the request itself to be cancellable.

### ✅ Fix 2 — `AbortController`

**Genuinely cancels** the HTTP request, so the browser stops waiting and the server can stop caring.

```js
const controller = new AbortController();
await axiosClient.get(url, { signal: controller.signal });
// ...
return () => { controller.abort(); };
```

⭐ **Use both.** They do different jobs:

| | Protects |
|---|---|
| `ignore = true` | **Correctness** — a late response can no longer call `setData` |
| `controller.abort()` | **Efficiency** — cancels the network request, saving bandwidth and server work |

⚠️ An aborted request throws `CanceledError`/`ERR_CANCELED`. That is **not an error** — it's us cancelling on purpose. Showing "Error: canceled" to the user would be wrong, so it's filtered out.

## ⚠️ Serialising params for a stable dependency

```js
const paramsKey = JSON.stringify(params ?? {});
```

`params` is usually an **object literal created inline by the caller**, so it's a **new reference every render**. Put it directly in a dependency array and the effect re-runs every render → fetch → `setState` → render → fetch...

⭐ **An infinite request loop.** One of the most common React bugs, and it usually presents as **"why is my API being called 400 times?"** Serialising gives a value that compares by **content**.

*(`JSON.stringify` is key-order-dependent, so `{a:1,b:2}` and `{b:2,a:1}` produce different keys and cause one extra fetch. Acceptable here; a stable-stringify would fix it.)*

## ⭐ What this hook STILL does not do

Having fixed the race condition, be honest about the gaps — **this list is the argument for React Query:**

| ❌ Missing | Consequence |
|---|---|
| **Cache** | Navigate away and back: full refetch, spinner, blank screen, for data you had a moment ago |
| **Deduplication** | Three components calling `useFetch('/tasks')` make **three identical simultaneous requests** |
| **Background revalidation** | Data silently goes stale |
| **Retry** | A transient blip surfaces as an error |
| **Stale-while-revalidate** | Can't show cached data instantly while refreshing behind the scenes |
| **Shared state** | Each caller has its own copy, and **they can disagree** |
| **Refetch on focus / reconnect** | |
| **Pagination / infinite-scroll primitives** | |

Every one is solved in [`pages/ReactQueryPage.jsx`](../pages/ReactQueryPage.jsx.md), which fetches the same data in about a third of the code.

## ⭐ The principle

**SERVER STATE IS NOT CLIENT STATE.** Server state is:

- **asynchronous** — loading and error states are unavoidable
- **shared** — other users change it without telling you
- **owned by someone else** — it can go stale with no action from you

**Treating it like local state (`useState` + `useEffect`) is what creates every gap above.** That framing is the strongest version of this answer.

## API

| Returns | Notes |
|---|---|
| `data`, `error`, `isLoading` | |
| `refetch()` | Increments a token in the dependency array to force a re-run |
| `durationMs` | Measured with `performance.now()` — surfaced in the UI |

Options: `{ params, skip, deps }`. `skip` supports conditional fetching (you can't call a hook conditionally, so the *hook* must support being told not to fetch).

## Interview questions

- **"Type 'a' then 'ab'. The slow 'a' response lands last. What happens?"** → Stale data overwrites fresh. Explain both fixes and what each protects.
- **"How do you cancel an in-flight request?"** → `AbortController` + the `signal` option. Note an abort is not an error.
- **"Why is my API called 400 times?"** → An unstable dependency — an inline object or function.
- **"What does React Query give you that this doesn't?"** → The eight-row table.
- **"Should server data live in Redux?"** → Usually no — it's a cache problem, not a state problem.
- **"When does the cleanup run?"** → Before the next effect and on unmount. That's what makes the ignore flag work.

## Related

- [`pages/ReactQueryPage.jsx`](../pages/ReactQueryPage.jsx.md) — ⭐ everything this lacks
- [`context/TaskContext.jsx`](../context/TaskContext.jsx.md) — the same manual pattern with a reducer
- [`useDebounce.js`](./useDebounce.js.md) — reduces how often this even runs
- [`pages/AdminPage.jsx`](../pages/AdminPage.jsx.md) — a real consumer
