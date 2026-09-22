# `server/routes/index.js`

> Mounts every router under `/api`, and owns the two health endpoints.

**Lines:** 76 · **Concept blocks:** 2

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | — | **Liveness** |
| `GET /api/health/ready` | — | **Readiness** |
| `/api/auth/*` | mixed | → [`authRoutes`](./authRoutes.js.md) |
| `/api/tasks/*` | Bearer | → [`taskRoutes`](./taskRoutes.js.md) |
| `/api/demo/*` | Bearer | → [`demoRoutes`](./demoRoutes.js.md) |
| `/api/admin/*` | Bearer + admin | → [`adminRoutes`](./adminRoutes.js.md) |

## ⭐ Liveness vs readiness

The distinction matters, and conflating them causes real outages.

| | Question | On failure | Checks dependencies? |
|---|---|---|---|
| **Liveness** `/health` | "Is the process alive?" | The orchestrator **kills and restarts** the container | ⚠️ **NO** |
| **Readiness** `/health/ready` | "Can this instance serve traffic *right now*?" | The load balancer **stops routing** to it, but leaves it running | ✅ Yes |

⚠️ **Why liveness must NOT check the database:** if it does, and the database blips for five seconds, **every pod fails its liveness probe simultaneously and gets restarted.** You have converted a brief DB hiccup into a full outage. Readiness is where dependency checks belong — the pod is taken out of rotation, gets a chance to recover, and rejoins.

### What each returns

**`/health`** — always 200 if the process responds:

```js
{ status: 'ok', uptimeSeconds, pid, memory: { rssMb, heapUsedMb, externalMb } }
```

Two details:

- **`pid`** differs per worker under [`cluster.js`](../cluster.js.md). Hit it repeatedly and watch it change — that's the load balancing, visible.
- **`externalMb`** is where Buffers live, *not* the heap. A Buffer leak won't show in `heapUsed` — see [`bufferDemo.js`](../utils/bufferDemo.js.md).

**`/health/ready`** — 200 or **503**:

```js
{ status, dependencies: { mongodb, cache }, cacheStats }
```

`mongoose.connection.readyState === 1` means connected (0 = disconnected, 2 = connecting, 3 = disconnecting).

⭐ Note the **cache is not a readiness blocker**. It [fails open](../config/redis.js.md), so the app is still *correct* without it — just slower. **Only hard dependencies belong in a readiness check.** Marking yourself unready because a cache is down takes healthy capacity offline for no reason.

## API versioning

The barrel is the natural seam. The standard follow-up:

| Approach | Pros | Cons |
|---|---|---|
| **Path** (`/api/v1/tasks`) | Unambiguous, easy to route and cache | Purists object that a URL should identify a resource, not a representation |
| **Header** (`Accept: application/vnd.app.v2+json`) | "Cleaner" REST | Hard to test by hand; CDN caching needs `Vary` |
| **Query** (`?version=2`) | Simplest | Easy to forget, messy to cache |

**The practical answer:** path versioning, and only version on a **breaking** change. Adding a field is not breaking; removing or renaming one is.

## Interview questions

- **"What's the difference between liveness and readiness?"** → The table above. The killer detail: liveness must not check dependencies, or one DB blip restarts your fleet.
- **"Should a cache outage make your instance unready?"** → No, if the cache fails open. You'd be removing working capacity.
- **"How would you version an API?"** → Path, on breaking changes only.
- **"How do you confirm load balancing is working?"** → Expose the pid (or hostname) on a health endpoint and watch it vary.

## Related

- [`app.js`](../app.js.md) — mounts this at `/api`
- [`config/redis.js`](../config/redis.js.md) — the fail-open behaviour that keeps the cache out of readiness
- [`docker-compose.yml`](../../docker-compose.yml.md) · [`Dockerfile`](../Dockerfile.md) — the healthchecks that call these
