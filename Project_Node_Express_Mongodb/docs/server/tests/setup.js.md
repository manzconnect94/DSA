# `server/tests/setup.js`

> Starts an in-memory MongoDB per test file and wipes collections between tests. Loaded via `setupFilesAfterEach`.

**Lines:** 82 · **Concept blocks:** 4

## ⭐ Test database strategy — three options

"How do you test database code?" has three answers, and the trade-offs matter:

| | Approach | ✅ | ❌ |
|---|---|---|---|
| 1 | **Mock the DB entirely** (`jest.mock` on the model) | Fast, no external dependency | ⭐ **You're testing your mock, not MongoDB.** It cannot catch a bad query, a missing index, a failing validator, or a schema typo. **Your mock will happily accept a query the real database rejects.** Use for unit tests of logic *around* the DB. |
| 2 | **A real shared test database** | Completely realistic | Needs CI infrastructure, tests interfere, state leaks between runs. Slow and flaky. |
| 3 | ⭐ **In-memory MongoDB** (`mongodb-memory-server`) — **used here** | Downloads and runs a **real mongod** against RAM-backed storage. **Genuine MongoDB semantics**: real indexes, real validators, real aggregation, real error codes (**including 11000**). Fresh isolated database per run. No external service in CI. | First run downloads ~100MB; startup costs a few seconds |

⭐ Option 3's decisive advantage: it **catches the bugs a mock cannot**. The [duplicate-email 409 test](./integration.auth.test.js.md) only works because a real unique index produces a real `code: 11000` — a mock would never generate that.

## Lifecycle hooks

| Hook | Does | Why there |
|---|---|---|
| `beforeAll` | Start `MongoMemoryServer`, connect Mongoose | **Expensive** — do it once per file |
| `afterEach` | `deleteMany({})` on every collection | **Cheap isolation** — every test starts clean |
| `afterAll` | Drop the database, close the connection, stop the server | Release handles |

⭐ The cost decision: putting the DB startup in `beforeEach` would make the suite unusably slow; putting the cleanup in `afterAll` would let tests contaminate each other.

## ⭐ Test isolation

Without `afterEach` cleanup, tests **pass in one order and fail in another**: a test that creates a user makes the next test's "no users exist" assertion fail.

⚠️ **Order-dependent tests are the #1 source of flaky suites**, and they're miserable to debug because **running the failing test alone makes it pass.**

### Why delete documents, not drop collections

```js
await Promise.all(Object.values(collections).map(c => c.deleteMany({})));
```

Dropping collections would also **destroy the indexes Mongoose built at connect time** — and then a test asserting on a unique-constraint error would **silently stop testing anything** (it would pass because no constraint exists). A subtle, dangerous difference.

## Closing handles

> *"Jest did not exit one second after the test run completed."*

That means something is still holding the event loop open — an unclosed DB connection, a live HTTP server, or an un-`unref`'d `setInterval`. `--forceExit` papers over it; **closing your handles properly is the fix**, and it's the same discipline that makes [graceful shutdown](../middleware/errorHandler.js.md) work in production.

`detectOpenHandles: true` in [`jest.config.js`](../jest.config.js.md) is on specifically so you can find them.

## The testing pyramid

Since it usually follows: **many** fast unit tests (pure functions), **fewer** integration tests (route + DB — most of this suite), **very few** E2E tests (slow and brittle, but the only ones that prove the whole thing actually works).

## Interview questions

- **"How do you test database code — mock it or use a real DB?"** → Give all three options and why in-memory wins for integration tests. The killer line: mocking means testing your mock.
- **"Your tests pass individually but fail as a suite."** → Shared state. Clean between tests, and check for anything keyed on a constant (IP, timestamps) — see [`rateLimiter`](../middleware/rateLimiter.js.md).
- **"Why `afterEach` and not `afterAll` for cleanup?"** → Isolation. `afterAll` lets tests contaminate each other.
- **"Why not drop the collections?"** → You'd lose the indexes, and constraint tests would silently stop testing.
- **"Jest won't exit. What's wrong?"** → An open handle. Find it rather than forcing exit.

## Related

- [`jest.config.js`](../jest.config.js.md) — `setupFilesAfterEach`, `maxWorkers`, `detectOpenHandles`
- [`config/db.js`](../config/db.js.md) — the production connection this bypasses
- [`mocking.test.js`](./mocking.test.js.md) — the *other* strategy, for comparison
