# `server/middleware/`

> Cross-cutting concerns. Six files, ~1,500 lines, and the densest security content in the project.

## Files

| File | Doc | Lines | Blocks | Headline |
|---|---|---|---|---|
| `auth.js` | [→](./auth.js.md) | 364 | 13 | ⭐ **AuthN vs AuthZ · IDOR · RBAC** |
| `validate.js` | [→](./validate.js.md) | 377 | 10 | **NoSQL injection · mass assignment · escape on output** |
| `errorHandler.js` | [→](./errorHandler.js.md) | 266 | 11 | **The 4-arg signature** · graceful shutdown |
| `rateLimiter.js` | [→](./rateLimiter.js.md) | 199 | 8 | Window algorithms · in-memory breaks at scale |
| `requestLogger.js` | [→](./requestLogger.js.md) | 172 | 7 | Execution order · correlation IDs |
| `upload.js` | [→](./upload.js.md) | 124 | 5 | **Path traversal** · MIME is a claim |

If you read two files in this project, read [`auth.js`](./auth.js.md) and [`validate.js`](./validate.js.md).

## The middleware contract

Each receives `(req, res, next)` and must do **exactly one** of three things:

| Action | Effect |
|---|---|
| `next()` | Pass control to the next middleware |
| Send a response | **Ends** the chain |
| `next(err)` | **Skip** to the error middleware |

⚠️ **Doing neither is the classic bug** — forget `next()` and the request **hangs**. No error, no log, no response; the client waits until it times out. When someone says "my Express route does nothing", a missing `next()` is the first thing to check.

⚠️ **Doing two** (`next()` *and* responding) gives `ERR_HTTP_HEADERS_SENT`. Hence `return next()` / `return res.json()`.

## Execution order

```
requestId ──► requestLogger ──► [helmet, cors, compression]
                                          │
              express.json + cookieParser ┤  ← req.body now exists
                                          │
                        sanitizeMongo ─────┤  ← strip $ and __proto__
                                          │
                        globalLimiter ─────┤
                                          ▼
                                    ROUTE MATCH
                                          │
                     verifyAccessToken ───┤  ← AuthN (401)
                                          │
                      *Validation chain ──┤  ← 400
                                          │
      requireRole / requireOwnership ─────┤  ← AuthZ (403 / 404)
                                          ▼
                                     CONTROLLER
                                          │
                        notFoundHandler ──┤  ← only if nothing matched
                          errorHandler ────┘  ← 4 args, registered LAST
```

⭐ **AuthN (401) and AuthZ (403/404) are separate steps.** That separation *is* the lesson — step 6 alone is the [IDOR vulnerability](./auth.js.md).

## Factory pattern

Three of these export **factories** — functions returning configured middleware:

```js
requireRole('admin')                    // → (req, res, next) => ...
requireOwnership(Task, { ownerField })  // → (req, res, next) => ...
orderDemo('label')                      // → (req, res, next) => ...
```

A closure captures the configuration, so one implementation serves every call site. This is how you get a single, testable ownership check instead of the same `if` copied into nine controllers.

## Security responsibilities

| Threat | Defended in |
|---|---|
| Unauthenticated access | [`auth.js`](./auth.js.md) |
| **IDOR / broken access control** | [`auth.js`](./auth.js.md) `requireOwnership` |
| Privilege escalation via role | [`auth.js`](./auth.js.md) + [`validate.js`](./validate.js.md) |
| **NoSQL injection** | [`validate.js`](./validate.js.md) `sanitizeMongo` + type validation |
| **Mass assignment** | [`validate.js`](./validate.js.md) + controller allowlists |
| Prototype pollution | [`validate.js`](./validate.js.md) |
| Brute force / credential stuffing | [`rateLimiter.js`](./rateLimiter.js.md) |
| DoS via unbounded input | [`validate.js`](./validate.js.md) + [`upload.js`](./upload.js.md) limits |
| **Path traversal** | [`upload.js`](./upload.js.md) |
| Information leakage via errors | [`errorHandler.js`](./errorHandler.js.md) |

## Interview questions

- **"What are the three things a middleware must do?"** → `next()`, respond, or `next(err)`. Then name both failure modes: hang, and headers-already-sent.
- **"How does Express know something is an error handler?"** → `fn.length === 4`. See [`errorHandler.js`](./errorHandler.js.md).
- **"Why a middleware factory?"** → One implementation, many configurations, closed over via a closure. Testable in isolation.

## Related

- [`server/README.md`](../README.md) — the full lifecycle
- [`app.js`](../app.js.md) — where app-level middleware is registered, in order
- [`routes/`](../routes/README.md) — where router- and route-level middleware is attached
