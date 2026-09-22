# Documentation index

One Markdown file per source file and per folder, mirroring the project tree. Each file doc lists what the file does, every 🧠 CONCEPT block it contains, its public API, and the interview questions it answers.

**How to use this:** pick a topic from the tables below, read the doc for orientation, then read the actual source file — the source is where the detailed explanations live. These docs are the map; the code is the territory.

- Project overview and setup → [`../README.md`](../README.md)
- Original spec → [`../MERN_Interview_Boilerplate_Spec.md`](../MERN_Interview_Boilerplate_Spec.md)

---

## Tree

```
docs/
├── README.md                     ← you are here
├── gitignore.md
├── package.json.md
├── docker-compose.yml.md
├── server/
│   ├── README.md                 ← backend overview + request lifecycle
│   ├── app.js.md   server.js.md   cluster.js.md   seed.js.md
│   ├── package.json.md  jest.config.js.md  env.example.md
│   ├── Dockerfile.md  dockerignore.md
│   ├── config/       ← env, db, redis
│   ├── models/       ← User, Task, RefreshToken
│   ├── controllers/  ← auth, task, queryDemo, admin
│   ├── routes/       ← index, auth, task, demo, admin
│   ├── middleware/   ← auth, errorHandler, rateLimiter, validate, requestLogger, upload
│   ├── utils/        ← tokens, cache, activityLogger, asyncHandler, ApiError, logger, 3 demos
│   ├── jobs/         ← cleanupJob
│   ├── workers/      ← reportWorker
│   ├── tests/        ← setup + 4 suites
│   └── uploads/
└── client/
    ├── README.md                 ← frontend overview + data-flow
    ├── package.json.md  vite.config.js.md  index.html.md  env.example.md
    ├── Dockerfile.md  dockerignore.md
    └── src/
        ├── README.md  main.jsx.md  App.jsx.md  styles.css.md
        ├── api/        ← axiosClient
        ├── context/    ← AuthContext, TaskContext
        ├── store/      ← taskStore (Zustand)
        ├── hooks/      ← useAuth, useFetch, useDebounce
        ├── components/ ← ErrorBoundary, TaskForm, TaskList, Navbar
        ├── pages/      ← 7 pages
        ├── routes/     ← ProtectedRoute
        └── test/       ← setup + TaskForm.test
```

---

## Root

| File | Doc | What it is |
|---|---|---|
| `.gitignore` | [gitignore.md](./gitignore.md) | Keeping secrets and build output out of git |
| `package.json` | [package.json.md](./package.json.md) | Workspace scripts (`install:all`, `dev:*`, `seed`, `test`) |
| `docker-compose.yml` | [docker-compose.yml.md](./docker-compose.yml.md) | Mongo + Redis + API + client, one command |

---

## Backend — [`server/`](./server/README.md)

### Entry points & config

| File | Doc | Headline concept |
|---|---|---|
| `app.js` | [app.js.md](./server/app.js.md) | **Middleware order** · CJS vs ESM · CORS · helmet · compression |
| `server.js` | [server.js.md](./server/server.js.md) | app/server split · graceful shutdown · WebSockets vs polling |
| `cluster.js` | [cluster.js.md](./server/cluster.js.md) | **Why Node is single-threaded** and how to use 16 cores |
| `seed.js` | [seed.js.md](./server/seed.js.md) | Bulk inserts · why perf bugs don't appear in dev |
| `config/env.js` | [env.js.md](./server/config/env.js.md) | Fail-fast config · separate JWT secrets |
| `config/db.js` | [db.js.md](./server/config/db.js.md) | **Connection pooling** · lifecycle events |
| `config/redis.js` | [redis.js.md](./server/config/redis.js.md) | Fail-open caching · why a Map isn't Redis |

### Data layer — [`models/`](./server/models/README.md)

| File | Doc | Headline concept |
|---|---|---|
| `User.js` | [User.js.md](./server/models/User.js.md) | `pre('save')` hashing · `select:false` · `unique` is an index |
| `Task.js` | [Task.js.md](./server/models/Task.js.md) | **Compound indexes & the ESR rule** · when an index hurts |
| `RefreshToken.js` | [RefreshToken.js.md](./server/models/RefreshToken.js.md) | **Rotation & reuse detection** · TTL indexes |

### Business logic — [`controllers/`](./server/controllers/README.md)

| File | Doc | Headline concept |
|---|---|---|
| `authController.js` | [authController.js.md](./server/controllers/authController.js.md) | **The full JWT flow** · user enumeration · timing attacks |
| `taskController.js` | [taskController.js.md](./server/controllers/taskController.js.md) | **Streams & backpressure** · offset vs cursor · aggregation |
| `queryDemoController.js` | [queryDemoController.js.md](./server/controllers/queryDemoController.js.md) | **Slow vs fast** · N+1 · `.explain()` · `populate()` vs `$lookup` |
| `adminController.js` | [adminController.js.md](./server/controllers/adminController.js.md) | **Worker threads vs child processes vs cluster** |

