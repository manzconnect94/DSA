# `server/workers/reportWorker.js`

> A worker thread that does deliberately heavy CPU work and posts one message back.

**Lines:** 60 · **Concept blocks:** 3

## What it does

1. Reads `workerData` → `{ iterations, tasks }`
2. Burns CPU in a tight loop (the deliberately expensive part)
3. Aggregates the tasks by status and priority
4. `parentPort.postMessage({ ... })`

Spawned by [`adminController.generateReport`](../controllers/adminController.js.md) on `GET /api/admin/report?mode=worker`.

## ⭐ This runs in a separate V8 isolate

Everything that follows from that, and which people get wrong:

| | |
|---|---|
| **No shared variables** with the main thread | `global` here is a **different object**. You cannot read a module-level variable from the parent. |
| **No access to the parent's `require` cache** | Modules are loaded **fresh** — part of why startup costs ~10–30ms |
| Data crosses via **structured clone** | It is **COPIED**. A huge object is expensive to pass — **and that copy is itself CPU work on the main thread**, partially defeating the purpose. |
| ⚠️ Structured clone **cannot carry** functions, class instances (they arrive as plain objects), or **Mongoose Documents** | Hence `.lean()` in the caller |
| **Blocking is FINE** | It doesn't touch the main event loop. **That is the entire point.** |

⭐ For large **binary** payloads, use `SharedArrayBuffer` (genuinely shared, **zero copy**) or **transfer** an ArrayBuffer's ownership. That's the real performance story for worker threads — copying defeats it.

## `workerData` vs `postMessage`

| | Purpose |
|---|---|
| **`workerData`** | The **one-time** payload handed over at construction. Good for "here is the job". |
| **`postMessage`** | The ongoing **two-way** channel. Good for progress updates, or for feeding more jobs to a **long-lived pooled worker**. |

⭐ Knowing both is what lets you build a worker **pool** rather than spawning one per request.

## ⚠️ `postMessage` ends the job, not the thread

Posting a message does **not** terminate the worker. The thread stays alive as long as its event loop has work (a pending timer, an open handle).

For a **one-shot** worker this is fine — it exits naturally once the script completes. For a **pooled** worker you keep it alive on purpose and reuse it, which is exactly how `piscina` avoids paying the startup cost per job.

## The parent's contract

The [caller](../controllers/adminController.js.md) handles all three events plus a timeout:

```js
worker.on('message', resolve);
worker.on('error', reject);
worker.on('exit', code => { if (code !== 0) reject(...) });
setTimeout(() => { worker.terminate(); reject(...) }, 30_000).unref();
```

⚠️ **All three events matter.** A worker that exits **without** posting a message would leave the promise **pending forever** — a leak that's easy to miss because nothing errors.

## Seeing it work

Compare `?mode=worker` against `?mode=blocking` and watch how long `/api/health` takes to respond during the request:

| Mode | `/api/health` | Meaning |
|---|---|---|
| `worker` | ~5ms | ✅ Main loop free |
| `blocking` | as long as the whole report | ❌ **That number is the outage** |

The [admin page](../../client/src/pages/AdminPage.jsx.md) automates and displays this.

## Interview questions

- **"Do worker threads share memory with the main thread?"** → They share the *process* address space, but each has its own isolate and globals. Data passed via `postMessage`/`workerData` is **copied** (structured clone) unless you use `SharedArrayBuffer` or transfer ownership.
- **"Why can't I pass a Mongoose document to a worker?"** → Structured clone can't serialise class instances with methods. Use `.lean()`.
- **"Is it OK to block inside a worker?"** → Yes — that's the point. It doesn't affect the main loop.
- **"When does a worker exit?"** → When its event loop drains, not when it posts a message.
- **"Your worker promise never resolves. Why?"** → It exited without posting, and you only handled `'message'`.
- **"Why not one worker per request?"** → ~10–30ms startup each. Pool them.

## Related

- [`controllers/adminController.js`](../controllers/adminController.js.md) — the spawn, and the three-way comparison
- [`workers/README.md`](./README.md) — why these files live apart
- [`utils/eventLoopDemo.js`](../utils/eventLoopDemo.js.md) — the blocking problem this solves
- [`client/src/pages/AdminPage.jsx`](../../client/src/pages/AdminPage.jsx.md) — the live demo
