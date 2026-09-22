# `client/src/components/ErrorBoundary.jsx`

> ⭐ The only class component in the project — and the one thing hooks genuinely cannot do.

**Lines:** 167 · **Concept blocks:** 5

## ⭐ Why it MUST be a class

A guaranteed React question. An error boundary needs two lifecycle methods with **no hook equivalent**:

| Method | Phase | Purpose |
|---|---|---|
| `static getDerivedStateFromError(error)` | **RENDER** | Update state so the next render shows a fallback |
| `componentDidCatch(error, errorInfo)` | **COMMIT** | Side effects — logging to Sentry |

**There is no `useErrorBoundary`.** The React team has said one is planned but it doesn't exist today. So if you need a boundary you write a class — or use `react-error-boundary`, which is itself a class behind a hook-friendly API.

### Why the two methods are split

`getDerivedStateFromError` is **static**, so it has no access to `this`. That's deliberate: React calls it **during rendering**, and the render phase must stay **pure** — no side effects, no logging, no analytics. Its only job is to return the new state.

`componentDidCatch` runs **after** the DOM has been updated, so side effects are allowed. ⭐ `errorInfo.componentStack` is the gold here — it tells you **which component** threw, which a plain JS stack trace will not, because that shows React internals rather than your tree.

## ⚠️ What error boundaries do NOT catch

The follow-up, and the list matters because people assume they catch everything:

| ❌ Not caught | Why |
|---|---|
| **Event handlers** | An `onClick` that throws isn't part of rendering. Use a normal try/catch. |
| **Asynchronous code** | `setTimeout`, promises, `async`/`await`. The error happens on a later tick, **outside React's render call stack**. |
| **Server-side rendering** | |
| **An error in the boundary itself** | It propagates to the boundary **above** — which is why you want a minimal top-level boundary **plus** finer-grained ones inside |

✅ So a boundary catches errors in **rendering**, **lifecycle methods**, and **constructors** of the tree **below** it. That's it.

## ⚠️ And the big one: an uncaught error unmounts the ENTIRE tree

Since React 16. The reasoning was that **a corrupted UI is worse than no UI** — a banking app showing the wrong balance beats showing nothing.

In practice it means **one broken component blanks your whole app to a white screen** unless a boundary catches it. **That's why you want them.**

⭐ It's also an **observability** feature as much as a UX one: without a boundary you'd **never learn about the crash** — the user sees a white screen and closes the tab. `componentDidCatch` is where you report it.

## Where to place them

**Not just one at the root.** Wrap independent **regions** — a sidebar, a widget, each route — so a failure in one leaves the rest usable. **Granularity is a UX decision.**

In [`App.jsx`](../App.jsx.md) there are **two**:

```jsx
<ErrorBoundary>                   ← outer: catches provider crashes
  <BrowserRouter><AuthProvider>...
      <Navbar />                  ← stays alive if a route crashes
      <ErrorBoundary>             ← inner: catches route crashes
        <Suspense>
```

⭐ The inner one specifically catches a **failed lazy chunk load** — a flaky network, or a deploy that removed the old hashed file while the user's tab was open. That rejects, and without a boundary it blanks the app. See the [caching rule](../../Dockerfile.md).

## The reset affordance

```jsx
<button onClick={this.handleReset}>Try again</button>
```

⭐ A boundary that only shows "something broke" is a **dead end**. Resetting state lets React re-attempt the render — which **fixes it if the cause was transient** (a failed fetch, a momentary bad prop). If the bug is deterministic it errors again, **which is also useful information**.

## The `CrashTest` demo component

Exported alongside, and the contrast is baked in:

| Button | Caught? |
|---|---|
| "Throw in an event handler" | ❌ **No** — open the console; the app keeps running normally |
| "Throw during render" | ✅ **Yes** — the fallback appears |

⭐ **It demonstrates the limitation rather than just asserting it.**

## Props

| Prop | Purpose |
|---|---|
| `children` | The protected subtree |
| `fallback` | Custom UI — a node **or a function** `(error, reset) => node` |
| `onError` | An extra reporting hook |

## Interview questions

- **"Why must error boundaries be class components?"** → Two lifecycle methods with no hook equivalent. Name them.
- **"What do they NOT catch?"** → Event handlers, async code, SSR, and errors in themselves. This is the discriminating half.
- **"What happens to an uncaught React error?"** → The entire tree unmounts — a white screen. Since React 16, deliberately.
- **"Where do you put boundaries?"** → Per independent region, not just the root. It's a UX decision.
- **"Why is `getDerivedStateFromError` static?"** → It runs in the render phase, which must stay pure.
- **"How do you know which component threw?"** → `errorInfo.componentStack`; the JS stack won't tell you.

## Related

- [`App.jsx`](../App.jsx.md) — both boundaries, and why one wraps Suspense
- [`server/middleware/errorHandler.js`](../../../server/middleware/errorHandler.js.md) — the server analogue
- [`Dockerfile`](../../Dockerfile.md) — the stale-`index.html` problem that breaks lazy chunks
