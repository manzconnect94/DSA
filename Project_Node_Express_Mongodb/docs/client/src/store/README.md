# `client/src/store/`

> A Zustand store managing **exactly the same state** as [`TaskContext`](../context/TaskContext.jsx.md), for direct comparison.

| File | Doc | Lines |
|---|---|---|
| `taskStore.js` | [→](./taskStore.js.md) | 201 |

## Why this folder exists at all

It's **redundant by design**. The same task state is managed three ways in this project:

| Location | Strategy |
|---|---|
| [`context/TaskContext.jsx`](../context/TaskContext.jsx.md) | Context + `useReducer` |
| **`store/taskStore.js`** | **Zustand + selectors** |
| [`pages/ReactQueryPage.jsx`](../pages/ReactQueryPage.jsx.md) | React Query (a cache) |

⭐ Duplication is the point. Run [`/zustand`](../pages/ZustandPage.jsx.md) next to `/tasks` and the difference in **re-render behaviour is measurable** — that page has live render counters — rather than something you have to take on faith.

## The one-line summary

| | Context | Zustand | Redux Toolkit |
|---|---|---|---|
| Bundle | 0 (built in) | ~1KB | ~12KB |
| **Selective subscriptions** | ❌ all consumers re-render | ✅ selectors | ✅ `useSelector` |
| Provider needed | Yes | **No** | Yes |
| Usable outside React | ❌ | ✅ `getState()` | ✅ `dispatch()` |
| Devtools | ❌ | ✅ (middleware) | ✅ best in class |
| SSR-safe by default | ✅ per-tree | ⚠️ module singleton | ✅ per-request |

Full reasoning in [`taskStore.js`](./taskStore.js.md).

## ⭐ But ask the prior question first

**"Is this server state or client state?"**

| | Owned by | Properties |
|---|---|---|
| **Client state** | Your app | Synchronous, you're the only writer. Sidebar open? Form contents? Active tab? |
| **Server state** | A database elsewhere | Asynchronous, **shared**, can go stale without you doing anything. Needs caching, dedup, revalidation, retries. |

⭐ **Most of what people put in Redux is server state**, and a general-purpose store is the wrong tool — you end up hand-writing a cache with none of the hard parts solved.

Once server state moves to React Query, the amount of genuinely global *client* state left is usually small enough that Context or Zustand is plenty. **That reframing is the strongest available answer to "Context or Redux?"**

## Interview questions

- **"Context, Zustand or Redux?"** → The table, then the reframing: first decide whether it's server state.
- **"Why is Zustand only 1KB when Redux is 12?"** → It does less: no middleware pipeline, no action creators, no reducer composition. You pay for what you use.
- **"Why does Zustand not need a provider?"** → The store lives in module scope, outside the React tree. Which is also its SSR weakness.

## Related

- [`taskStore.js`](./taskStore.js.md) — the implementation and the full comparison
- [`pages/ZustandPage.jsx`](../pages/ZustandPage.jsx.md) — render counters proving the difference
- [`context/README.md`](../context/README.md) — the Context side
