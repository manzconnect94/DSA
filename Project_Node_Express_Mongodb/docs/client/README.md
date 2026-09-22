# `client/` — the React (Vite) frontend

> ESM, function components and hooks only (one deliberate exception). Three parallel implementations of the same feature so you can compare state strategies directly.

## ⭐ The organising idea: three ways to do the same thing

The same task list is implemented **three times**, on three routes. That's the whole point of the frontend.

| Page | State strategy | What it demonstrates |
|---|---|---|
| `/tasks` | **Context + useReducer**, manual `useEffect` fetching | The "classic" stack — and everything it doesn't give you |
| `/react-query` | **React Query** | Caching, dedup, background revalidation, optimistic updates |
| `/zustand` | **Zustand** with selectors | Granular subscriptions, with **live render counters** |

Open all three, watch the Network tab and the render counts, and the trade-offs stop being abstract.

⭐ **The reframing that matters** — and the strongest available answer to "Context or Redux?": first ask whether it's **server state** or **client state**. Most of what people put in a global store is server state, and a cache library handles it far better. See [`ReactQueryPage`](./src/pages/ReactQueryPage.jsx.md).

## Data flow

```
        ┌──────────────────────────────────────────┐
        │  axiosClient (interceptors)              │
        │   • attaches Authorization: Bearer       │
        │   • ⭐ single-flight refresh on 401       │
        │   • accessToken in a MODULE VARIABLE     │  ← memory, not localStorage
        └────────────────┬─────────────────────────┘
                         │
     ┌───────────────────┼───────────────────┐
     ▼                   ▼                   ▼
┌──────────┐      ┌─────────────┐     ┌─────────────┐
│AuthContext│      │TaskContext  │     │ taskStore   │
│ (rare Δ) │      │(useReducer) │     │ (Zustand)   │
└────┬─────┘      └──────┬──────┘     └──────┬──────┘
     │                   │                   │
     ▼                   ▼                   ▼
ProtectedRoute      TasksPage           ZustandPage
Navbar                                  (render counters)
```

## Folders

| Folder | Doc | Contents |
|---|---|---|
| `src/api/` | [→](./src/api/README.md) | The axios instance and its interceptors |
| `src/context/` | [→](./src/context/README.md) | AuthContext, TaskContext |
| `src/store/` | [→](./src/store/README.md) | Zustand store with selectors |
| `src/hooks/` | [→](./src/hooks/README.md) | useAuth, useFetch, useDebounce |
| `src/components/` | [→](./src/components/README.md) | ErrorBoundary, TaskForm, TaskList, Navbar |
| `src/pages/` | [→](./src/pages/README.md) | Seven pages |
| `src/routes/` | [→](./src/routes/README.md) | ProtectedRoute + PublicRoute |
| `src/test/` | [→](./src/test/README.md) | Vitest + React Testing Library |

## Root files

| File | Doc | Purpose |
|---|---|---|
| `src/main.jsx` | [→](./src/main.jsx.md) | `createRoot`, StrictMode |
| `src/App.jsx` | [→](./src/App.jsx.md) | Routing, code splitting, provider order |
| `src/styles.css` | [→](./src/styles.css.md) | Minimal dark theme |
| `vite.config.js` | [→](./vite.config.js.md) | Dev proxy, vendor chunking |
| `index.html` | [→](./index.html.md) | The SPA shell |
| `package.json` | [→](./package.json.md) | Dependencies |
| `.env.example` | [→](./env.example.md) | ⚠️ Where nothing is secret |
| `Dockerfile` | [→](./Dockerfile.md) | Build with Node, serve with nginx |
| `.dockerignore` | [→](./dockerignore.md) | |

## Routes

| Path | Guard | Loading |
|---|---|---|
| `/` | — | eager |
| `/login`, `/register` | `PublicRoute` | eager |
| `/tasks` | `ProtectedRoute` | eager |
| `/react-query`, `/zustand`, `/demo` | `ProtectedRoute` | **lazy** |
| `/admin` | `ProtectedRoute requireRole="admin"` | **lazy** |
| `*` | — | → `/404` |

The eager/lazy split is deliberate — see [code splitting](./src/App.jsx.md).

## ESM here, CommonJS on the server

Deliberate, so the repo shows both. The reason the client needs ESM: bundlers require **static analysis** to tree-shake unused code and to split bundles at dynamic `import()` boundaries — which is exactly what `React.lazy` relies on. CommonJS's runtime `require()` makes both impossible. Full comparison table in [`server/app.js`](../server/app.js.md).

## Verified build output

```
dist/assets/QueryDemoPage-*.js      3.81 kB │ gzip:  1.77 kB   ← lazy chunk
dist/assets/ReactQueryPage-*.js     4.69 kB │ gzip:  1.87 kB   ← lazy chunk
dist/assets/AdminPage-*.js          4.90 kB │ gzip:  1.97 kB   ← lazy chunk
dist/assets/ZustandPage-*.js       12.77 kB │ gzip:  4.76 kB   ← lazy chunk
dist/assets/index-*.js             27.10 kB │ gzip:  9.02 kB   ← app shell
dist/assets/query-vendor-*.js      93.35 kB │ gzip: 31.81 kB   ← vendor split
dist/assets/react-vendor-*.js     163.83 kB │ gzip: 53.46 kB   ← vendor split
```

⭐ Code splitting and vendor chunking, visible. A user landing on `/login` downloads the shell + vendors, **not** the admin page.

## Conventions

- **Function components and hooks only** — with one deliberate exception, [`ErrorBoundary`](./src/components/ErrorBoundary.jsx.md), because error boundaries **cannot** be hooks.
- **The access token lives in a module variable**, never localStorage — [XSS/CSRF reasoning](../server/utils/tokens.js.md).
- **Custom hooks wrap context** (`useAuth`), so the implementation can change without touching consumers.
- **`useMemo` on every Provider value** — omit it and every consumer re-renders on every provider render.
- **Client-side guards and validation are UX, never security.** The server enforces.

## Cross-cutting themes

| Theme | Where |
|---|---|
| **Server state ≠ client state** | [useFetch](./src/hooks/useFetch.js.md) → [TaskContext](./src/context/TaskContext.jsx.md) → [taskStore](./src/store/taskStore.js.md) → [ReactQueryPage](./src/pages/ReactQueryPage.jsx.md) |
| **Re-render granularity** | [AuthContext](./src/context/AuthContext.jsx.md) (the limit) → [taskStore](./src/store/taskStore.js.md) (the fix) → [ZustandPage](./src/pages/ZustandPage.jsx.md) (measured) |
| **`useEffect` cleanup** | [useDebounce](./src/hooks/useDebounce.js.md) (timers) · [Navbar](./src/components/Navbar.jsx.md) (listeners) · [useFetch](./src/hooks/useFetch.js.md) (requests) |
| **Client ≠ security boundary** | [ProtectedRoute](./src/routes/ProtectedRoute.jsx.md) · [RegisterPage](./src/pages/RegisterPage.jsx.md) · [AdminPage](./src/pages/AdminPage.jsx.md) |
| **Memoisation costs** | [TaskList](./src/components/TaskList.jsx.md) · [AuthContext](./src/context/AuthContext.jsx.md) |