### HTTP layer — [`routes/`](./server/routes/README.md)

| File | Doc | Headline concept |
|---|---|---|
| `index.js` | [index.js.md](./server/routes/index.js.md) | **Liveness vs readiness** · API versioning |
| `authRoutes.js` | [authRoutes.js.md](./server/routes/authRoutes.js.md) | Middleware chain order · why `/refresh` is public |
| `taskRoutes.js` | [taskRoutes.js.md](./server/routes/taskRoutes.js.md) | **Route order** · ownership middleware · multer placement |
| `demoRoutes.js` | [demoRoutes.js.md](./server/routes/demoRoutes.js.md) | The six performance demo endpoints |
| `adminRoutes.js` | [adminRoutes.js.md](./server/routes/adminRoutes.js.md) | Stacking AuthN then AuthZ |

### Cross-cutting — [`middleware/`](./server/middleware/README.md)

| File | Doc | Headline concept |
|---|---|---|
| `auth.js` | [auth.js.md](./server/middleware/auth.js.md) | ⭐ **AuthN vs AuthZ · IDOR · RBAC** |
| `errorHandler.js` | [errorHandler.js.md](./server/middleware/errorHandler.js.md) | **The 4-arg signature** · operational vs programmer errors |
| `rateLimiter.js` | [rateLimiter.js.md](./server/middleware/rateLimiter.js.md) | Window algorithms · why in-memory breaks at scale |
| `validate.js` | [validate.js.md](./server/middleware/validate.js.md) | **NoSQL injection · mass assignment · escape on output** |
| `requestLogger.js` | [requestLogger.js.md](./server/middleware/requestLogger.js.md) | Execution order · correlation IDs · monotonic clocks |
| `upload.js` | [upload.js.md](./server/middleware/upload.js.md) | **Path traversal** · MIME is a claim, not a fact |

### Helpers — [`utils/`](./server/utils/README.md)

| File | Doc | Headline concept |
|---|---|---|
| `tokens.js` | [tokens.js.md](./server/utils/tokens.js.md) | ⭐ **JWT anatomy · verify vs decode · XSS vs CSRF storage** |
| `cache.js` | [cache.js.md](./server/utils/cache.js.md) | **Cache-aside** · invalidation · thundering herd |
| `activityLogger.js` | [activityLogger.js.md](./server/utils/activityLogger.js.md) | **EventEmitter vs a message queue** |
| `asyncHandler.js` | [asyncHandler.js.md](./server/utils/asyncHandler.js.md) | Why an async throw hangs the request |
| `ApiError.js` | [ApiError.js.md](./server/utils/ApiError.js.md) | Operational vs programmer errors · 401 vs 403 |
| `logger.js` | [logger.js.md](./server/utils/logger.js.md) | Structured logging · why not `console.log` |
| `eventLoopDemo.js` | [eventLoopDemo.js.md](./server/utils/eventLoopDemo.js.md) | ▶ **Runnable** — event loop phases, thread pool |
| `bufferDemo.js` | [bufferDemo.js.md](./server/utils/bufferDemo.js.md) | ▶ **Runnable** — buffers, encodings, off-heap memory |
| `callbackDemo.js` | [callbackDemo.js.md](./server/utils/callbackDemo.js.md) | ▶ **Runnable** — callbacks → promises → async/await |

### Background work & tests

| File | Doc | Headline concept |
|---|---|---|
| `jobs/cleanupJob.js` | [cleanupJob.js.md](./server/jobs/cleanupJob.js.md) | **Distributed locks** · cron fires N times at scale |
| `workers/reportWorker.js` | [reportWorker.js.md](./server/workers/reportWorker.js.md) | Worker threads · structured clone |
| `tests/setup.js` | [setup.js.md](./server/tests/setup.js.md) | In-memory MongoDB · test isolation |
| `tests/unit.tokens.test.js` | [unit.tokens.test.js.md](./server/tests/unit.tokens.test.js.md) | Testing tamper rejection · the `alg:none` attack |
| `tests/integration.auth.test.js` | [integration.auth.test.js.md](./server/tests/integration.auth.test.js.md) | Supertest · **testing reuse detection** |
| `tests/integration.tasks.test.js` | [integration.tasks.test.js.md](./server/tests/integration.tasks.test.js.md) | ⭐ **The IDOR test** · RBAC · pagination stability |
| `tests/mocking.test.js` | [mocking.test.js.md](./server/tests/mocking.test.js.md) | When to mock · fake timers · chainable queries |

---

## Frontend — [`client/`](./client/README.md)

