# `server/utils/cache.js`

> Cache-aside implementation with TTL jitter, prefix invalidation and hit-rate stats.

**Lines:** 164 · **Concept blocks:** 4

## ⭐ Cache-aside (lazy loading)

The most common caching strategy, and the one to be able to draw on a whiteboard:

```
1. Request arrives
2. Look in the cache
3. HIT  → return it. Done. No DB touched.
4. MISS → query the DB, write to cache with a TTL, return it
```

Called "cache-**aside**" because the application manages the cache *beside* the database; the cache has no idea the DB exists.

### The alternatives

| Strategy | How | Trade-off |
|---|---|---|
| **Read-through** | The cache itself loads from the DB on a miss; app code only talks to the cache | Simpler app code, less control |
| **Write-through** | Writes go to cache **and** DB synchronously | Never stale, but every write pays both latencies |
| **Write-behind** | Write to cache, flush to DB asynchronously | Fastest writes, but you can **LOSE data** if the cache dies first |

### Cache-aside's weaknesses, worth naming unprompted

- Every **miss** costs cache-lookup + DB-query (slightly slower than no cache)
- Data can be stale for up to the TTL — hence explicit invalidation on writes
- ⭐ **Thundering herd / cache stampede:** a popular key expires and 500 concurrent requests **all** miss and **all** hit the DB simultaneously. Fixes: a short lock ("only one caller may repopulate"), or **staggering TTLs with jitter** so keys don't all expire at the same instant.

## TTL jitter

If 1,000 keys are written at boot with an identical 60s TTL, they **all expire in the same second** and you get a synchronised flood of DB queries. Every write here uses a **±10% randomised TTL** to spread expiries out.

## ⭐ Write-time invalidation — "the two hard things"

> Phil Karlton: *"There are only two hard things in Computer Science: cache invalidation and naming things."*

**TTL alone is not enough.** If a user creates a task and the list is cached for 60 seconds, they refresh and **don't see their own task**. That's a bug report, not a performance win. So every mutation must proactively purge the affected keys.

**Invalidate or update?** Deleting is **safer and simpler** — the next read repopulates. Updating the cached value in place ("write-through") is faster but easy to get subtly wrong when the cached shape is a **filtered/paginated projection** rather than the raw document. This code deletes.

Called from every task create/update/delete in [`taskController.js`](../controllers/taskController.js.md).

## Fail open

⭐ **A cache is an optimisation, not a source of truth.** Both the read and write paths catch errors, log a warning, and **fall through to the database** — slower but correct. **"The cache must fail open"** is the phrase interviewers like hearing. Same policy as [`config/redis.js`](../config/redis.js.md).

## ⚠️ `KEYS` blocks Redis

`invalidateByPrefix` uses `KEYS`, which is **O(N) over the entire keyspace** and **blocks the Redis server** (Redis is single-threaded) for the duration. On a database with millions of keys, **one `KEYS` call can stall every other client for seconds.**

In production use **`SCAN`** (cursor-based, non-blocking) or — better — maintain a Redis **SET of the keys belonging to each namespace**, so invalidation is a precise `SREM` + `DEL` instead of a scan. `KEYS` is used here only because it keeps the example readable.

## Key design

```
tasks:list:<userId>:<base64url(JSON of filters+page+limit)>
```

⚠️ **The key must encode every input that changes the result.** Miss one and you serve user A's tasks to user B — **a data breach, not a caching bug.** ⭐ **Over-broad cache keys are a security issue.**

The opposite failure is a key so specific nothing ever hits — a write-only cache. Namespacing (`tasks:list:...`) also lets you invalidate a whole family by prefix and prevents two features colliding on a key like `"list"`.

## API

| Export | Purpose |
|---|---|
| `buildKey(...parts)` | Colon-joined namespaced key |
| `getOrSet(key, ttl, loader)` | Cache-aside. Returns `{ data, cached }` — the boolean is surfaced in the UI so you can *see* the hit. |
| `invalidateByPrefix(prefix)` | Prefix delete (see the `KEYS` warning) |
| `invalidateTaskCache(userId)` | Nukes one user's list namespace |
| `getStats()` / `resetStats()` | `{ hits, misses, errors, hitRate, backend, defaultTtlSeconds }` |

## Hit-rate stats

⭐ "How do you know your cache is working?" — **you measure it.** Exposed on `/api/health/ready` and the [admin page](../../client/src/pages/AdminPage.jsx.md). A hit rate below ~70% on a read-heavy endpoint usually means the TTL is too short or the **key is too specific**.

Note the `backend` field reports `redis` or `in-memory-fallback`, so a silent degradation is visible.

## ⚠️ The JSON serialisation cost

Cached values are JSON strings. For a **huge** payload, `JSON.parse` can rival the DB query it replaced — it's CPU work on the event loop. **Measure, don't assume.**

## Interview questions

- **"Walk me through cache-aside."** → The four steps, then contrast read-through/write-through/write-behind.
- **"A user creates a task and doesn't see it."** → Stale cache. TTL isn't enough; invalidate on write.
- **"A hot key expires and 500 requests arrive."** → Thundering herd. Lock, or jitter the TTLs.
- **"Redis is down. Should your API 500?"** → No. Fail open.
- **"What's wrong with `KEYS pattern*` in production?"** → O(N) and it blocks single-threaded Redis. Use `SCAN` or a tracked key set.
- **"How do you know your cache helps?"** → Hit rate, plus latency with and without.
- **"What must a cache key include?"** → Every input affecting the result — and getting it wrong is a security bug.

## Related

- [`config/redis.js`](../config/redis.js.md) — the client and fail-open policy
- [`controllers/taskController.js`](../controllers/taskController.js.md) — `getOrSet` and invalidation in use
- [`cluster.js`](../cluster.js.md) — why a per-process cache breaks
- [`client/src/pages/ReactQueryPage.jsx`](../../client/src/pages/ReactQueryPage.jsx.md) — the same invalidation problem on the client
