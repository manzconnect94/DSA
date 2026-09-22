# `client/src/App.jsx`

> Routing, code splitting, and provider composition.

**Lines:** 275 · **Concept blocks:** 5

## ⭐ Code splitting with `React.lazy` + `Suspense`

By default a bundler produces **one** JavaScript file containing your entire app. A user landing on `/login` downloads the admin dashboard, the charting library and every page they'll never visit — **before they can type their password.**

`React.lazy()` turns an import into a dynamic `import()`, which tells the bundler to emit a **separate chunk**, fetched only when the component first renders.

### Why this works at all

⭐ It ties straight back to the [CJS vs ESM](../../server/app.js.md) discussion. Static `import` is resolved at build time and bundled. Dynamic `import()` returns a **promise** and is a deliberate **split point**. That's only possible because ESM's structure is **statically analysable** — CommonJS's `require()` cannot be split this way.

### What's split here

| Eager (in the main bundle) | Lazy (separate chunks) |
|---|---|
| `LoginPage`, `RegisterPage`, `TasksPage` | `ReactQueryPage`, `ZustandPage`, `QueryDemoPage`, `AdminPage` |

**Verified build output:**

```
QueryDemoPage-Hpq7Ci-8.js     3.81 kB │ gzip: 1.77 kB
ReactQueryPage-D1rgDtNe.js    4.69 kB │ gzip: 1.87 kB
AdminPage-DbHvkIHg.js         4.90 kB │ gzip: 1.97 kB
ZustandPage-Bke1UaGM.js      12.77 kB │ gzip: 4.76 kB
index-Cg7xnLqb.js            27.10 kB │ gzip: 9.02 kB   ← shell
```

Open the Network tab and navigate to `/admin` — watch the chunk download **at that moment**.

### ⭐ Where to split — the decision, not the syntax

| | |
|---|---|
| ✅ **Per route** | The biggest, safest win |
| ✅ **Heavy components below the fold**, or behind a modal/tab | |
| ✅ **A large dependency used on one screen** (chart library, rich-text editor, PDF viewer) | **Often a bigger win than route splitting** |
| ❌ **Tiny components** | Each chunk is an extra HTTP request, and small files compress worse. **Splitting a 2KB component makes things slower.** |
| ❌ **The component the user sees FIRST** | You'd add a round-trip to your most important paint |

⚠️ **The trade-off:** you've swapped bundle size for a **network request at navigation time**, which means a loading state mid-navigation. On a slow connection that can feel **worse** than one bigger initial download. Mitigation: **prefetch** on hover or on idle, so the chunk is cached before the click.

⚠️ **And a lazy chunk can FAIL to load** — a flaky network, or a deploy that removed the old hashed file while the user's tab was open. That rejects, and without a boundary it **blanks the app**. Note the `ErrorBoundary` wraps `Suspense` below — that ordering is deliberate, and it's why the [stale-`index.html` caching rule](../Dockerfile.md) matters.

## ⭐ Suspense placement

Suspense lets a **child** say "I'm not ready" and an **ancestor** decide what to show. Before it, every component managed its own `isLoading` flag and its own spinner — which is why apps ended up with five spinners appearing at different times.

⚠️ **Where you put the boundary is a UX decision:**

| Placement | Effect |
|---|---|
| One boundary around the whole app | The entire page is replaced by one spinner |
| A boundary per region | The rest of the UI **stays interactive** while one part loads |

⭐ Here the **`Navbar` sits OUTSIDE `Suspense` on purpose**, so navigation remains usable while a route chunk downloads. A user who clicks the wrong link can immediately click another.

## ⭐ Provider order matters

```jsx
<ErrorBoundary>
  <BrowserRouter>
    <AuthProvider>                    ← outer: sets up the axios interceptor
      <QueryClientProvider>
        <TaskProvider>                ← inner: its fetches depend on that
          <Navbar />
          <ErrorBoundary>             ← a second, inner boundary
            <Suspense>
              <Routes>...</Routes>
```

A provider can only read context from providers **above** it. `TaskProvider`'s fetch calls depend on the interceptor set up by `AuthProvider`, so Auth must be outer. The outer `ErrorBoundary` wraps everything, because **a crash inside a provider must still be caught**.

⭐ This is also where **"provider hell"** comes from — five nested providers is common, and it's one of [Zustand's selling points](./store/taskStore.js.md) that it needs **none**.

## One QueryClient for the whole app

```js
const queryClient = new QueryClient({ ... });   // ← OUTSIDE the component
```

⚠️ **The QueryClient IS the cache.** Create it outside the component (or in `useState`/`useRef`) — creating it **inside the render body** would build a **brand-new empty cache on every render**, silently defeating the entire library. A real and very confusing bug: everything works, nothing is ever cached.

## The catch-all route

```jsx
<Route path="/404" element={<NotFound />} />
<Route path="*" element={<Navigate to="/404" replace />} />
```

`path="*"` matches anything unmatched above. Without it, a typo'd URL renders **nothing** — a blank page with no explanation, which users report as "the site is broken". It's the client-side equivalent of the server's [`notFoundHandler`](../../server/middleware/errorHandler.js.md).

## Interview questions

- **"How does `React.lazy` work?"** → Dynamic `import()` → a separate chunk → fetched on first render. Then say *why* only ESM enables it.
- **"Where would you code-split?"** → Per route first, then heavy one-off dependencies. Not tiny components, not the first paint.
- **"What's the downside of code splitting?"** → A network round-trip mid-navigation, and chunks that can fail to load. Prefetch, and wrap in an error boundary.
- **"Where do you put a Suspense boundary?"** → As granularly as the UX wants. Keep navigation outside it.
- **"Why is nothing being cached by React Query?"** → The QueryClient is being recreated each render.
- **"Why does provider order matter?"** → Context only flows downward.

## Related

- [`main.jsx`](./main.jsx.md) — what renders this
- [`routes/ProtectedRoute.jsx`](./routes/ProtectedRoute.jsx.md) — the guards used here
- [`components/ErrorBoundary.jsx`](./components/ErrorBoundary.jsx.md) — why it wraps Suspense
- [`vite.config.js`](../vite.config.js.md) — vendor chunking, the other half of bundle strategy
- [`Dockerfile`](../Dockerfile.md) — why a stale `index.html` breaks lazy chunks
