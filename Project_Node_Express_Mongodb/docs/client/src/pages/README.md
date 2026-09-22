# `client/src/pages/`

> One page per route. Pages wire hooks and state to presentational components.

| File | Doc | Route | Lines | Loading |
|---|---|---|---|---|
| `LoginPage.jsx` | [→](./LoginPage.jsx.md) | `/login` | 116 | eager |
| `RegisterPage.jsx` | [→](./RegisterPage.jsx.md) | `/register` | 110 | eager |
| `TasksPage.jsx` | [→](./TasksPage.jsx.md) | `/tasks` | 155 | eager |
| `ReactQueryPage.jsx` | [→](./ReactQueryPage.jsx.md) | `/react-query` | 305 | **lazy** |
| `ZustandPage.jsx` | [→](./ZustandPage.jsx.md) | `/zustand` | 193 | **lazy** |
| `QueryDemoPage.jsx` | [→](./QueryDemoPage.jsx.md) | `/demo` | 140 | **lazy** |
| `AdminPage.jsx` | [→](./AdminPage.jsx.md) | `/admin` | 164 | **lazy** |

## ⭐ Three pages, one feature

The most important thing about this folder: **the same task list is implemented three times.**

| Page | State strategy | Watch for |
|---|---|---|
| [`TasksPage`](./TasksPage.jsx.md) | Context + `useReducer`, manual `useEffect` fetching | The **cached/uncached pill** and query timings |
| [`ReactQueryPage`](./ReactQueryPage.jsx.md) | React Query | Navigate away and back — **instant from cache** |
| [`ZustandPage`](./ZustandPage.jsx.md) | Zustand + selectors | **Live render counters** per component |

⭐ **Open all three side by side.** Watch the Network tab and the render counts and the trade-offs stop being abstract. That comparison is only possible because [`TaskForm` and `TaskList`](../components/README.md) take **props and callbacks only** — no store access — so all three pages reuse them unchanged.

## Pages vs components

| | Knows about |
|---|---|
| **Page** | Hooks, context, stores, routing, the API |
| [**Component**](../components/README.md) | Only its props |

The practical test: a page may call `useAuth()` or `useTaskStore()`; a component may not.

## Eager vs lazy

The three pages a first-time visitor needs (`Login`, `Register`, `Tasks`) are **eager** — code-splitting them would add a network round-trip to the most important paint. The four comparison/demo pages are **lazy**. See [code splitting](../App.jsx.md) and the verified chunk sizes.

## Each page's headline concept

| Page | Concept |
|---|---|
| `LoginPage` | Fully controlled form · **vague error messages are deliberate** (anti-enumeration) |
| `RegisterPage` | Derived state should be **computed, not stored** · client validation is UX only |
| `TasksPage` | **Debounced search** · offset vs cursor pagination · cache visibility |
| `ReactQueryPage` | ⭐ **Server state ≠ client state** · `queryKey` · `staleTime` vs `gcTime` · optimistic updates |
| `ZustandPage` | ⭐ **Selector subscriptions**, with the anti-pattern shown deliberately |
| `QueryDemoPage` | A UI for the backend's [slow-vs-fast demos](../../../server/controllers/queryDemoController.js.md) |
| `AdminPage` | RBAC · cache hit rate · ⭐ **a live blocked-event-loop demo** |

## A shared habit: surfacing numbers in the UI

Several pages render `queryTimeMs`, a cached/uncached pill, render counts, or a `/api/health` response time.

⭐ **That's deliberate:** it turns an abstract discussion into an **observation**. Hit the same page twice and see `cached=false, 20ms` become `cached=true, 1ms` — that's [cache-aside](../../../server/utils/cache.js.md), visible.

## Interview questions

- **"How do you keep pages and components separate?"** → Pages know about data sources; components take props. It's what makes the three-way comparison possible here.
- **"Which routes would you code-split?"** → Not the first-paint ones. Everything behind a click.

## Related

- [`App.jsx`](../App.jsx.md) — routing and lazy loading
- [`components/`](../components/README.md) · [`hooks/`](../hooks/README.md) · [`context/`](../context/README.md) · [`store/`](../store/README.md)
