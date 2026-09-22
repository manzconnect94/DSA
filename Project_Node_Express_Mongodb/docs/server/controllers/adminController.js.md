# `server/controllers/adminController.js`

> Admin-only endpoints. Every handler sits behind `requireRole('admin')`, and it hosts the **worker threads vs blocking** demo.

**Lines:** 242 · **Concept blocks:** 4

## Handlers

| Handler | Route | Demonstrates |
|---|---|---|
| `listUsers` | `GET /admin/users` | Offset pagination |
| `overview` | `GET /admin/overview` | Cross-collection aggregation, `estimatedDocumentCount`, cache stats |
| `changeUserRole` | `PATCH /admin/users/:id/role` | Privilege-escalation guards |
| `revokeUserSessions` | `POST /admin/users/:id/revoke-sessions` | `revokeFamily` |
| `flushCache` | `POST /admin/cache/flush` | Prefix invalidation |
| `generateReport` | `GET /admin/report?mode=worker\|blocking` | ⭐ **Worker threads** |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **RBAC in practice** | The concrete payoff of the `role` field. Layering: `verifyAccessToken` (AuthN) then `requireRole` (AuthZ). Neither alone is sufficient. |
| **Aggregating across collections** | "MongoDB can't join" is outdated (`$lookup` since 3.2). What's still true is that joins are more expensive than in a relational DB and hint at denormalisation. ⭐ **Note the direction:** we start from `tasks` and group, rather than starting from `users` and looking up tasks — grouping 50k tasks by owner is far cheaper. **General rule: start the pipeline on the collection you can filter most aggressively.** |
| **Privilege-escalation guards** | Two worth having: (1) an admin must not demote **themselves** — you can lock the last admin out and need DB access to recover; (2) a role change must **invalidate existing tokens**, because `role` is baked into every issued access token, so a demoted admin keeps admin rights until expiry. Revoking refresh tokens caps exposure at 15 minutes. |
| **⭐ Worker threads vs child processes vs cluster** | See below. |

## ⭐ The three-way comparison

| | What it is | ✅ Use for | ❌ Don't use for |
|---|---|---|---|
| **worker_threads** | Real OS threads **inside** the same process. Own V8 isolate and event loop, but **shared memory space** — so `SharedArrayBuffer` gives zero-copy data passing. | **CPU-bound JavaScript**: image resizing, encryption, large JSON parsing, compression, report generation | **I/O.** Node's async I/O is already non-blocking via libuv — a thread adds overhead and gains nothing. **Threads do not speed up a slow database query.** |
| **child_process** | A **separate OS process**, own memory. IPC means everything is **serialised** — much costlier for large payloads. | Running a **non-JavaScript** program (ffmpeg, ImageMagick, a Python script); isolating crash-prone code so a segfault can't kill your server | General CPU work where a thread is cheaper. ⚠️ `exec()` runs through a **shell** — passing user input is command injection. Use `spawn()` with an argument array. |
| **cluster** | Forks N copies of your **whole server**, load-balancing connections | Scaling **throughput** across cores | **A single slow request** — it still runs on one thread in one process |

⭐ **The one-line summary:** cluster scales **throughput**; worker threads fix **latency** on CPU-bound work; child processes give **isolation** and let you run other languages.

**Cost note:** a worker costs ~10–30ms and a few MB to spin up. For frequent small jobs use a **worker pool** (piscina), not one per request.

## The live demo

`GET /admin/report?mode=blocking` vs `?mode=worker` — both do the same 20-million-iteration computation.

The [client page](../../client/src/pages/AdminPage.jsx.md) fires the report and, 100ms later, pings `/api/health`, then reports how long health took:

| Mode | `/api/health` responds in | Meaning |
|---|---|---|
| `worker` | ~5ms | ✅ The main loop stayed free |
| `blocking` | as long as the whole report | ❌ **That number is the outage** — every user was waiting |

This is the most visceral way to show why CPU work must leave the main thread. You can also see it from a terminal: curl `/api/health` while the blocking request runs and watch it hang.

## Worker contract

```js
worker.on('message', resolve);
worker.on('error', reject);
worker.on('exit', code => { if (code !== 0) reject(...) });
setTimeout(() => { worker.terminate(); reject(...) }, 30_000).unref();
```

All three events are handled — a worker that exits without posting a message would otherwise leave the promise **pending forever** (a leak). The timeout is `.unref()`'d so it can't keep the process alive by itself.

## `estimatedDocumentCount` here

Correct choice for a dashboard tile where "approximately" is fine — O(1) metadata read instead of a scan. See the [comparison](./taskController.js.md).

## Interview questions

- **"Node is single-threaded — how do you handle CPU-heavy work?"** → The three-way table. The discriminating part is *which* and *why*.
- **"Would worker threads speed up a slow database query?"** → No. That's I/O; it's already non-blocking. This is the check for whether you actually understand the distinction.
- **"An admin demotes another admin. What happens to their access?"** → Nothing, until their access token expires — `role` is a claim, a snapshot. Revoke refresh tokens to cap it, or use a denylist for instant effect.
- **"Why start the aggregation on `tasks` rather than `users`?"** → Filter/group where the volume is, and join the small side in.
- **"What's the risk of `exec()`?"** → It goes through a shell, so user input is command injection. Use `spawn()` with an array.

## Related

- [`workers/reportWorker.js`](../workers/reportWorker.js.md) — the worker itself
- [`cluster.js`](../cluster.js.md) — the throughput half of the answer
- [`middleware/auth.js`](../middleware/auth.js.md) — `requireRole`
- [`client/src/pages/AdminPage.jsx`](../../client/src/pages/AdminPage.jsx.md) — the live blocked-loop demo
- [`utils/eventLoopDemo.js`](../utils/eventLoopDemo.js.md) — blocking, in isolation
