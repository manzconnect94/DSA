# `server/middleware/requestLogger.js`

> Correlation IDs and request logging. Also the file that documents the middleware execution model itself.

**Lines:** 172 · **Concept blocks:** 7

## Exports

| Export | Purpose |
|---|---|
| `requestId` | Assigns/propagates `req.id`, echoes it as `X-Request-Id` |
| `requestLogger` | Logs method, path, status, duration, user |
| `orderDemo(label)` | A teaching middleware that makes execution order visible |

Both are registered **first** in [`app.js`](../app.js.md), so even a 429 from the rate limiter is traceable.

## ⭐ The middleware execution model

Express is, at its core, a **linked list of functions**. Each receives `(req, res, next)` and must do exactly one of three things:

| Action | Effect |
|---|---|
| `next()` | Pass control to the **next** middleware |
| Send a response | **Ends** the chain |
| `next(err)` | **Skip** to the error middleware |

⚠️ **Doing neither is the classic bug:** forget `next()` and the request **hangs**. No error, no log, no response — the client waits until it times out. When someone says "my Express route does nothing", check for a missing `next()` first.

⚠️ **Calling `next()` *and* responding** is the other one: control continues down the chain, a later handler tries to respond too, and you get `ERR_HTTP_HEADERS_SENT`. Hence `return next()` / `return res.json()`.

**Order is defined by registration order** — which is why helmet must come before your routes, `express.json()` before anything reading `req.body`, and the error handler last.

## ⭐ Correlation IDs

In a distributed system one user action can touch five services and produce fifty log lines across five files. **Without a shared id you cannot reconstruct what happened.**

Generate an id at the edge, attach it to every log line, return it in a response header, and **propagate** it to downstream services — this is what W3C `traceparent` and OpenTelemetry standardise. When a user reports "it broke at 14:32", you ask for the request id from the error response and find every related line instantly.

Note it **accepts an inbound `X-Request-Id`** if a proxy already set one, so an existing trace isn't broken.

## Monotonic clocks

| | Resolution | Can go backwards? |
|---|---|---|
| `Date.now()` | milliseconds | ⚠️ **Yes** — NTP correction, DST, manual clock change. **Can yield a negative duration.** |
| `process.hrtime.bigint()` | nanoseconds | No — monotonic, only ever increases |

**Always use a monotonic clock to measure elapsed time; use the wall clock only for timestamps.**

## Hooking `res.on('finish')`

You want to log the status code, but it isn't known when the middleware runs — it's set later by a handler further down. The old approach was **monkey-patching `res.end`**; the clean one is listening for the response's `'finish'` event, which fires once the last byte is handed to the OS.

⭐ **Note the sibling event:** `'close'` fires if the **client disconnects** before the response completes ("user hit stop"). Logging both lets you tell **"we were slow"** apart from **"they gave up"** — which matters, because abandoned requests still consume a DB connection until they finish. A `logged` flag prevents double-counting when both fire.

## Slow-request logging

A >500ms threshold log is **the cheapest possible performance monitoring**, and it costs nothing when things are healthy. It's how you discover the [N+1 query](../controllers/queryDemoController.js.md) nobody noticed.

The grown-up version is percentile latency — and you should know **why percentiles beat averages**: one 10-second request among a thousand 10ms ones barely moves the mean, but it's exactly the request a real user is staring at. p50/p95/p99, not the average.

## The three middleware scopes

| Scope | Example | Use for |
|---|---|---|
| **App** | `app.use(helmet())` | Cross-cutting: headers, parsing, CORS, logging, compression |
| **Router** | `router.use(verifyAccessToken)` | A whole resource sharing a requirement |
| **Route** | `router.delete('/:id', requireRole('admin'), h)` | Genuinely specific |

⚠️ **Security:** prefer router-level for auth. Per-route means the day someone adds an endpoint and forgets the middleware, it ships **public**. Router-level is secure **by default**.

⚠️ **Performance:** app-level runs on *every* request including health checks. Mounting something expensive app-level when three routes need it is real wasted CPU — which is why multer is per-route.

## `orderDemo` — the subtle part

Mounted only in development. It logs before and after `next()`, and the "after" line reveals something important:

```js
next();                        // control passes DOWN the chain...
logger.debug('next() returned');  // ...and THIS runs the moment next() RETURNS
```

⚠️ For an **async** handler, `next()` returns **long before the response is sent**. `next()` is not "await the rest of the chain". If you want to act after the response, you must use the `res` `'finish'` event — not code placed after `next()`. This trips people up when they try to add timing or cleanup logic inline.

## Interview questions

- **"What are the three things a middleware must do?"** → `next()`, respond, or `next(err)`. Then both failure modes.
- **"My route does nothing and the request hangs."** → Missing `next()`.
- **"How do you debug one request across five services?"** → Correlation ID generated at the edge and propagated; OpenTelemetry standardises it.
- **"Why not `Date.now()` for duration?"** → It's the wall clock; it can jump backwards. Use `process.hrtime`.
- **"How do you log the status code from a middleware that runs first?"** → Listen for `res.on('finish')`. Also handle `'close'` for client disconnects.
- **"Why p99 instead of the average?"** → The average hides the tail, and the tail is what users experience.

## Related

- [`app.js`](../app.js.md) — registration order
- [`utils/logger.js`](../utils/logger.js.md) — the logger this uses
- [`middleware/errorHandler.js`](./errorHandler.js.md) — consumes `req.id` for the response
- [`routes/`](../routes/README.md) — where router/route scopes are applied
