# `server/jest.config.js`

> Jest configuration, with each non-obvious option explained.

**Lines:** 52 · **Concept blocks:** 4

## Configuration

| Option | Value | Why |
|---|---|---|
| `testEnvironment` | `node` | Not `jsdom` — there's no DOM on the server. The client uses `jsdom` via [Vitest](../client/src/test/setup.js.md). |
| `setupFilesAfterEnv` | `tests/setup.js` | Starts the in-memory MongoDB per test file |
| `testTimeout` | 30s | Jest's 5s default is too short for the first test if `mongodb-memory-server` must download a mongod binary |
| `maxWorkers` | 1 | Serial execution — see below |
| `collectCoverageFrom` | controllers, middleware, models, utils | Excludes `utils/*Demo.js` (those are documentation, not app code) |
| `coverageThreshold` | 50% statements | A floor, not a goal |
| `detectOpenHandles` | true | Surfaces leaked connections/timers |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **`testTimeout`** | A mysterious `Exceeded timeout of 5000 ms` on a fresh CI machine is almost always `mongodb-memory-server` downloading ~100MB on first run. |
| **`--runInBand` and test isolation** | Jest parallelises test *files* across worker processes by default — great for speed, terrible for integration tests sharing one database. Two files truncating collections simultaneously produce flaky, order-dependent failures. Options: run serially (chosen here), or give each worker its own database using `process.env.JEST_WORKER_ID`. The second scales better; the first is simpler. |
| **Coverage thresholds, and their limits** | A threshold stops slow rot. ⚠️ But be ready for the pushback: **coverage measures which lines executed, not whether you asserted anything.** A test that calls a function and asserts nothing gives 100% coverage and catches zero bugs. Use it as a floor and a trend. |
| **Jest configuration for a Node backend** | Why `node` over `jsdom`, and the setup-file split. |

## The npm scripts

```json
"test":          "cross-env NODE_ENV=test jest --runInBand --forceExit"
"test:watch":    "cross-env NODE_ENV=test jest --runInBand --watch"
"test:coverage": "cross-env NODE_ENV=test jest --runInBand --coverage --forceExit"
```

- **`cross-env`** because `NODE_ENV=test jest` is bash syntax that fails in cmd.exe. Essential on Windows.
- **`NODE_ENV=test`** is load-bearing. It switches [`config/env.js`](./config/env.js.md) to the test database, drops bcrypt rounds to 4, swaps Redis for the in-memory client, disables Socket.io and cron, and — critically — [disables rate limiting](./middleware/rateLimiter.js.md).
- **`--forceExit`** is pragmatic, not ideal. `detectOpenHandles` is on specifically so you can find and fix what's leaking rather than relying on it.

## Interview questions

- **"Is 100% coverage a good goal?"** → No. It measures execution, not assertion quality. Aim for coverage of *behaviour*, and use the threshold to prevent regression rather than to chase a number.
- **"Your integration tests pass individually and fail together. Why?"** → Shared database state plus parallel workers. Either serialise or isolate per worker.
- **"Jest says it didn't exit one second after the run completed."** → An open handle: an unclosed DB connection, a live server, or an un-`unref`'d timer. `--forceExit` hides it; closing handles properly fixes it — the same discipline that makes graceful shutdown work.

## Related

- [`tests/setup.js`](./tests/setup.js.md) — lifecycle hooks and isolation
- [`tests/README.md`](./tests/README.md) — the four suites
- [`middleware/rateLimiter.js`](./middleware/rateLimiter.js.md) — why `NODE_ENV=test` matters so much
