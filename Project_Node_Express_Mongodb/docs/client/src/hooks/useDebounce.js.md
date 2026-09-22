# `client/src/hooks/useDebounce.js`

> Debounces a value. The clearest demonstration of **why `useEffect` returns a cleanup function**.

**Lines:** 100 · **Concept blocks:** 3

## The problem

A user types "backend" — **7 keystrokes**. Without debouncing that's **7 API calls** in under a second. Six are already obsolete before they return, and each runs a [regex query](../../../server/controllers/taskController.js.md) against your database (an unindexed COLLSCAN).

⭐ **You've multiplied your database load by the user's typing speed** to display one result set.

**The solution:** wait until the user stops typing for 400ms, then fire once. **7 requests → 1.**

## ⭐ The cleanup function is the debounce

The function returned from `useEffect` runs **(a)** before the effect re-runs, and **(b)** on unmount. Follow the sequence — this is the whole trick:

| Event | What happens |
|---|---|
| keystroke `"b"` | Effect runs, schedules a timer for 400ms |
| keystroke `"ba"` | `value` changed → React first runs **CLEANUP** (clearing the `"b"` timer), **then** the effect again with a fresh timer |
| keystroke `"bac"` | Cleanup cancels `"ba"`, new timer for `"bac"` |
| *...user stops...* | |
| 400ms later | The **surviving** timer fires exactly **once** |

⚠️ **Remove `clearTimeout` and every keystroke's timer survives:** all 7 fire, 400ms apart. **You've added latency without removing a single request** — arguably worse than no debounce.

⭐ **The cleanup IS the debounce.** It isn't defensive tidying; it's the mechanism.

## ⚠️ Why cleanup matters generally

Any effect creating something long-lived must dispose of it:

| Creates | Dispose with |
|---|---|
| `setTimeout` / `setInterval` | `clearTimeout` / `clearInterval` |
| `addEventListener` | `removeEventListener` — [example](../components/Navbar.jsx.md) |
| A WebSocket or subscription | `close` / `unsubscribe` |
| An in-flight fetch | [`AbortController.abort()`](./useFetch.js.md) |

**Without cleanup**, an unmounted component's callback still fires, **still holds a reference to that component's closure (so it's never garbage collected)**, and may call `setState` on something that no longer exists.

## ⭐ Debounce vs throttle

They get confused constantly. Both are exported here so the contrast is concrete.

| | Behaviour | Use for |
|---|---|---|
| **Debounce** | Wait for a **pause** in events, then act. Each new event **RESETS** the timer. ⚠️ **If events never stop, it NEVER fires.** | Search-as-you-type, autosave, window-resize-then-recalculate, validating a field after typing stops |
| **Throttle** | Act **at most once per N ms, GUARANTEED**, regardless of how many events arrive | Scroll handlers (you need periodic updates **while** scrolling, not just at the end), mousemove, rate-limiting a button |

⭐ **One-liner:** debounce = *"tell me when they're done"*; throttle = *"tell me at most every N ms"*.

⚠️ The "never fires" property of debounce is a real trap: debounce a scroll handler and a user who scrolls continuously gets **zero** updates until they stop.

## Value-based, not callback-based

```js
const debouncedSearch = useDebounce(searchInput, 400);
```

This debounces the **value**, not the callback. It composes better with React's render model:

| | |
|---|---|
| `searchInput` | Updates on **every keystroke** → instant UI feedback (a controlled input) |
| `debouncedSearch` | Updates 400ms after typing stops → this is what goes in the **effect's dependency array** |

⭐ Result: **7 instant UI updates, 1 API call.** A callback-based `useDebouncedCallback` would need a stable identity to avoid re-creating the timer, which is fiddlier.

⚠️ The subtle mistake: putting `searchInput` (not `debouncedSearch`) in the dependency array. It refetches on every keystroke and makes the debounce pointless — see [`TasksPage`](../pages/TasksPage.jsx.md), which also renders a "typing…" pill so you can *see* the gap.

## The throttle implementation's caveat

`useThrottle` tracks `lastRun` in **state**, so it appears in its own dependency array. It works and reads clearly, but a production version would use a `ref` to avoid the extra render. Worth noticing as an example of the [`useRef` vs `useState`](../context/AuthContext.jsx.md) decision.

## Interview questions

- **"Debounce or throttle for a search box?"** → Debounce. For scroll? Throttle. Then explain *why* — pause-detection vs guaranteed cadence.
- **"When does the cleanup function run?"** → Before the next effect and on unmount. Then walk the keystroke sequence.
- **"What happens if you forget `clearTimeout`?"** → Every timer fires; you've added latency and saved nothing.
- **"What leaks without cleanup?"** → Timers, listeners, subscriptions, requests — each holding a dead closure alive.
- **"Debounce a scroll handler — any problem?"** → It may never fire while scrolling continues.
- **"How do you test a debounce?"** → [Fake timers](../test/TaskForm.test.jsx.md) — instantly.

## Related

- [`pages/TasksPage.jsx`](../pages/TasksPage.jsx.md) — the consumer, with the "typing…" indicator
- [`useFetch.js`](./useFetch.js.md) — cleanup applied to requests
- [`components/Navbar.jsx`](../components/Navbar.jsx.md) — cleanup applied to listeners
- [`test/TaskForm.test.jsx`](../test/TaskForm.test.jsx.md) — the `renderHook` + fake-timers test
- [`server/controllers/taskController.js`](../../../server/controllers/taskController.js.md) — the expensive query this protects
