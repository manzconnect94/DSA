# `client/src/pages/ZustandPage.jsx`

> The same data again, with **live render counters** that make selector subscriptions measurable.

**Lines:** 193 · **Concept blocks:** 3 · **Route:** `/zustand` (lazy)

## Why this page exists

⭐ **To make the Context re-render problem OBSERVABLE rather than theoretical.** Each panel counts its own renders. Type in a field or toggle a task and watch which components re-render and which don't.

| | Behaviour |
|---|---|
| [`TasksPage`](./TasksPage.jsx.md) (Context) | Re-renders **every** consumer on any change |
| **This page** (Zustand) | Only components whose **selected slice** changed re-render |

**That's the whole argument, demonstrated in about 30 lines.**

## The render counter

```js
function useRenderCount(label) {
  const count = useRef(0);
  count.current += 1;
  return <span className="render-badge">{label}: {count.current} renders</span>;
}
```

⭐ A ref, not state — because [incrementing state here would trigger a render, which would increment it, which would render](../context/AuthContext.jsx.md)... an infinite loop. **The counter itself demonstrates `useRef`'s second use.**

## The three demo components

| Component | Subscribes to | Behaviour |
|---|---|---|
| `TaskCounter` | `s => s.tasks.length` | ⭐ **Editing a task's title does NOT re-render it** — the length didn't change |
| `CompletedCounter` | the count of `status === 'done'` | Re-renders when a task is toggled, **not** when one is renamed |
| `WholeStoreConsumer` | ⚠️ **`useTaskStore()` — no selector** | Re-renders on **ANY** store change |

### ⭐ `WholeStoreConsumer` is the anti-pattern, shown deliberately

```js
const store = useTaskStore();   // ⚠️ no selector = subscribe to everything
```

It's the **control group**. Same store, completely different behaviour, **purely because of the selector.**

⭐ And critically: **without a selector, Zustand behaves exactly like Context.** That's the honest framing — Zustand isn't magically faster; **selectors** are the mechanism. Drop them and you've paid 1KB for nothing.

## What to try

The page includes this as an open `<details>`:

1. **Add a task** — every counter changes, so all re-render. **Expected.**
2. **Toggle a task from *todo* to *done*** — ⭐ `TaskCounter` should **NOT** re-render (length unchanged) but `CompletedCounter` **will**.
3. **`WholeStoreConsumer` re-renders every time regardless** — that's what a missing selector (and what Context) costs you.

⭐ Step 2 is the one to actually do. Seeing one counter freeze while its neighbour ticks is more convincing than any explanation.

## How selectors work

Zustand runs the selector after **every** store update and compares the **RESULT** with `Object.is`. If the result is unchanged, the component doesn't re-render.

That's why `useTaskCount()` (a **number**) is stable across a title edit, while a selector returning the whole `tasks` array would not be.

⚠️ **The footgun:** a selector returning a **new object** every time. `Object.is` always says "different", so you re-render constantly — **worse than no selector.** Full detail in [`taskStore.js`](../store/taskStore.js.md).

## Actions have stable identity

```js
const fetchTasks = useTaskStore(s => s.fetchTasks);
```

Action functions **never change identity**, so selecting them individually gives a stable reference that never causes a re-render — and can safely go in a `useEffect` dependency array without [the infinite-loop problem](../hooks/useFetch.js.md).

## The comparison table

The page renders a full Context vs Zustand vs Redux table (bundle size, selective subscriptions, provider, usable outside React, devtools, boilerplate, SSR safety), ending with:

> ⭐ *But first ask whether it is **server state**. If it lives in a database, React Query is usually the better answer than any of these three.*

Both sides are reachable in one click — [`ReactQueryPage`](./ReactQueryPage.jsx.md) is the next nav item.

## It reuses the same components

`TaskForm` and `TaskList` are imported unchanged from [`components/`](../components/README.md). ⭐ **That's only possible because they take props and callbacks only** — no store access. If they read from a store directly, this three-way comparison would need three copies of each.

## Interview questions

- **"How does Zustand avoid Context's re-render problem?"** → Selectors compared by result. Then: **without a selector it behaves identically to Context.**
- **"How would you prove a component isn't re-rendering?"** → A ref-based counter, or React DevTools' "highlight updates". This page does the former.
- **"Why a ref for the counter and not state?"** → State would trigger the render it's counting. Infinite loop.
- **"Why is my Zustand component re-rendering constantly?"** → A selector returning a new object.
- **"Context, Zustand or Redux?"** → The table, then the server-state reframing.

## Related

- [`store/taskStore.js`](../store/taskStore.js.md) — the store and the full comparison
- [`context/TaskContext.jsx`](../context/TaskContext.jsx.md) — the Context version
- [`ReactQueryPage.jsx`](./ReactQueryPage.jsx.md) — ⭐ the prior question
- [`components/TaskList.jsx`](../components/TaskList.jsx.md) — `React.memo`, the other re-render tool
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — `useRef` without re-rendering
