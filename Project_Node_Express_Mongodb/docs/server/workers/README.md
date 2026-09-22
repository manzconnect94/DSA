# `server/workers/`

> Worker-thread entry points. Code that runs on a **separate thread**, off the main event loop.

| File | Doc | Lines |
|---|---|---|
| `reportWorker.js` | [→](./reportWorker.js.md) | 60 |

## Why a separate folder

Files here are **not** required like normal modules — they're passed as a **path** to the `Worker` constructor and executed in a fresh V8 isolate:

```js
new Worker(path.join(__dirname, '..', 'workers', 'reportWorker.js'), { workerData })
```

Keeping them in their own folder makes that boundary obvious. A file in `workers/` has **different rules** from everything else in the project:

| | Normal module | Worker file |
|---|---|---|
| Shares memory with the app? | Yes | **No** — separate isolate |
| Can import app singletons? | Yes | ⚠️ It *can* require them, but gets **fresh instances** — a separate DB pool, a separate cache |
| Can block? | ❌ Never | ✅ **Blocking is the point** |
| Receives data via | Function arguments | `workerData` / `postMessage` (**structured clone — copied**) |

⭐ That third row is the key: **blocking is fine here.** Blocking this thread does not touch the main event loop.

## When to reach for this

Only for **CPU-bound JavaScript**. See the [three-way comparison](../controllers/adminController.js.md) (worker threads vs child processes vs cluster).

⚠️ **Not for I/O.** Node's async I/O is already non-blocking via libuv — a worker thread adds overhead and gains nothing. **Threads do not speed up a slow database query.** This is the check for whether you actually understand the distinction.

## Cost, and pooling

A worker costs **~10–30ms and a few MB** to spin up. For frequent small jobs that overhead dominates — use a **worker pool** (`piscina`) that keeps threads alive and reuses them, rather than one worker per request. This project creates one per request because it's a demo and the cost is visible.

## Interview questions

- **"When would you use a worker thread?"** → CPU-bound JS work that would block the loop: image processing, encryption, large parsing, report generation.
- **"Would it speed up a slow query?"** → No. That's I/O; it's already non-blocking.
- **"What's the overhead?"** → ~10–30ms startup plus memory. Pool them if jobs are frequent.

## Related

- [`controllers/adminController.js`](../controllers/adminController.js.md) — spawns this worker; the full comparison table
- [`cluster.js`](../cluster.js.md) — the throughput half of the answer
- [`utils/eventLoopDemo.js`](../utils/eventLoopDemo.js.md) — the blocking problem, in isolation
