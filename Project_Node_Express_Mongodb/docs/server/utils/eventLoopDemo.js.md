# `server/utils/eventLoopDemo.js`

> ▶ **Runnable.** Five experiments that make the event loop observable. No database, no server.

**Lines:** 191 · **Concept blocks:** 7

```bash
cd server && npm run demo:eventloop
```

⭐ **Run it several times.** Experiment 1's output order **changes between runs** — and understanding why is the whole point.

## ⭐ The six phases

Node is single-threaded for *your* JavaScript, but libuv underneath uses a thread pool for filesystem and some crypto/DNS work. The loop is what lets one thread juggle thousands of concurrent I/O operations: **it never waits on I/O**, it registers a callback and moves on.

```
┌─────────────────────────────┐
│  1. TIMERS                  │  setTimeout / setInterval whose threshold elapsed
├─────────────────────────────┤
│  2. PENDING CALLBACKS       │  deferred system-level callbacks
├─────────────────────────────┤
│  3. IDLE / PREPARE          │  internal to libuv
├─────────────────────────────┤
│  4. POLL                    │  ⭐ retrieves new I/O events and runs their callbacks.
│                             │     If nothing is pending, the loop BLOCKS HERE waiting
│                             │     for work — which is why an idle Node server uses ~0% CPU
├─────────────────────────────┤
│  5. CHECK                   │  setImmediate callbacks
├─────────────────────────────┤
│  6. CLOSE CALLBACKS         │  socket.on('close')
└─────────────────────────────┘
            ↓ loop back to 1
```

⭐ **The microtask queues run BETWEEN every phase** (and between each individual callback), not as a phase of their own:

1. `process.nextTick` queue — drained **first**, highest priority
2. Promise microtask queue — drained immediately after

That's why an `await` resolves before a `setTimeout(…, 0)` scheduled earlier.

## The five experiments

### 1. Top-level ordering — ⚠️ NON-deterministic

The discriminating half of the classic question. Most candidates confidently say "setImmediate always runs first". **That is WRONG at the top level.**

`setTimeout(fn, 0)` is **clamped by Node to 1ms**. When the loop starts, it enters TIMERS and asks "has 1ms elapsed?"

| Process startup took | Result |
|---|---|
| ≥ 1ms | The timer fires **first** |
| < 1ms | The loop moves on to CHECK, **setImmediate fires first**, and the timer waits for the next iteration |

**So the output flips between runs depending on machine load.** Run the file five times and you may well see both orderings.

Guaranteed order for the microtasks, though: sync → `nextTick` → `Promise.then` → (timer / immediate in either order).

### 2. Inside an I/O callback — ✅ DETERMINISTIC

The deterministic half, and being able to state **both** halves is what separates "memorised a blog post" from "understands the loop".

Inside an `fs.readFile` callback, `setImmediate` **always** beats `setTimeout`. Reason: the I/O callback runs in **POLL**. The very next phase is **CHECK**, where setImmediate lives — so it fires on this same iteration. TIMERS is phase 1, already passed, so the timer must wait for the whole loop to come around again.

### 3. `await` is a microtask

`async`/`await` is promise sugar, so everything after an `await` resumes via the **microtask** queue — before any timer, before any I/O callback, after the `nextTick` queue. Note `await null` **still yields**: awaiting a non-promise defers to the microtask queue.

**"Does `await` block?"** → It blocks the *function*, never the *thread*.

### 4. Blocking the loop

⭐ **The #1 practical Node failure mode.** A deliberate 50ms busy-wait, timed and reported.

One synchronous CPU-heavy operation **freezes every concurrent request**, because they all share the single thread. A 2-second `JSON.parse` of a huge payload is 2 seconds during which your server answers nobody — **health checks included**, so the orchestrator may kill the pod.

**Common culprits:** big `JSON.parse`/`stringify`, synchronous fs methods, bcrypt with high rounds, huge regexes (**ReDoS**), sorting enormous arrays, `crypto.pbkdf2Sync`.

**Fixes:** [worker threads](../workers/reportWorker.js.md), a child process, chunking with `setImmediate` to yield between chunks, or moving it to a queue. See the [live demo](../../client/src/pages/AdminPage.jsx.md).

### 5. The libuv thread pool

⭐ **"Node is single-threaded" is a half-truth worth correcting.** Your JS runs on one thread, but **fs operations, `dns.lookup`, zlib and several crypto functions are dispatched to a libuv thread pool of DEFAULT SIZE 4.**

⚠️ **Network I/O does NOT use the pool** — it uses the OS's epoll/kqueue/IOCP directly, which is why Node scales to thousands of sockets.

**The practical consequence:** fire 5 concurrent `crypto.pbkdf2` calls and the 5th **waits for a free thread**. Bump `UV_THREADPOOL_SIZE` (max 1024) if you're genuinely fs/crypto-bound.

The experiment fires four parallel `readFile` calls; they complete in roughly the same wall-clock time, i.e. they really are parallel.

## ⚠️ `process.nextTick` starvation

`nextTick` is **not part of the event loop**. Its queue drains after the current operation and **before** the loop continues to the next phase — and before promise microtasks.

⚠️ **The danger:** a **recursive** `process.nextTick()` **starves the event loop completely.** The loop can never reach POLL, so **I/O never happens** and your server stops responding while burning 100% CPU. A recursive `setImmediate()` does **not** do this, because it yields each iteration.

**"When would you use `nextTick`?"** → Almost never in app code. It exists so libraries can guarantee a callback fires asynchronously but before any I/O.

## Interview questions

- **"Explain the event loop."** → The six phases, then the microtask queues running between them.
- **"`setTimeout(fn,0)` or `setImmediate` — which first?"** → **"It depends where you are."** Non-deterministic at top level (1ms clamp vs startup time); setImmediate always wins inside an I/O callback. Give both halves.
- **"Difference between `nextTick` and `setImmediate`?"** → nextTick is a higher-priority microtask outside the loop; setImmediate is the CHECK phase. Mention starvation.
- **"Node is single-threaded — how are four `readFile`s parallel?"** → libuv thread pool, default 4. Network I/O doesn't use it.
- **"What happens if a request does 5 seconds of CPU work?"** → Every other request waits. Health checks fail. Offload it.
- **"Does `await` block?"** → The function, not the thread.

## Related

- [`utils/callbackDemo.js`](./callbackDemo.js.md) — sequential vs parallel, timed
- [`controllers/adminController.js`](../controllers/adminController.js.md) — worker threads vs blocking
- [`workers/reportWorker.js`](../workers/reportWorker.js.md) — the fix
- [`client/src/pages/AdminPage.jsx`](../../client/src/pages/AdminPage.jsx.md) — blocking, demonstrated live over HTTP
