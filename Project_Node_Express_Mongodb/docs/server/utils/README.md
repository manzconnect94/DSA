# `server/utils/`

> Shared helpers, plus three **runnable** teaching scripts that need no database.

## Application helpers

| File | Doc | Lines | Purpose |
|---|---|---|---|
| `tokens.js` | [→](./tokens.js.md) | 203 | ⭐ JWT signing/verifying, hashing, cookie options |
| `cache.js` | [→](./cache.js.md) | 164 | Cache-aside with TTL jitter and invalidation |
| `activityLogger.js` | [→](./activityLogger.js.md) | 174 | EventEmitter pub/sub |
| `asyncHandler.js` | [→](./asyncHandler.js.md) | 51 | The Express 4 promise wrapper |
| `ApiError.js` | [→](./ApiError.js.md) | 61 | Operational vs programmer errors |
| `logger.js` | [→](./logger.js.md) | 55 | Level-filtered structured logging |

## ▶ Runnable demos

These are **documentation you can execute**. No MongoDB, no Redis, no server — just `node`.

| File | Doc | Run | Teaches |
|---|---|---|---|
| `eventLoopDemo.js` | [→](./eventLoopDemo.js.md) | `npm run demo:eventloop` | Event loop phases, `nextTick` vs `setImmediate`, thread pool, blocking |
| `bufferDemo.js` | [→](./bufferDemo.js.md) | `npm run demo:buffer` | Buffers, encodings, magic numbers, off-heap memory, endianness |
| `callbackDemo.js` | [→](./callbackDemo.js.md) | `npm run demo:callback` | Callback hell → promises → async/await → `Promise.all` |

⭐ **Run `demo:eventloop` several times.** Experiment 1's output order **changes between runs**, and understanding why is the entire point — it's the deterministic-vs-non-deterministic half of the `setTimeout` vs `setImmediate` question that most candidates get wrong.

They're excluded from test coverage (`!utils/*Demo.js` in [`jest.config.js`](../jest.config.js.md)) because they're documentation, not app code.

## Why these are in `utils/`

Each is **stateless and dependency-light**, which is what makes them easy to test and reuse:

| File | Dependencies |
|---|---|
| `tokens.js` | `jsonwebtoken`, `crypto`, config — **no database, no req/res** → [pure unit tests](../tests/unit.tokens.test.js.md) |
| `asyncHandler.js` | **Nothing** |
| `ApiError.js` | **Nothing** |
| `logger.js` | **Nothing** (deliberately not even config — see below) |
| `cache.js` | The Redis client |
| `activityLogger.js` | `events`, logger |

⭐ `tokens.js` having no DB or `req`/`res` dependency is why it's the natural unit-test target: milliseconds fast, fully deterministic, and a failure points at exactly one function.

## ⚠️ The logger dependency exception

`logger.js` reads `process.env.LOG_LEVEL` **directly** rather than importing [`config/env.js`](../config/env.js.md) — the only place in the project that bypasses the config module.

Why: `env.js` imports `logger.js` to report configuration problems. If `logger.js` imported `env.js`, you'd have a **circular require** — and in CommonJS that doesn't error, it silently returns a **partially-populated** module. You'd get `logger.info is not a function` at boot with a confusing stack. Breaking the cycle at the logger is the fix.

Worth knowing as a general CJS property: circular imports resolve to a *partial* object rather than throwing, so the failure appears far from the cause.

## Interview questions

- **"What makes code easy to test?"** → No hidden dependencies, no I/O, deterministic output. `tokens.js` is the example; when something is hard to test, that's usually a **design** signal.
- **"You have a circular require. What does Node do?"** → Returns the partially-initialised module instead of erroring, so you get `undefined is not a function` far from the cause.

## Related

- [`server/README.md`](../README.md) — layering
- [`tests/`](../tests/README.md) — what verifies these
