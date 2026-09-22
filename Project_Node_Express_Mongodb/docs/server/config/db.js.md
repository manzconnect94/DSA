# `server/config/db.js`

> Connects to MongoDB once at boot and exposes an idempotent `connectDB()`. Owns pool configuration.

**Lines:** 88 · **Concept blocks:** 4

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Connection pooling** | ⭐ "Does Mongoose open a new connection per query?" — **No.** The driver keeps a *pool* of TCP sockets and hands one to each operation, returning it when done. Opening a TCP connection + TLS handshake + auth per query would dominate latency. Default `maxPoolSize` is **100** (it was 5 in very old driver versions — a classic trick question). |
| **Tuning the pool — bigger is not better** | The pool is a **concurrency limit on your database**, not a performance dial. Each socket costs memory and a connection slot. ⚠️ 8 [cluster workers](../cluster.js.md) × `maxPoolSize: 100` = **800 potential connections from one machine** — enough to exhaust a small Atlas tier. `minPoolSize` keeps warm sockets so the first request after idle doesn't pay the handshake. |
| **Strict query mode** | Mongoose 7+ defaults `strictQuery` to `false`, so a filter on a field *not* in the schema is passed straight to MongoDB instead of being stripped. Usually what you want, but worth knowing: a **typo'd filter key then silently matches nothing** instead of being ignored. Set explicitly here so it isn't a surprise. |
| **Connection lifecycle events** | "What if the DB goes away at runtime?" The driver buffers commands and retries. Without `'error'`/`'disconnected'` listeners you get silent 10-second hangs instead of actionable logs. Listeners are attached **before** connecting so the very first failure isn't missed. |

## Configuration

```js
{
  maxPoolSize: 10,                  // modest and explicit
  minPoolSize: 2,                   // keep sockets warm
  serverSelectionTimeoutMS: 5000,   // fail fast rather than hang forever
  socketTimeoutMS: 45000,
}
```

`maxPoolSize: 10` is deliberately small so the number is *visible* and the multi-worker arithmetic is obvious. Tune it to roughly: expected concurrent in-flight queries per process.

## Idempotency

```js
let connectionPromise = null;
async function connectDB(uri) {
  if (connectionPromise) return connectionPromise;
  ...
}
```

Both [`server.js`](../server.js.md) and test helpers may call it. Caching the *promise* (not just a boolean) means concurrent callers await the same connection rather than racing to open two. On failure the cache is reset so a later retry can attempt a fresh connection.

## The Mongoose debug hook

```js
if (config.isDev) {
  mongoose.set('debug', (collection, method, query) => { ... });
}
```

⭐ This is how you **see** the [N+1 problem](../controllers/queryDemoController.js.md). Hit `/api/demo/tasks-slow` in development and watch 201 query lines scroll past. If the line count scales with your result size, you have an N+1. Far more convincing than reading about it.

## Exports

| Export | Purpose |
|---|---|
| `connectDB(uri?)` | Idempotent connect |
| `disconnectDB()` | Closes and clears the cached promise |
| `mongoose` | Re-exported for convenience |

## Interview questions

- **"Does Mongoose open a connection per query?"** → No — a pool. Explain why per-query connections would be prohibitively slow.
- **"What's the default pool size, and when would you change it?"** → 100 in current drivers. Lower it when running many processes against a constrained database; raise it when you genuinely have more concurrent queries than slots and the DB can take it.
- **"You run 10 pods with the default pool. What's your connection count?"** → Up to 1,000. Multiply by process count — this exhausts small managed tiers.
- **"How do you detect an N+1 in Mongoose?"** → Turn on `mongoose.set('debug')` and count the queries. If it scales with result size, that's your answer.

## Related

- [`server.js`](../server.js.md) — awaits this before binding the port
- [`cluster.js`](../cluster.js.md) — where the pool arithmetic bites
- [`tests/setup.js`](../tests/setup.js.md) — bypasses this for an in-memory server
- [`controllers/queryDemoController.js`](../controllers/queryDemoController.js.md) — what the debug hook reveals
