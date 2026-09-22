# `client/src/store/taskStore.js`

> Zustand store with exported selector hooks. The same state as `TaskContext`, so the comparison is direct.

**Lines:** 201 · **Concept blocks:** 4

## ⭐ Context vs Redux vs Zustand

"Context API or Redux?" is a standard question, and the strong answer names the **actual** differences rather than repeating "Redux is for big apps".

### Context API

| ✅ | ❌ |
|---|---|
| Built in — zero dependencies, zero bundle cost | ⭐ **Re-render granularity is all-or-nothing.** Any change re-renders **every** consumer, even one reading an unrelated field. `React.memo` **cannot** help — `useContext` subscribes the component directly. |
| Perfect for **low-frequency** global values: theme, locale, current user, feature flags | No devtools, middleware or persistence |
| | Provider nesting gets deep fast ("provider hell") |
| | ⭐ It's a **dependency injection** mechanism, **not a state manager** — it has no opinion about how state is updated |

### Redux Toolkit

| ✅ | ❌ |
|---|---|
| ⭐ **Selector-based subscriptions**: `useSelector(s => s.tasks.length)` re-renders **only** when that derived value changes. **The core technical reason to leave Context.** | Boilerplate (much reduced by RTK, but slices/reducers/actions are still ceremony) |
| Superb devtools: time-travel, action log, state diffs | ~12KB gzipped |
| Middleware for async, logging, analytics; RTK Query for caching | |
| A strict, enforced structure — **a real advantage on a large team**, because everyone writes state code the same way | |

### Zustand (this file)

| ✅ | ❌ |
|---|---|
| Selector subscriptions like Redux — the key performance property | Less structure, so a large team can drift into inconsistent patterns |
| **~1KB. No provider needed** | Devtools are decent but not Redux-grade |
| Almost no boilerplate | ⚠️ Module singleton — an SSR problem (below) |
| ⭐ Callable from **outside React** (`useTaskStore.getState()`) — genuinely useful in an axios interceptor or a websocket handler, where you have no hooks | |

## ⭐ The recommendation

First ask: **is this SERVER state or CLIENT state?**

Most of what people put in Redux is **server state** — data that lives in a database and is cached in the browser. React Query / RTK Query handle that **far** better (caching, refetching, invalidation, dedup). Once you remove server state, what's genuinely left is small: UI state, filters, a wizard's progress, an auth session.

For that: **Context** for rarely-changing values, **Zustand** for anything updating frequently, **Redux** when you need its devtools/middleware ecosystem or the team structure.

⭐ **"You probably don't need a global store, you need a server-cache library"** — that reframing is the answer that stands out.

## ⭐ The store lives OUTSIDE the React tree

Note the absence of a `<Provider>`. `create()` builds a store in **module scope**; components subscribe with a hook.

| ✅ | ⚠️ |
|---|---|
| No provider nesting, no "must be used within a Provider" errors | |
| **Readable and writable from non-React code** — `useTaskStore.getState().reset()` works in an axios interceptor | |
| | **It's a MODULE SINGLETON.** In SSR that's a real problem: the store is **shared across all concurrent requests on the server**, so **one user's data can leak into another's render.** SSR needs a per-request store (which means... a provider after all). **Context does not have this problem**, because it's created per tree. |

That last row is the honest counterpoint to "Zustand needs no provider".

## ⭐ Selectors — the actual performance advantage

```js
❌ const { tasks, status, error } = useTaskStore();
```

No selector → subscribes to the **whole store** → re-renders on **any** change. **Exactly Context's behaviour.**

```js
✅ const count = useTaskStore(s => s.tasks.length);
```

Re-renders **only** when `tasks.length` changes. Change the `filter` and it doesn't re-render at all. Zustand runs the selector after each update and compares the **result** with `Object.is`.

### ⚠️ The classic Zustand footgun

```js
❌ useTaskStore(s => ({ tasks: s.tasks, status: s.status }))
```

That object literal is a **new reference on every store change**, so `Object.is` always says "different" and you re-render constantly — **worse than no selector**, because you also pay the selector cost.

**The fix:** select primitives with separate calls (simplest and usually best), or pass a shallow-equality comparator as the second argument.

## Exported selector hooks

| Hook | Subscribes to |
|---|---|
| `useTaskList()` | `tasks` |
| `useTaskStatus()` / `useTaskError()` | one field each |
| `useTaskCount()` | ⭐ `tasks.length` — a **derived number**, so editing a task's title doesn't re-render |
| `useCompletedCount()` | the count of done tasks |
| `useTaskActions()` | the action functions (identity never changes → never re-renders) |

Exporting these keeps the footgun out of components' hands — they can't accidentally subscribe to everything.

## `set()` merges shallowly

`set({ status: 'loading' })` does **not** replace the whole state — Zustand shallow-merges, which is why there's no `...state` spread (unlike a Redux reducer).

⚠️ **Shallow**, though: to update a nested object you still spread it yourself, as `setFilter` does.

Use the **functional form** when the next state depends on the current one — it's atomic and avoids a stale read if two updates race.

## `devtools` middleware

Wires into the Redux DevTools browser extension — you get the same action log and time travel **without Redux itself**. The third argument to `set()` names the action (`'tasks/fetchSuccess'`), which is what makes the log readable.

## Interview questions

- **"Context, Zustand or Redux?"** → The three tables, then the server-state reframing.
- **"How does Zustand avoid Context's re-render problem?"** → Selectors compared by result, so a component only re-renders when its slice changes.
- **"Why is my Zustand component re-rendering constantly?"** → A selector returning a new object each time.
- **"What breaks with a module-level store in SSR?"** → It's shared across requests; user data can leak.
- **"When would you call a store from outside React?"** → An axios interceptor, a websocket handler, an analytics listener.
- **"Isn't `useReducer` already Redux?"** → Core idea, yes. Redux adds selectors, devtools, middleware.

## Related

- [`pages/ZustandPage.jsx`](../pages/ZustandPage.jsx.md) — the difference, with live render counters
- [`context/TaskContext.jsx`](../context/TaskContext.jsx.md) — the same state via Context
- [`pages/ReactQueryPage.jsx`](../pages/ReactQueryPage.jsx.md) — ⭐ why this may be the wrong tool entirely
