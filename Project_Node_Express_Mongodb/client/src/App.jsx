// ============================================================
// 🧠 CONCEPT: CODE SPLITTING with React.lazy + Suspense
// WHY IT MATTERS (interview angle): by default a bundler produces ONE
//   JavaScript file containing your entire app. A user landing on /login
//   downloads the admin dashboard, the charting library and every page
//   they will never visit — before they can type their password.
//
//   React.lazy() turns an import into a DYNAMIC import(), which tells the
//   bundler to emit a SEPARATE CHUNK. That chunk is fetched over the
//   network only when the component first renders.
//
//   ⭐ WHY THIS WORKS AT ALL — it ties back to the ESM discussion in
//   server/app.js. Static `import` is resolved at build time and bundled.
//   Dynamic `import()` returns a PROMISE and is a deliberate split point.
//   That is only possible because ESM's structure is statically
//   analysable; CommonJS's `require()` cannot be split this way.
//
//   MEASURING IT: run `npm run build` and look at dist/assets. You will
//   see separate hashed .js files for AdminPage, QueryDemoPage, etc.
//   Then open the Network tab and navigate to /admin — watch the chunk
//   download at that moment.
//
//   ⭐ WHERE TO SPLIT — the decision, not just the syntax:
//   ✅ PER ROUTE (done below). The biggest, safest win: a user only
//      downloads the pages they visit.
//   ✅ Heavy components below the fold, or behind a modal/tab.
//   ✅ A large dependency used on one screen (a chart library, a rich
//      text editor, a PDF viewer). Often a bigger win than route
//      splitting.
//   ❌ NOT tiny components. Each chunk is an extra HTTP request, and
//      small files compress worse. Splitting a 2KB component makes things
//      slower.
//   ❌ NOT the component the user sees FIRST — you would just add a
//      round-trip to your most important paint.
//
//   ⚠️ THE TRADE-OFF: you have swapped bundle size for a network request
//   at navigation time, which means a loading state mid-navigation. On a
//   slow connection that can feel WORSE than one bigger initial download.
//   The mitigation is PREFETCHING — start loading the chunk on hover or
//   on idle, so it is already cached by the time the user clicks.
//
//   ⚠️ AND: a lazy chunk can FAIL to load (flaky network, or a deploy
//   that removed the old hashed file while the user's tab was open). That
//   rejects, and without an error boundary it blanks the app. Note the
//   ErrorBoundary wrapping Suspense below — that ordering is deliberate.
// ============================================================

import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from './context/AuthContext';
import { TaskProvider } from './context/TaskContext';
import ErrorBoundary from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import ProtectedRoute, { PublicRoute } from './routes/ProtectedRoute';

// ---- EAGERLY loaded: needed on first paint, so splitting would only add latency ----
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import TasksPage from './pages/TasksPage';

