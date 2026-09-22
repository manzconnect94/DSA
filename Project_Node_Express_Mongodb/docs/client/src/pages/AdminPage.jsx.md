# `client/src/pages/AdminPage.jsx`

> Admin dashboard, cache stats, and ⭐ **a live demonstration of a blocked event loop.**

**Lines:** 164 · **Concept blocks:** 3 · **Route:** `/admin` (lazy, `requireRole="admin"`)

## ⚠️ RBAC on the client, enforced on the server

This page is only reachable behind `<ProtectedRoute requireRole="admin">` — but **that is cosmetic.** The endpoints it calls are protected by [`requireRole('admin')` middleware](../../../server/middleware/auth.js.md).

⭐ **Delete the client guard and a regular user reaches this page — and sees nothing but 403s.** That's the **correct** outcome, and it's the demonstration that **the server is where security lives.**

## What it shows

| Section | Data | Concept |
|---|---|---|
| Counts | users, tasks, active sessions | `estimatedDocumentCount` — **O(1) metadata read**, right for a dashboard tile where "approximately" is fine |
| Cache | hit rate, hits/misses, backend | ⭐ "How do you know your cache is working?" |
| Top users | `$group` + `$lookup` | [Starting the pipeline on the collection you can filter hardest](../../../server/controllers/adminController.js.md) |
| Report | worker vs blocking | ⭐ The event-loop demo |

## ⭐ Surfacing cache hit rate

```jsx
<strong>{data?.cache?.hitRate}%</strong> hit rate
backend: <strong>{data?.cache?.backend}</strong>
```

⭐ **"How do you know your cache is working?" — you measure it.**

A hit rate **below ~70%** on a read-heavy endpoint usually means the **TTL is too short** or the **cache key is too specific** (every request generating a unique key means you have a **write-only cache**).

The `backend` field reports `redis` or `in-memory-fallback`, with an inline warning when it's the latter:

> ⚠️ *Redis is not running — this per-process Map would diverge across instances*

⭐ So a **silent degradation becomes visible**, which is the point of [the fallback being loud](../../../server/config/redis.js.md).

There's also a **Flush cache** button, so you can watch the hit rate reset and the next request miss.

## ⭐ Demonstrating a blocked event loop, live

**The most visceral way to show why CPU-bound work must leave the main thread.**

```js
// Fire the report, then 100ms later ping /api/health and time it
const healthProbe = new Promise(resolve => {
  setTimeout(async () => {
    const started = performance.now();
    await axiosClient.get('/health');
    resolve(Math.round(performance.now() - started));
  }, 100);
});

const [res, healthMs] = await Promise.all([
  axiosClient.get('/admin/report', { params: { mode, iterations: 20_000_000 } }),
  healthProbe,
]);
```

Both buttons run the **same** 20-million-iteration computation. The difference is **where**:

| Mode | `/api/health` responds in | Meaning |
|---|---|---|
| ✅ `worker` | ~5ms | The main loop stayed **free**; other requests unaffected |
| ❌ `blocking` | **as long as the entire report** | ⭐ **That second number IS the outage.** Every user, every request, waited. |

The result is colour-coded (`.perf-bar.good` / `.bad`) with an explicit verdict:

> ❌ *The event loop was blocked — every other user was waiting too.*

⭐ **Health checks included** — which in production means the orchestrator may decide the pod is dead and kill it. A CPU-heavy request can take down a *healthy* server.

You can also see it from a terminal: `curl localhost:5000/api/health` while the blocking request runs, and watch it hang.

## Why `Promise.all` here

The report request and the health probe must run **concurrently** — that's the entire experiment. Awaiting them sequentially would measure the health check *after* the report finished, showing nothing. ⭐ A case where [`Promise.all` isn't an optimisation but a requirement of the measurement](../../../server/utils/callbackDemo.js.md).

## Uses the hand-rolled `useFetch`

```js
const { data: overview, isLoading, error, refetch } = useFetch('/admin/overview');
```

Deliberately **not** React Query — this page is a real consumer of [`useFetch`](../hooks/useFetch.js.md), so the hook isn't only exercised in tests. `refetch` is wired to the flush-cache button so the stats reload immediately.

## Interview questions

- **"Is a client-side role check security?"** → No. Explain that the server middleware is the enforcement, and that bypassing the guard just yields 403s.
- **"Node is single-threaded — how do you handle CPU-heavy work?"** → Worker threads, and **demonstrate the difference with a concurrent health check.** The [three-way comparison](../../../server/controllers/adminController.js.md) is the full answer.
- **"Why is a blocked event loop worse than a slow request?"** → It's not one slow request — it's **every** request, including health checks, which can get your instance killed.
- **"How do you know your cache is effective?"** → Hit rate, plus latency with and without. A low rate points at TTL or key design.
- **"`countDocuments` or `estimatedDocumentCount`?"** → Estimate for unfiltered dashboard tiles (O(1)); count when you need a filter.

## Related

- [`server/controllers/adminController.js`](../../../server/controllers/adminController.js.md) — ⭐ the worker-vs-child-process-vs-cluster table
- [`server/workers/reportWorker.js`](../../../server/workers/reportWorker.js.md) — the worker
- [`server/utils/eventLoopDemo.js`](../../../server/utils/eventLoopDemo.js.md) — blocking, in isolation
- [`server/utils/cache.js`](../../../server/utils/cache.js.md) — where the stats come from
- [`hooks/useFetch.js`](../hooks/useFetch.js.md) · [`routes/ProtectedRoute.jsx`](../routes/ProtectedRoute.jsx.md)