| File | Doc | Headline concept |
|---|---|---|
| `src/main.jsx` | [main.jsx.md](./client/src/main.jsx.md) | **StrictMode double-invoke** · `createRoot` |
| `src/App.jsx` | [App.jsx.md](./client/src/App.jsx.md) | **Code splitting** · Suspense · provider order |
| `src/api/axiosClient.js` | [axiosClient.js.md](./client/src/api/axiosClient.js.md) | ⭐ **Single-flight refresh** · interceptors |
| `src/context/AuthContext.jsx` | [AuthContext.jsx.md](./client/src/context/AuthContext.jsx.md) | **Context & prop drilling** · its re-render limit |
| `src/context/TaskContext.jsx` | [TaskContext.jsx.md](./client/src/context/TaskContext.jsx.md) | `useReducer` · optimistic updates |
| `src/store/taskStore.js` | [taskStore.js.md](./client/src/store/taskStore.js.md) | **Context vs Redux vs Zustand** · selectors |
| `src/hooks/useFetch.js` | [useFetch.js.md](./client/src/hooks/useFetch.js.md) | ⭐ **The fetch race condition** · AbortController |
| `src/hooks/useDebounce.js` | [useDebounce.js.md](./client/src/hooks/useDebounce.js.md) | **useEffect cleanup** · debounce vs throttle |
| `src/hooks/useAuth.js` | [useAuth.js.md](./client/src/hooks/useAuth.js.md) | Re-export for a stable import path |
| `src/components/ErrorBoundary.jsx` | [ErrorBoundary.jsx.md](./client/src/components/ErrorBoundary.jsx.md) | **Why boundaries must be classes** |
| `src/components/TaskForm.jsx` | [TaskForm.jsx.md](./client/src/components/TaskForm.jsx.md) | **Controlled vs uncontrolled** · two uses of `useRef` |
| `src/components/TaskList.jsx` | [TaskList.jsx.md](./client/src/components/TaskList.jsx.md) | **`useMemo`/`useCallback`** · why index keys are a bug |
| `src/components/Navbar.jsx` | [Navbar.jsx.md](./client/src/components/Navbar.jsx.md) | Event-listener cleanup |
| `src/routes/ProtectedRoute.jsx` | [ProtectedRoute.jsx.md](./client/src/routes/ProtectedRoute.jsx.md) | **Route guards are UX, not security** |
| `src/pages/*` | [pages/](./client/src/pages/README.md) | Login, Register, Tasks, ReactQuery, Zustand, QueryDemo, Admin |
| `src/test/*` | [test/](./client/src/test/README.md) | RTL query priority · `renderHook` |
| `vite.config.js` | [vite.config.js.md](./client/vite.config.js.md) | Vite vs CRA · dev proxy · vendor chunking |
| `index.html` | [index.html.md](./client/index.html.md) | What an SPA actually is · SEO trade-offs |

---

## Cross-cutting themes

Several ideas recur deliberately across many files. Reading them as a thread is more useful than file by file.

### 1. Per-process state breaks horizontal scaling

The single most repeated lesson. Each of these is the *same bug* in a different costume:

[`config/redis.js`](./server/config/redis.js.md) (cache) → [`middleware/rateLimiter.js`](./server/middleware/rateLimiter.js.md) (counters) → [`utils/activityLogger.js`](./server/utils/activityLogger.js.md) (events) → [`server.js`](./server/server.js.md) (sockets) → [`jobs/cleanupJob.js`](./server/jobs/cleanupJob.js.md) (cron) → [`middleware/upload.js`](./server/middleware/upload.js.md) (files) → all tied together in [`cluster.js`](./server/cluster.js.md).

### 2. The client is never the security boundary

[`routes/ProtectedRoute.jsx`](./client/src/routes/ProtectedRoute.jsx.md) and [`pages/RegisterPage.jsx`](./client/src/pages/RegisterPage.jsx.md) are UX; [`middleware/auth.js`](./server/middleware/auth.js.md) and [`middleware/validate.js`](./server/middleware/validate.js.md) are the actual enforcement.

### 3. Server state is not client state

[`hooks/useFetch.js`](./client/src/hooks/useFetch.js.md) (hand-rolled, with the race condition) → [`context/TaskContext.jsx`](./client/src/context/TaskContext.jsx.md) (Context + reducer) → [`store/taskStore.js`](./client/src/store/taskStore.js.md) (Zustand + selectors) → [`pages/ReactQueryPage.jsx`](./client/src/pages/ReactQueryPage.jsx.md) (the right tool).

### 4. Latency × count beats query time

[`controllers/queryDemoController.js`](./server/controllers/queryDemoController.js.md) and [`models/Task.js`](./server/models/Task.js.md) — N+1 and indexing matter more than any Node micro-optimisation.

### 5. Both sides of every trade-off

Nothing here is presented as a free win. Indexes have a [write cost](./server/models/Task.js.md); caching has [invalidation](./server/utils/cache.js.md); memoisation has [overhead](./client/src/components/TaskList.jsx.md); compression [costs CPU](./server/app.js.md); streaming [complicates errors](./server/controllers/taskController.js.md).
