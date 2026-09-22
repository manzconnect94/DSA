# `server/utils/callbackDemo.js`

> ▶ **Runnable.** The same task written four ways — callbacks → promises → async/await → `Promise.all` — with real timings.

**Lines:** 256 · **Concept blocks:** 7

```bash
cd server && npm run demo:callback
```

The rest of the codebase is 100% async/await. This one file keeps the callback style alive **side by side** so the contrast is concrete rather than theoretical.

## The error-first convention

```js
fn(args..., (err, result) => { if (err) { ... } ... })
```

The **first** parameter is always the error. It's first so it's impossible to ignore by accident, and it's `null` (not `undefined`, not `false`) on success.

⚠️ **It's a convention, not a language rule** — nothing stops a library from getting it wrong, which is itself part of the problem.

## ⚠️ NEVER throw inside an async callback

```js
setTimeout(() => {
  if (!id) throw new Error('...');   // ❌ CRASHES THE PROCESS
}, 30);
```

A `throw` here would **not** be caught by a try/catch wrapped around the calling function. By the time the callback fires, **the original call stack is long gone** — you're in a fresh tick of the event loop. The throw becomes an **uncaught exception and crashes the process**.

⭐ **This is the single biggest footgun of callback code, and it's exactly what promises fixed:** a throw inside a promise chain becomes a **rejection you can catch**.

## ⭐ "Callback hell" — four concrete problems

Not just "it's ugly". Name these:

| # | Problem |
|---|---|
| 1 | **Nesting** — each dependent step indents one level further; five steps and the code marches off the right edge |
| 2 | **Error handling is manual and repeated** — `if (err) return cb(err)` in **every** callback. **Miss one and the error vanishes silently.** |
| 3 | **No composition** — you can't easily run two in parallel and wait for both; you hand-roll a counter, which is where off-by-one bugs live |
| 4 | ⭐ **Inversion of control** — you hand your callback to someone else's code and **trust them to call it exactly once**. A buggy library that calls it twice, or never, corrupts your logic and there's nothing you can do. **Promises fix this structurally: a promise can only settle ONCE.** |

That fourth point is the one that impresses, because it's a *structural* guarantee rather than a syntactic improvement.

## `util.promisify`

A great practical answer to "how do you modernise legacy callback code?" It wraps any function following the convention **exactly** (callback last, error first) and returns a promise-returning version.

⚠️ If a library deviates, promisify breaks and you must wrap by hand with `new Promise((resolve, reject) => ...)`.

Also worth knowing: Node ships promise variants natively now — `fs.promises` / `require('fs/promises')` — so you rarely need to promisify fs yourself.

## The promise chain's awkwardness

The demo deliberately shows this:

```js
let capturedUser;                        // ← an outer variable, because...
return findUserAsync('u2')
  .then(user => { capturedUser = user; return findTasksAsync(user.id); })
  .then(tasks => { /* ...each .then only receives the PREVIOUS value */ });
```

⭐ In a `.then` chain each step only receives the **previous** step's value, so carrying context forward means an outer variable or nested `.then` (**back to the pyramid**). `async`/`await` has no such problem — both are just locals. That's an underrated argument for await beyond readability.

## async/await — be precise

| | |
|---|---|
| An `async` function **always returns a promise** | Even if you `return 5` |
| `await` pauses the **function**, resumes via the **microtask** queue | It does **not** block the thread — other requests run meanwhile |
| **try/catch now works** on async errors | A rejection is thrown back into the function. The big ergonomic win. |
| ⚠️ It does **NOT** make anything parallel | Sequential awaits are sequential |

## ⭐ Sequential vs parallel — the timed comparison

A very common real-world performance bug:

```js
const user  = await getUser();     // 30ms
const tasks = await getTasks();    // 30ms   → total 60ms
```

These don't depend on each other, so waiting for the first before starting the second **wastes 30ms**. `Promise.all` starts both immediately → **~30ms total**. At scale (a loop over 100 items) that's the difference between **3 seconds and 30ms**.

⭐ **The trick is that `Promise.all` doesn't start them — calling the functions does.** Both promises are created *before* either is awaited.

### The four combinators

| | Behaviour | Use when |
|---|---|---|
| `Promise.all` | All must succeed; **rejects fast** on the first failure (the others keep running, results discarded) | You need everything |
| `Promise.allSettled` | **Never rejects**; returns `{status, value\|reason}` per item | Independent best-effort work — a dashboard where one failed widget shouldn't blank the page |
| `Promise.race` | First to **settle**, success **or** failure | The classic timeout pattern |
| `Promise.any` | First **success**; rejects only if all fail | Fallback endpoints |

⚠️ **Unbounded `Promise.all` is its own trap:** `await Promise.all(tenThousandIds.map(fetchOne))` opens **10,000 simultaneous connections** and will exhaust the [DB pool](../config/db.js.md) or get you rate-limited. Use a concurrency limiter (`p-limit`) or batch it.

⚠️ **`race` does NOT cancel the loser** — the demo prints this explicitly. The slow query keeps running and still consumes a connection. Real cancellation needs an `AbortController` (see [`useFetch`](../../client/src/hooks/useFetch.js.md)).

## The same fs read, three ways

⚠️ **Why `*Sync` methods are banned in request handlers:** `readFileSync` **halts the single thread** until the disk responds. Every other in-flight request waits. Acceptable **only at boot** (loading a config file or TLS cert before listening), never per-request.

## Interview questions

- **"Why is the error the first callback argument?"** → Impossible to ignore by accident. It's a convention, not enforced.
- **"What happens if you `throw` inside a `setTimeout` callback?"** → Uncaught exception, process crash — the stack that could catch it is gone.
- **"What problems do promises solve?"** → All four, ending with inversion of control / settle-once.
- **"These two awaits don't depend on each other. What's wrong?"** → Serialised for no reason. `Promise.all`.
- **"`all` or `allSettled`?"** → all for "I need everything"; allSettled for independent best-effort.
- **"Does `Promise.race` cancel the losers?"** → No. They keep running and consuming resources.
- **"Is `Promise.all` always better?"** → No — unbounded fan-out exhausts pools. Limit concurrency.
- **"Can you use `readFileSync`?"** → At boot, yes. Per-request, never.

## Related

- [`utils/eventLoopDemo.js`](./eventLoopDemo.js.md) — why `await` resumes on the microtask queue
- [`controllers/authController.js`](../controllers/authController.js.md) — `Promise.all` in real application code
- [`utils/asyncHandler.js`](./asyncHandler.js.md) — what happens to a rejection in Express
- [`middleware/upload.js`](../middleware/upload.js.md) — error-first callbacks in a live dependency
