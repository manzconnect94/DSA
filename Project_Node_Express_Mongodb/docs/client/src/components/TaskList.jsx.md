# `client/src/components/TaskList.jsx`

> Memoisation done deliberately — with a justified `useMemo`, a justified `useCallback`, and cheap values left alone on purpose.

**Lines:** 200 · **Concept blocks:** 5

## ⭐ `useMemo` and `useCallback` — when they help and when they HURT

**The most over-applied optimisation in React.** Both memoise, but different things:

| | Caches |
|---|---|
| `useMemo(fn, deps)` | The **result** of calling `fn` |
| `useCallback(fn, deps)` | The **function itself** |

In fact `useCallback(fn, d)` **is** `useMemo(() => fn, d)`.

### ⚠️ They are NOT free

Both must:

1. Allocate and keep the dependency array
2. Run a **comparison loop** over it on **every** render
3. Hold the cached value in memory for the component's lifetime

⭐ **For a cheap computation, that overhead COSTS MORE than just redoing the work.** `useMemo(() => a + b, [a, b])` is **strictly slower** than `a + b`.

**Saying that out loud is what separates "I've read the docs" from "I've profiled React."**

### ✅ When `useMemo` is worth it

- The computation is **genuinely expensive** — sorting/filtering thousands of items, parsing, heavy derivation. ⭐ **Rule of thumb: if it's not >1ms in the profiler, skip it.**
- The result is an **object or array** passed to a memoised child or used in a dependency array — here you're stabilising **identity**, not saving computation, and **that's often the real reason.**

### ✅ When `useCallback` is worth it

- The function goes to a **`React.memo`'d child** (a new identity defeats the memo entirely)
- The function is in a **`useEffect` dependency array** (a new identity re-runs the effect every render — sometimes **infinitely**)
- The function goes into a **context value** — see [`AuthContext`](../context/AuthContext.jsx.md)

### ❌ Skip both for

Simple arithmetic, string building, handlers on **plain DOM elements** (`<button onClick={...}>` — the DOM node is not a React component and cannot be "defeated"), and anything you haven't measured.

## ⚠️ The biggest trap

```jsx
<MemoChild style={{ color: 'red' }} onClick={() => x()} />
```

Both props are **new references every render**, so memo **always** sees a change and re-renders anyway. ⭐ **You paid for the comparison and got nothing.** Memoising a child is pointless unless **every** prop is stable.

*(React 19's compiler auto-memoises — itself an admission that doing this by hand was error-prone.)*

## What this file actually does

### ✅ A justified `useMemo`

```js
const visibleTasks = useMemo(() => { /* filter + sort */ }, [tasks, sortBy, hideCompleted]);
```

Filters **and** sorts the whole list — with 10,000 tasks that's a real O(n log n) cost. Without `useMemo` it would re-run on **every** render, including renders caused by something completely unrelated elsewhere on the page.

**Contrast:** `completedCount` is `.filter().length` — microseconds — and is deliberately **not** memoised.

⚠️ **`.sort()` MUTATES in place.** Sorting `tasks` directly would **mutate props** — an anti-pattern that produces stale UI, because React sees the same array reference and may skip the render. Hence `[...filtered].sort(...)`.

### ✅ A justified `useCallback` + `React.memo`

```jsx
const TaskRow = memo(function TaskRow({ task, onToggle, onDelete }) { ... });
// parent:
const handleToggle = useCallback((id, status) => { ... }, [onToggle]);
```

⭐ **They're a MATCHED SET.** Without `useCallback`, each row gets a new function every render, memo's shallow compare always fails, and **all 500 rows re-render** — the memo is pure overhead. **One without the other is usually wasted effort.**

## `React.memo`

By default, when a parent re-renders, **all** its children re-render — even ones whose props didn't change. `React.memo` adds a shallow prop comparison and bails out if nothing changed.

⚠️ "Shallow" is the catch: it compares with `Object.is`, so a new object or array literal **always** looks different.

## ⭐ The `key` prop — why index is a bug

Keys let React's reconciliation **match elements between renders**. A stable, unique key means "this is the **same** item, just moved".

### ❌ `key={index}` breaks when the list can reorder, filter, or have items inserted/removed at the front

Delete the first item and **every remaining item's index shifts down by one**, so React thinks **every item changed content** rather than that one was removed. Two visible consequences:

| # | Consequence |
|---|---|
| 1 | Unnecessary re-renders of every row (**performance**) |
| 2 | ⚠️ **STATE ATTACHES TO THE WRONG ROW.** If each row has an input or checkbox, its internal state stays with the **position**, not the item. Delete row 1 and **row 2's typed text jumps to row 1.** A real, confusing bug that **looks like data corruption.** |

⭐ Note this list has **both** a delete button **and** a sort control — so it's exactly the case where index keys would break.

⚠️ **And never `Math.random()`** as a key: it changes every render, so React **unmounts and remounts every item** — the worst possible outcome.

**Index IS acceptable** when the list is static, never reordered, never filtered, and the items have no state. **That's rarer than people assume**, so the habit should be a stable id.

## Interview questions

- **"When does `useMemo` help?"** → Expensive computation, or stabilising identity for a memo'd child / dep array. Then say it's a **net cost** otherwise — that's the discriminating part.
- **"Difference between `useMemo` and `useCallback`?"** → Result vs function. One is the other.
- **"I wrapped my component in `memo` and it still re-renders."** → Unstable prop identities. They're a matched set.
- **"Why not use the array index as a key?"** → Both consequences, especially state attaching to the wrong row.
- **"When IS index fine?"** → Static, never reordered, no per-item state.
- **"Any problem with `tasks.sort()`?"** → It mutates. You'd be mutating props and may not re-render.

## Related

- [`TaskForm.jsx`](./TaskForm.jsx.md) — the controlled/uncontrolled sibling
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — `useCallback` for a context value
- [`store/taskStore.js`](../store/taskStore.js.md) — selectors, the other approach to re-render control
- [`pages/ZustandPage.jsx`](../pages/ZustandPage.jsx.md) — re-renders, measured live
