# `server/middleware/errorHandler.js`

> The central error boundary, plus process-level safety nets and graceful shutdown.

**Lines:** 266 · **Concept blocks:** 11

## ⭐ The 4-argument signature

A guaranteed Express question. Express distinguishes normal from error middleware **solely by the number of declared parameters** — it literally reads `fn.length`.

```js
(req, res, next)       → 3 args → NORMAL middleware
(err, req, res, next)  → 4 args → ERROR middleware
```

### Three consequences that catch people out

| Mistake | What happens |
|---|---|
| `(err, req, res)` — omitting unused `next` | `fn.length === 3`, so Express registers it as **normal** middleware. It never receives errors, `err` is actually the request object, and **your error handling silently does nothing.** |
| `(err, req, res, next = noop)` — default param | `fn.length === 3` too. Same silent break. Rest args likewise. |
| Registering it **before** the routes | Express walks the stack in registration order, so it never sees errors from them. **Must be last.** |

This is why `next` is declared-but-unused in the signature, with an eslint-disable comment — a very common sight in Express codebases, and now you know why.

### How an error gets here

- `next(err)` with **any** truthy argument → Express skips every remaining normal middleware and jumps to the first error handler
- A **synchronous** throw inside a handler → caught by Express automatically
- ⚠️ An **async rejection** → **NOT caught** in Express 4. That's the entire reason [`asyncHandler`](../utils/asyncHandler.js.md) exists.

## Exports

| Export | Type | Purpose |
|---|---|---|
| `notFoundHandler` | 3-arg middleware | Converts "nothing matched" into an error |
| `errorHandler` | **4-arg** middleware | Translates, logs and responds |
| `registerProcessHandlers(server)` | function | `uncaughtException`, `unhandledRejection`, `SIGTERM`, `SIGINT` |
| `translateError(err)` | pure function | Third-party error → `ApiError` |

## The 404 handler is NOT error middleware

A request matching no route isn't an "error" to Express — it just falls off the end of the stack and Express's default handler sends an **HTML** 404 page. For a JSON API you add a normal middleware at the very end (it only runs if nothing matched) and convert it to an error via `next(err)`.

## Error translation

Raw database errors must **never** reach the client: they're unreadable, and they **leak your internals** — collection names, index names, field structure.

| Input | Output |
|---|---|
| `mongoose.Error.ValidationError` | 400 + per-field details |
| `mongoose.Error.CastError` | 400 — reports the **field** but not the raw value (echoing unsanitised input enables reflected XSS) |
| **`err.code === 11000`** | **409 Conflict** |
| `TokenExpiredError` / `JsonWebTokenError` | 401 with distinct codes |
| `multer.MulterError` | **413** for `LIMIT_FILE_SIZE`, 400 otherwise |
| `SyntaxError` with a `body` property | 400 `MALFORMED_JSON` |
| Anything else | 500, `isOperational: false` |

### Three worth calling out

**⚠️ Duplicate key = 11000.** `unique: true` is an [index, not a validator](../models/User.js.md), so a duplicate surfaces as a raw `MongoServerError` — **not** a `ValidationError`. Handle only `ValidationError` and **every duplicate signup returns a 500**. A very common follow-up to "how do you enforce unique emails?"

**Multer errors are their own class.** Untranslated, uploading an oversized file returns a 500 — which looks like *your* server broke rather than the user breaking a rule. 413 is correct and actionable.

**Malformed JSON.** `express.json()` throws a `SyntaxError` with a `body` property. Without handling, a typo in a curl command returns a 500 with a stack trace.

## Operational vs programmer errors

| | Operational | Programmer |
|---|---|---|
| What | Expected failure in a correct program: bad input, 404, expired token, DB timeout | A **bug**: `undefined is not a function` |
| Message source | **You wrote it** — safe to expose | A library or the runtime — may contain file paths, queries, connection strings |
| Response | Real message | **Generic** "Internal server error" in production |
| Flag | `isOperational: true` | `false` |

`ApiError` sets that flag; this handler uses it to decide what to expose. See [`ApiError.js`](../utils/ApiError.js.md).

## Logging split

Everything to the log, the minimum to the client. Stack traces in an HTTP response expose file paths and library versions.

| Status | Level | Why |
|---|---|---|
| ≥500 | `error` | Full stack |
| 4xx | `warn` | Usually the client's fault. **If every 401 paged you, you'd mute the alert within a day.** |

The response carries a `requestId` — that's how you correlate a user's report with the full server-side log entry.

## ⚠️ Headers already sent

If an error occurs **after** you've begun streaming (the [CSV export](../controllers/taskController.js.md) is exactly this), the status and headers are already on the wire. Calling `res.status().json()` then throws `ERR_HTTP_HEADERS_SENT` — turning one error into two. The correct move is to delegate to Express's default handler, which **destroys the socket** so the client sees a truncated response rather than corrupt data.

## ⭐ Process-level safety nets

The error middleware only catches errors **inside a request**. Errors in a timer, an event listener or a background job have no `req`/`res` and bypass it entirely.

**The controversial part, and the answer they want:** after an `uncaughtException` you should **LOG AND EXIT**, not "keep the server alive". The exception unwound the stack from an arbitrary point, so locks may be held, transactions half-applied, and module state inconsistent. **The process is in an unknown state, and continuing means serving corrupt data.** Crash, and let your supervisor (pm2, systemd, Kubernetes) restart a clean process.

Note Node 15+ made **unhandled promise rejections fatal by default** — they used to be a warning. Code written pre-2020 that relied on that warning now crashes.

### SIGTERM and containers

Kubernetes/Docker send **SIGTERM** and wait (default 30s) before SIGKILL. Ignore it and **every in-flight request is killed on every deploy** — users see errors each time. Handling it is what makes zero-downtime deploys possible.

The drain sequence: `server.close()` (stop accepting, callback fires when existing connections finish) + a **10-second hard deadline** in case a connection hangs, with `.unref()` so that timer alone can't keep the process alive.

⚠️ This only works if the process receives the signal — see the [`dumb-init` / PID 1](../Dockerfile.md) note.

## Interview questions

- **"How does Express know a middleware is an error handler?"** → `fn.length === 4`. Then the killer detail: you can't omit `next` or use a default parameter.
- **"An async route throws. Why does the request hang?"** → Express 4 doesn't catch promise rejections, so `next(err)` is never called.
- **"Why does a duplicate email return 500?"** → Code 11000 isn't a `ValidationError`.
- **"Should you keep the process alive after an uncaught exception?"** → No. Unknown state. Log and exit.
- **"Kubernetes sends SIGTERM. What should happen?"** → Drain: stop accepting, finish in-flight, close resources, exit — with a timeout.
- **"An error occurs mid-stream. What status do you return?"** → You can't change it; headers are sent. Destroy the socket.

## Related

- [`utils/ApiError.js`](../utils/ApiError.js.md) — the `isOperational` flag
- [`utils/asyncHandler.js`](../utils/asyncHandler.js.md) — why it's needed at all
- [`server.js`](../server.js.md) — calls `registerProcessHandlers`
- [`Dockerfile`](../Dockerfile.md) — `dumb-init`, without which SIGTERM never arrives
- [`client/src/components/ErrorBoundary.jsx`](../../client/src/components/ErrorBoundary.jsx.md) — the client analogue
