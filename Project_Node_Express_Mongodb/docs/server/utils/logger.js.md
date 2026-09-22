# `server/utils/logger.js`

> A ~60-line level-filtered logger with Winston's shape. Zero dependencies, so the concept is readable rather than hidden behind a library.

**Lines:** 55 · **Concept blocks:** 2 · **Dependencies:** none

## ⭐ Why not `console.log`?

Three real reasons:

| # | Problem |
|---|---|
| 1 | **You cannot filter by level in production.** Debug logging you can't turn off is either noise or cost (log ingestion is billed per GB). |
| 2 | ⚠️ **`console.log` is SYNCHRONOUS** when writing to a file or pipe on some platforms — so it **blocks the event loop**. A chatty logger in a hot path is a real throughput problem. |
| 3 | **Log aggregators** (Datadog, ELK, CloudWatch) want machine-parsable **JSON**, not free-form strings. A log line is only useful if you can query it. |

## API

```js
logger.error(...args)
logger.warn(...args)
logger.info(...args)
logger.debug(...args)
logger.level          // the active level name
```

Same surface as Winston, so **swapping in Winston or Pino means replacing this one file** — that decoupling is itself part of the point.

## Levels

```js
{ error: 0, warn: 1, info: 2, debug: 3 }
```

A message is emitted only if its level is `<=` the configured one, so `LOG_LEVEL=warn` shows errors and warnings but drops info and debug. Defaults: `debug` in development, **`error` in tests** (to keep test output readable).

## Two output formats

| Environment | Format |
|---|---|
| Development | Colourised, human-readable: `[timestamp] LEVEL  message` |
| **Production** | **One JSON object per line** (ndjson): `{"timestamp","level","message"}` |

⭐ **Why JSON in production:** `{"level":"error","reqId":"abc"}` can be indexed and filtered; `ERROR something broke` cannot. Every log shipper understands ndjson out of the box.

Arguments are normalised before joining: an `Error` becomes its `.stack`, an object becomes JSON. So `logger.error('failed', err)` gives you the stack without the caller thinking about it.

## ⚠️ The dependency exception

This is the **only** module that reads `process.env` directly instead of importing [`config/env.js`](../config/env.js.md).

**Why:** `env.js` imports `logger.js` to report configuration problems. If `logger.js` imported `env.js`, you'd have a **circular require** — and in CommonJS that doesn't error, it silently returns a **partially-populated** module. You'd get `logger.info is not a function` at boot with a stack pointing somewhere unhelpful. **Breaking the cycle at the logger is the fix.**

Worth knowing generally: circular imports in CJS resolve to a *partial* object rather than throwing, so the failure surfaces far from the cause. ESM handles it differently (hoisted bindings, throws on TDZ access) — see the comparison in [`app.js`](../app.js.md).

## How levels are used across the app

| Level | Used for |
|---|---|
| `error` | 5xx responses, fatal process events, 🚨 [refresh-token reuse detection](../controllers/authController.js.md) |
| `warn` | 4xx responses, rate-limit hits, [slow requests](../middleware/requestLogger.js.md), [admin overrides](../middleware/auth.js.md), Redis fallback |
| `info` | 2xx responses, boot messages, activity events |
| `debug` | Cache hits/misses, Mongoose queries, token rotation |

⭐ Note 4xx is `warn`, not `error`. **If every 401 paged you, you'd mute the alert within a day** — keeping error-rate alerts meaningful means only genuine server faults are `error`.

## What a production logger adds

This is deliberately minimal. Winston/Pino give you: transports (file, HTTP, syslog), log rotation, child loggers with bound context (`logger.child({ reqId })`), sampling, redaction of sensitive fields, and **asynchronous non-blocking writes**. Pino is notably fast precisely because it does JSON serialisation efficiently and writes async.

## Interview questions

- **"Why not `console.log`?"** → No level filtering, potentially synchronous (blocks the loop), not machine-parsable.
- **"What does structured logging give you?"** → Queryable fields. You can filter by request id, user, status — impossible with string interpolation.
- **"Should a 404 be logged as an error?"** → No — it's usually the client's fault. Reserve `error` for server faults or your alerting becomes noise.
- **"How do you correlate logs for one request?"** → A [correlation id](../middleware/requestLogger.js.md) on every line, ideally via a child logger so you can't forget it.
- **"You have a circular require. What does Node do?"** → Returns a partial module silently.

## Related

- [`config/env.js`](../config/env.js.md) — the circular-dependency partner
- [`middleware/requestLogger.js`](../middleware/requestLogger.js.md) — the main consumer
- [`middleware/errorHandler.js`](../middleware/errorHandler.js.md) — the log/response split