// ---- LAZILY loaded: separate chunks, fetched on first visit ----
const ReactQueryPage = lazy(() => import('./pages/ReactQueryPage'));
const ZustandPage = lazy(() => import('./pages/ZustandPage'));
const QueryDemoPage = lazy(() => import('./pages/QueryDemoPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

// ============================================================
// 🧠 CONCEPT: One QueryClient for the whole app
// WHY IT MATTERS (interview angle): the QueryClient IS the cache. Create
//   it OUTSIDE the component (or in useState/useRef) — creating it inside
//   the render body would build a brand-new empty cache on every render,
//   silently defeating the entire library. That is a real and very
//   confusing bug: everything works, nothing is ever cached.
// ============================================================
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function HomePage() {
  return (
    <div className="page">
      <h1>MERN Interview Boilerplate</h1>
      <p className="subtitle">A Task Manager that exists to demonstrate concepts, not to be a product.</p>

      <div className="callout">
        <strong>Start here:</strong>
        <ol>
          <li>
            Seed the database: <code>cd server &amp;&amp; npm run seed</code>
          </li>
          <li>
            Log in as <code>demo@example.com / Password123</code>
          </li>
          <li>
            Visit <Link to="/demo">Query demos</Link> for the slow-vs-fast comparison.
          </li>
        </ol>
      </div>

      <h2>Pages, and what each one demonstrates</h2>
      <ul className="concept-index">
        <li>
          <strong>
            <Link to="/tasks">Tasks (Context)</Link>
          </strong>{' '}
          — Context + useReducer, manual <code>useEffect</code> fetching, debounced search, offset vs cursor
          pagination.
        </li>
        <li>
          <strong>
            <Link to="/react-query">React Query</Link>
          </strong>{' '}
          — the same data with caching, dedup, background revalidation and optimistic updates.
        </li>
        <li>
          <strong>
            <Link to="/zustand">Zustand</Link>
          </strong>{' '}
          — the same data again, with selector-based subscriptions. Live render counters show the difference.
        </li>
        <li>
          <strong>
            <Link to="/demo">Query demos</Link>
          </strong>{' '}
          — COLLSCAN vs IXSCAN, N+1 vs $lookup, <code>.explain(&quot;executionStats&quot;)</code>.
        </li>
        <li>
          <strong>
            <Link to="/admin">Admin</Link>
          </strong>{' '}
          — RBAC, cache stats, and worker threads vs blocking the event loop (admin only).
        </li>
      </ul>
    </div>
  );
}

// ============================================================
// 🧠 CONCEPT: Suspense — a declarative loading boundary
// WHY IT MATTERS (interview angle): Suspense lets a CHILD say "I'm not
//   ready" and an ANCESTOR decide what to show meanwhile. Before it, every
//   component managed its own `isLoading` flag and rendered its own
//   spinner, which is why apps ended up with five spinners appearing at
//   different times.
//   ⚠️ WHERE you put the boundary is a UX decision. One boundary around
//   the whole app = the entire page is replaced by one spinner. A
//   boundary per region = the rest of the UI stays interactive while one
//   part loads. Here the Navbar sits OUTSIDE Suspense on purpose, so
//   navigation remains usable while a route chunk downloads.
//   (React 18 also uses Suspense for data fetching with a compatible
//   library — React Query supports it via the `suspense` option.)
// ============================================================
function PageFallback() {
  return (
    <div className="route-loading">
      <p>Loading page…</p>
      <small>This chunk is being downloaded right now — check the Network tab</small>
    </div>
  );
}

export default function App() {
  return (
    // ============================================================
    // 🧠 CONCEPT: Provider ORDER matters
    // WHY IT MATTERS (interview angle): a provider can only read context
    //   from providers ABOVE it. TaskProvider's fetch calls depend on the
    //   axios interceptor being set up by AuthProvider, so AuthProvider
    //   must be the outer one. The ErrorBoundary wraps everything, because
    //   a crash inside a provider must still be caught.
    //   This is also where "provider hell" comes from — five nested
    //   providers is common, and it is one of Zustand's selling points
    //   that it needs none.
    // ============================================================
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <TaskProvider>
              <Navbar />

              <main>
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <Routes>
                      <Route path="/" element={<HomePage />} />

                      {/* PUBLIC — redirect away if already logged in */}
                      <Route
                        path="/login"
                        element={
                          <PublicRoute>
                            <LoginPage />
                          </PublicRoute>
                        }
                      />
                      <Route
                        path="/register"
                        element={
                          <PublicRoute>
                            <RegisterPage />
                          </PublicRoute>
                        }
                      />

                      {/* PROTECTED — the wrapper pattern */}
                      <Route
                        path="/tasks"
                        element={
                          <ProtectedRoute>
                            <TasksPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/react-query"
                        element={
                          <ProtectedRoute>
                            <ReactQueryPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/zustand"
                        element={
                          <ProtectedRoute>
                            <ZustandPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/demo"
                        element={
                          <ProtectedRoute>
                            <QueryDemoPage />
                          </ProtectedRoute>
                        }
                      />

                      {/* PROTECTED + ROLE-GATED */}
                      <Route
                        path="/admin"
                        element={
                          <ProtectedRoute requireRole="admin">
                            <AdminPage />
                          </ProtectedRoute>
                        }
                      />

                      {/* ============================================================
                          🧠 CONCEPT: The catch-all route
                          WHY IT MATTERS (interview angle): `path="*"` matches
                            anything unmatched above. Without it, a typo'd URL
                            renders NOTHING — a blank page with no explanation,
                            which users report as "the site is broken". It is the
                            client-side equivalent of the server's
                            notFoundHandler in middleware/errorHandler.js.
                          ============================================================ */}
                      <Route path="/404" element={<NotFound />} />
                      <Route path="*" element={<Navigate to="/404" replace />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </main>
            </TaskProvider>
          </QueryClientProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function NotFound() {
  return (
    <div className="page">
      <h1>404</h1>
      <p>
        No route matched. <Link to="/">Go home</Link>
      </p>
    </div>
  );
}
