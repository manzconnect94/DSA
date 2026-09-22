# `client/src/context/TaskContext.jsx`

> Task state via `useReducer`, with manual `useEffect` fetching. The "classic" stack — implemented so you can see what it *doesn't* give you.

**Lines:** 187 · **Concept blocks:** 4

## ⭐ `useReducer` vs several `useState`s

The real question is whether pieces of state **change together**.

❌ **With separate `useState`s**, one fetch touches four of them:

```js
setLoading(true); setError(null); setTasks(data); setLoading(false);
```

Four state updates, four chances to forget one, and it's possible to reach an **impossible state** (`loading: true` AND `error` set AND data present) because **nothing enforces consistency**.

✅ **With `useReducer`**, one dispatch describes one **event** and the reducer computes the whole next state atomically:

```js
dispatch({ type: 'FETCH_SUCCESS', payload: data })
```

⭐ **Impossible states become unrepresentable**, and the transition logic is a **pure function you can unit test with zero React involved.**

### Use `useReducer` when

- The next state depends on the previous one
- Several fields update together
- The logic is complex enough to be worth testing on its own
- You want to pass a stable `dispatch` down instead of a dozen callbacks — ⭐ **`dispatch` identity is guaranteed stable by React**, so it never needs `useCallback`

⭐ **And note: `useReducer` IS Redux's core idea** — `(state, action) => state` — built into React. Which raises the obvious question, answered in [`store/taskStore.js`](../store/taskStore.js.md): if React has this, why add Redux? (Answer: selectors, devtools, middleware.)

## ⭐ The reducer is a PURE function

`(state, action) => newState`. No side effects, no API calls, no `Date.now()`, no mutation.

| Payoff | Detail |
|---|---|
| **Testability** | Call it with a state and an action, assert on the result. No React, no rendering, no mocks. Milliseconds. |
| **Predictability** | Same state + same action → same result. **This is what makes time-travel debugging and action replay possible** in Redux DevTools. |

⚠️ **NEVER MUTATE:**

```js
❌ state.tasks.push(x); return state;
```

Returns the **same object reference**, so React's `Object.is` check sees **no change and skips the re-render**. Your data updated and the screen didn't. Always return a new object/array.

*(Redux Toolkit's `createSlice` lets you write apparently-mutating code because Immer produces an immutable copy underneath — worth knowing so the contrast isn't confusing.)*

## ⭐ Manual fetching — what it does NOT give you

This is the pattern everyone writes first. **You should be able to list the gaps, because that list IS the argument for React Query:**

| ❌ Missing | Consequence |
|---|---|
| **Caching** | Navigate away and back → refetch from scratch, spinner for data you had two seconds ago |
| **Deduplication** | Three components needing the same data fire **three identical requests** |
| ⭐ **Race-condition safety** | Type "ab" quickly: `request("a")` and `request("ab")` are both in flight. If "a" resolves **second**, you render results for "a" while the input shows "ab". *(Fixed in [`useFetch`](../hooks/useFetch.js.md) with an ignore flag + AbortController.)* |
| **Background refetch** | Data goes stale and **stays** stale until a manual reload |
| **Retry** | A transient network blip surfaces as an error |
| **Managed loading/error state** | Hand-written in every hook |

Compare directly with [`pages/ReactQueryPage.jsx`](../pages/ReactQueryPage.jsx.md), which fetches the same data and gets **every one** of those for free.

## One nice touch: keeping stale data visible

```js
case 'FETCH_START':
  return { ...state, status: 'loading', error: null };   // tasks deliberately kept
```

The old tasks stay on screen while refetching, rather than blanking the list — avoiding a jarring flash of empty state on every filter change. ⭐ That's **stale-while-revalidate, by hand** — and noting that React Query gives it for free is the point.

## ⭐ Optimistic updates

Update the UI **immediately**, assuming the server will succeed, then roll back if it doesn't. The app feels instant instead of showing a 200ms spinner for an action that almost always works.

```js
const snapshot = state.tasks.find(t => (t.id || t._id) === id);
dispatch({ type: 'REMOVE_TASK', payload: id });        // optimistic
try { await axiosClient.delete(...); }
catch { if (snapshot) dispatch({ type: 'ADD_TASK', payload: snapshot }); }   // ROLLBACK
```

⚠️ **The cost: you must be able to roll back.** Get it wrong and a failed delete makes the row **vanish permanently** until a reload — **the user believes it was deleted when it wasn't.**

**When it's appropriate:** high-success-rate, low-stakes, easily reversible actions (toggling a checkbox, liking a post, deleting a task). **NOT** for payments, or anything where a wrong intermediate state would mislead the user into acting on it.

The [React Query version](../pages/ReactQueryPage.jsx.md) formalises this into `onMutate`/`onError`/`onSettled` — and adds `cancelQueries`, which this hand-rolled version is missing.

## Actions

| Action | Effect |
|---|---|
| `FETCH_START` / `FETCH_SUCCESS` / `FETCH_ERROR` | Status transitions |
| `ADD_TASK` / `UPDATE_TASK` / `REMOVE_TASK` | List mutations |
| *unknown* | ⭐ **Throws** — catches typos immediately rather than silently doing nothing and leaving you debugging the UI |

## Interview questions

- **"When would you use `useReducer` over `useState`?"** → When state changes together, or the transition logic is worth testing. Impossible states become unrepresentable.
- **"Why must a reducer be pure?"** → Testability and predictability; it's what enables time-travel debugging.
- **"You mutate state and the UI doesn't update. Why?"** → Same reference, so React skips the render.
- **"What's wrong with `useEffect` + `useState` for data fetching?"** → The six-row table. Lead with the race condition.
- **"How do optimistic updates work, and when shouldn't you use them?"** → Apply, snapshot, roll back on failure. Not for high-stakes or irreversible actions.
- **"Isn't `useReducer` just Redux?"** → Same core idea; Redux adds selectors, devtools and middleware.

## Related

- [`pages/TasksPage.jsx`](../pages/TasksPage.jsx.md) — the consumer
- [`pages/ReactQueryPage.jsx`](../pages/ReactQueryPage.jsx.md) — the same data, done properly
- [`store/taskStore.js`](../store/taskStore.js.md) — the same data, with selectors
- [`hooks/useFetch.js`](../hooks/useFetch.js.md) — the race condition, fixed
- [`AuthContext.jsx`](./AuthContext.jsx.md) — the low-frequency sibling
