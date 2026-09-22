# `client/src/`

> All application source. ESM, function components and hooks — with one deliberate class component.

## Root files

| File | Doc | Lines | Purpose |
|---|---|---|---|
| `main.jsx` | [→](./main.jsx.md) | 61 | Mounts React. `createRoot` + StrictMode. |
| `App.jsx` | [→](./App.jsx.md) | 275 | Routing, code splitting, provider composition |
| `styles.css` | [→](./styles.css.md) | 400 | Minimal dark theme |

## Folders

| Folder | Doc | Files | Purpose |
|---|---|---|---|
| `api/` | [→](./api/README.md) | 1 | The axios instance and interceptors |
| `context/` | [→](./context/README.md) | 2 | AuthContext, TaskContext |
| `store/` | [→](./store/README.md) | 1 | Zustand, for comparison with Context |
| `hooks/` | [→](./hooks/README.md) | 3 | useAuth, useFetch, useDebounce |
| `components/` | [→](./components/README.md) | 4 | ErrorBoundary, TaskForm, TaskList, Navbar |
| `pages/` | [→](./pages/README.md) | 7 | One per route |
| `routes/` | [→](./routes/README.md) | 1 | ProtectedRoute + PublicRoute |
| `test/` | [→](./test/README.md) | 2 | Vitest setup + component tests |

## The layering

```
main.jsx
  └─ App.jsx  ── ErrorBoundary ▸ BrowserRouter ▸ AuthProvider
                  ▸ QueryClientProvider ▸ TaskProvider
       │
       ├─ components/Navbar          (outside Suspense — stays interactive)
       └─ Suspense ▸ Routes
            └─ routes/ProtectedRoute
                 └─ pages/*
                      ├─ hooks/*        useFetch, useDebounce
                      ├─ context/*  or  store/*
                      └─ components/*   TaskForm, TaskList
                                   │
                                   └─ api/axiosClient  ──▶  the server
```

⭐ **Provider order matters** — a provider can only read context from providers **above** it. `TaskProvider`'s fetches depend on the interceptor set up by `AuthProvider`, so Auth must be outer. See [`App.jsx`](./App.jsx.md).

## Import conventions

Relative paths only — no path aliases, deliberately, so every import shows you where the file actually lives while reading.

```js
import { useAuth } from '../context/AuthContext';   // or '../hooks/useAuth'
import axiosClient from '../api/axiosClient';
```

⭐ Note `useAuth` is importable from **two** places. [`hooks/useAuth.js`](./hooks/useAuth.js.md) is a re-export, so the implementation can move from Context to Zustand or Redux **without touching a single consumer**. That's the abstraction-boundary idea applied to imports.

## What lives where — and why

| Concern | Location | Rationale |
|---|---|---|
| HTTP + auth token | `api/` | One place attaches headers and handles 401 refresh |
| Rarely-changing global state | `context/AuthContext` | Context is a **good** fit for low-frequency values |
| Frequently-changing shared state | `store/` | Context re-renders **every** consumer; selectors don't |
| Server state | `pages/ReactQueryPage` | ⭐ A **cache**, not a state manager — the right tool |
| Reusable stateful logic | `hooks/` | Extracted so it's testable with `renderHook` |
| Presentational + one class | `components/` | `ErrorBoundary` **must** be a class |
| Route-level composition | `pages/` | One page per route; they wire hooks to components |
| Access control (UX only) | `routes/` | ⚠️ Not security — the server enforces |

## The one class component

[`ErrorBoundary.jsx`](./components/ErrorBoundary.jsx.md) is the only class in the codebase, because `getDerivedStateFromError` and `componentDidCatch` have **no hook equivalent**. There is no `useErrorBoundary`. Everything else is a function component.

## Where the interesting content is

If you're reading for revision, these five:

| File | Why |
|---|---|
| [`api/axiosClient.js`](./api/axiosClient.js.md) | ⭐ Single-flight refresh — a real concurrency bug with a non-obvious fix |
| [`hooks/useFetch.js`](./hooks/useFetch.js.md) | ⭐ The fetch race condition everyone writes at least once |
| [`components/TaskList.jsx`](./components/TaskList.jsx.md) | When memoisation helps vs costs; why index keys are a bug |
| [`store/taskStore.js`](./store/taskStore.js.md) | Context vs Redux vs Zustand, with the reframing |
| [`components/TaskForm.jsx`](./components/TaskForm.jsx.md) | Controlled vs uncontrolled, with a live render counter |
