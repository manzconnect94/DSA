# `server/config/redis.js`

> Returns a Redis client, or transparently degrades to an in-memory Map so the project runs with zero setup.

**Lines:** 127 · **Concept blocks:** 2

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Redis with an in-memory fallback** | ⭐ Be ready for "why Redis and not just a JS Map?" — **because a Map lives inside ONE Node process.** Run 4 processes behind a load balancer and you get 4 divergent caches, 4× the memory, and an invalidation on one process that leaves the other 3 serving stale data. Redis is a single shared store outside the process, so it also survives restarts and deploys. |
| **Fail-open caching** | A cache is an **optimisation, not a source of truth**. If Redis dies, the correct behaviour is to serve every request from the database — slower but correct — **not** to return 500s. "The cache must fail open" is the phrase interviewers like hearing. |

## The fallback is a documented anti-pattern

The log line says so explicitly:

> `[redis] unavailable (...) — FALLING BACK TO IN-MEMORY CACHE. This is fine for local study, NOT for production: per-process caches diverge across instances and invalidation only affects one process.`

That framing is deliberate. The fallback exists so you can clone and run the repo without installing Redis, **and** so the reason it's wrong is impossible to miss. The same lesson recurs in [`rateLimiter.js`](../middleware/rateLimiter.js.md), [`activityLogger.js`](../utils/activityLogger.js.md) and [`cleanupJob.js`](../jobs/cleanupJob.js.md), and is collected in [`cluster.js`](../cluster.js.md).

## The memory client

Implements the same small surface the [cache utility](../utils/cache.js.md) needs — `get`, `set`, `del`, `keys`, `flushall`, `quit` — so callers can't tell the difference.

Two honest limitations, noted in the code:

| | Redis | The Map fallback |
|---|---|---|
| Expiry | Lazy **and** active (background sweep) | **Lazy only** — a key is evicted when read. Cold keys leak memory forever. |
| Pattern matching | Full glob | Only trailing-`*`, which is all we use |
| Memory bound | `maxmemory` + [eviction policy](../../docker-compose.yml.md) | None |

## Connection strategy

```js
{
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,        // don't buffer commands while down
  retryStrategy: times => times > 3 ? null : Math.min(times * 200, 1000),
}
```

`enableOfflineQueue: false` matters for fail-open: with the queue on, commands *wait* for reconnection, so a Redis outage becomes request latency instead of a clean miss.

On the first `'error'` event the client disconnects and `client` is swapped for the memory client, guarded by a `usingFallback` flag so the swap and the warning happen exactly once.

In tests it returns the memory client immediately — **tests must never depend on an external service being up.**

## Exports

| Export | Purpose |
|---|---|
| `getRedisClient()` | Lazily creates and caches the client |
| `isUsingFallback()` | Surfaced on `/api/health/ready` and the admin page |
| `closeRedis()` | Graceful shutdown |

## Interview questions

- **"Why Redis instead of an in-process cache?"** → Shared across instances, survives restarts, supports TTL/eviction natively, and invalidation actually reaches everyone.
- **"Redis is down. Should your API return 500?"** → No. Fail open — serve from the database. A cache outage should degrade performance, never correctness.
- **"What's wrong with `enableOfflineQueue: true` for a cache?"** → Commands queue waiting for reconnection, converting an outage into latency on every request.
- **"When *would* an in-process cache be fine?"** → Truly immutable derived data (a parsed config, a compiled regex), or a single-instance deployment. The moment you scale out or need invalidation, it breaks.

## Related

- [`utils/cache.js`](../utils/cache.js.md) — the cache-aside logic built on this
- [`middleware/rateLimiter.js`](../middleware/rateLimiter.js.md) — the identical problem with counters
- [`cluster.js`](../cluster.js.md) — where "per-process" becomes concrete
- [`docker-compose.yml`](../../docker-compose.yml.md) — running a real Redis, and its eviction policy
