# `server/` — the Express + Mongoose backend

> CommonJS, layered as routes → middleware → controllers → models. 42 JS files, ~250 concept blocks.

## Layering, and why it matters

```
HTTP request
    │
    ▼
app.js ──────────── app-level middleware (order matters, read top to bottom)
    │                requestId → logger → helmet → cors → compression
    │                → body parsing → sanitize → rate limit
    ▼
routes/ ─────────── WIRING ONLY. method + path + middleware + handler.
    │                No business logic ever.
    ▼
middleware/ ─────── auth (AuthN → AuthZ), validation
    │
    ▼
controllers/ ────── business logic. Thin on purpose (it's a task manager).
    │
    ▼
models/ ─────────── schema, validation, hooks, indexes. "Fat model."
    │
    ▼
MongoDB
```

Each layer should be swappable. The rule that keeps it honest: **a controller never touches `req.headers`, and a model never touches `req` at all.**

## Request lifecycle, concretely

A `PATCH /api/tasks/:id` request passes through, in order:

| Step | File | What it does |
|---|---|---|
| 1 | [`middleware/requestLogger.js`](./middleware/requestLogger.js.md) | Assign a correlation ID, start a monotonic timer |
| 2 | [`app.js`](./app.js.md) | helmet, CORS, compression, `express.json()`, cookie parsing |
| 3 | [`middleware/validate.js`](./middleware/validate.js.md) | Strip `$`-prefixed and `__proto__` keys |
| 4 | [`middleware/rateLimiter.js`](./middleware/rateLimiter.js.md) | Global throttle |
| 5 | [`routes/taskRoutes.js`](./routes/taskRoutes.js.md) | Match the route |
| 6 | [`middleware/auth.js`](./middleware/auth.js.md) | `verifyAccessToken` — **who are you?** (401 on failure) |
| 7 | [`middleware/validate.js`](./middleware/validate.js.md) | Validate body and params (400 on failure) |
| 8 | [`middleware/auth.js`](./middleware/auth.js.md) | `requireOwnership` — **is this yours?** (404 on failure) |
| 9 | [`controllers/taskController.js`](./controllers/taskController.js.md) | Apply the patch, `.save()`, invalidate cache, emit event |
| 10 | [`middleware/errorHandler.js`](./middleware/errorHandler.js.md) | Only if anything threw — translate and respond |
| 11 | [`middleware/requestLogger.js`](./middleware/requestLogger.js.md) | On `res.finish`, log status + duration |

Steps 6 and 8 being **separate** is the whole AuthN/AuthZ lesson. Step 6 alone is the [IDOR vulnerability](./middleware/auth.js.md).

## Folders

| Folder | Doc | Contents |
|---|---|---|
| `config/` | [→](./config/README.md) | Environment validation, DB connection + pooling, Redis with fallback |
| `models/` | [→](./models/README.md) | User, Task, RefreshToken — schemas, hooks, indexes |
| `controllers/` | [→](./controllers/README.md) | auth, task, queryDemo, admin |
| `routes/` | [→](./routes/README.md) | Five routers, wiring only |
| `middleware/` | [→](./middleware/README.md) | auth, errorHandler, rateLimiter, validate, requestLogger, upload |
| `utils/` | [→](./utils/README.md) | tokens, cache, activityLogger, asyncHandler, ApiError, logger + 3 runnable demos |
| `jobs/` | [→](./jobs/README.md) | Cron with a distributed lock |
| `workers/` | [→](./workers/README.md) | Worker-thread report generator |
| `tests/` | [→](./tests/README.md) | 80 tests: unit, integration, mocking |
| `uploads/` | [→](./uploads/README.md) | Multer destination (gitignored) |

## Root files

| File | Doc | Purpose |
|---|---|---|
| `app.js` | [→](./app.js.md) | Builds the Express app. **Never calls `listen()`.** |
| `server.js` | [→](./server.js.md) | Owns the process: DB connect, port bind, Socket.io, shutdown |
| `cluster.js` | [→](./cluster.js.md) | Alternative entry point — forks a worker per core |
| `seed.js` | [→](./seed.js.md) | Generates 10k–50k tasks for the perf demos |
| `jest.config.js` | [→](./jest.config.js.md) | Test config, with notes on `--runInBand` |
| `package.json` | [→](./package.json.md) | Dependencies and scripts |
| `.env.example` | [→](./env.example.md) | Every required variable, no values |
| `Dockerfile` | [→](./Dockerfile.md) | Multi-stage: deps → dev → runtime |
| `.dockerignore` | [→](./dockerignore.md) | Build speed *and* a security control |

## API surface

| Method | Path | Auth | Doc |
|---|---|---|---|
| `GET` | `/api/health` | — | [routes/index](./routes/index.js.md) |
| `GET` | `/api/health/ready` | — | [routes/index](./routes/index.js.md) |
| `POST` | `/api/auth/register` | — | [authController](./controllers/authController.js.md) |
| `POST` | `/api/auth/login` | — | " |
| `POST` | `/api/auth/refresh` | cookie | " |
| `POST` | `/api/auth/logout` | — | " |
| `GET` | `/api/auth/me` | Bearer | " |
| `GET` | `/api/auth/sessions` | Bearer | " |
| `POST` | `/api/auth/logout-all` | Bearer | " |
| `PATCH` | `/api/auth/password` | Bearer | " |
| `GET` | `/api/tasks` | Bearer | [taskController](./controllers/taskController.js.md) |
| `POST` | `/api/tasks` | Bearer | " |
| `GET` | `/api/tasks/stats` | Bearer | " (aggregation) |
| `GET` | `/api/tasks/export` | Bearer | " (streaming CSV) |
| `GET/PATCH/DELETE` | `/api/tasks/:id` | Bearer + **owner** | " |
| `POST` | `/api/tasks/:id/attachment` | Bearer + owner | " |
| `GET` | `/api/demo/*` (6 routes) | Bearer | [queryDemoController](./controllers/queryDemoController.js.md) |
| `GET/PATCH/POST` | `/api/admin/*` | Bearer + **admin** | [adminController](./controllers/adminController.js.md) |

## Why CommonJS here

Deliberate, so the repo shows both module systems ([`client/`](../client/README.md) uses ESM). The reasoning: there's no bundler on the server, so tree-shaking — ESM's main advantage — is irrelevant; most existing Node codebases and interview questions are CJS; and `require()` inside a function is occasionally useful for lazy loading. The full comparison table is at the top of [`app.js`](./app.js.md).

## Conventions

- **Every async route handler is wrapped in [`asyncHandler`](./utils/asyncHandler.js.md).** Express 4 does not catch promise rejections; without the wrapper the request hangs.
- **Errors are thrown, never returned.** Controllers `throw ApiError.notFound(...)`; one [central handler](./middleware/errorHandler.js.md) shapes every response.
- **Ownership is enforced in the query, not after the fetch.** `findOne({ _id, owner })`, never `findById` + `if`.
- **`owner`/`role` never come from the request body.** Always from the verified token.
- **`.lean()` on read-only queries, `.save()` when hooks must run.**
