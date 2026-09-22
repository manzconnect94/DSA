# `server/server.js`

> Owns the process: connects the database, binds the port, attaches Socket.io, and handles shutdown.

**Lines:** 208 · **Concept blocks:** 8

## What it does

```
start()
 ├─ await connectDB()        ← BEFORE listening
 ├─ getRedisClient()         ← warm it so outages log at boot
 ├─ http.createServer(app)   ← explicit, so Socket.io can share the port
 ├─ tune keepAliveTimeout
 ├─ registerProcessHandlers  ← uncaughtException, SIGTERM, ...
 ├─ attachSocketIo()         ← optional
 ├─ start cron jobs          ← optional
 └─ server.listen(5000)
```

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Separating `app.js` from `server.js`** | ⭐ The testing payoff: Supertest takes the app *object* (`request(app)`) and never opens a real port. That means fast tests, no port conflicts in CI, and no leaked handles keeping Jest alive. One file would start a server on import. |
| **Connect to dependencies BEFORE binding the port** | Otherwise there's a window where the port is open but the app can't serve — the load balancer marks the instance healthy and routes real users to a server that will 500. Shutdown is the mirror image: stop listening first, *then* close the DB. |
| **`http.createServer(app)` vs `app.listen()`** | `app.listen()` is a shortcut for exactly this. Doing it explicitly gives you the `http.Server`, which you need for Socket.io (it upgrades HTTP connections), `keepAliveTimeout`, and `server.close()`. |
| **`keepAliveTimeout` behind a load balancer** | Obscure but real: if Node's timeout is *shorter* than the LB's, Node can close a connection exactly as the LB sends a request down it → sporadic 502s that are nearly impossible to reproduce. AWS ALB defaults to 60s, so Node is set to 65s, and `headersTimeout` must exceed it. |
| **WebSockets vs polling** | The full progression — short polling (wasteful), long polling (holds a connection), SSE (one-way, simple), WebSockets (bidirectional, lowest latency). ⭐ The trade-off that matters: **a WebSocket pins a user to one instance**, destroying the statelessness JWT gave you. Scaling needs sticky sessions or a Redis adapter. |
| **Authenticating a WebSocket** | The handshake can't carry an `Authorization` header from the browser, so the token goes in the handshake `auth` payload and is verified in connection middleware *before* any event handler is wired. ⚠️ It's verified **once** — a socket opened at 10:00 is still open at 11:00 with a token that expired at 10:15. |
| **Rooms** | A server-side channel label. `socket.join('user:123')` handles the multi-tab/multi-device case for free. |
| **Bridging the EventEmitter to sockets** | The payoff of the [EventEmitter decoupling](./utils/activityLogger.js.md): real-time was added without touching a single controller. ⚠️ But the emitter is **per-process** — a task created on worker 2 won't notify a client on worker 1. |

## Graceful shutdown

Delegated to [`registerProcessHandlers`](./middleware/errorHandler.js.md), which handles `uncaughtException`, `unhandledRejection`, `SIGTERM` and `SIGINT`. The policy is **log and exit**, not "keep the server alive" — after an uncaught exception the process state is unknown, so continuing means serving corrupt data.

SIGTERM matters specifically for containers: Kubernetes sends it and waits ~30s before SIGKILL. Ignore it and every deploy kills in-flight requests. Note this only works if the process is PID 1 with proper signal forwarding — see the [`dumb-init`](./Dockerfile.md) note.

## Exports

```js
module.exports = { start, app };
```

Guarded by `if (require.main === module)` so importing this file in a script doesn't start a listening server as a side effect.

## Interview questions

- **"Why separate `app.js` and `server.js`?"** → So tests can drive the app without binding a port.
- **"Kubernetes sends SIGTERM. What should your app do?"** → Stop accepting new connections, let in-flight requests finish, close DB connections, exit. With a hard timeout so a hung request can't block the deploy forever.
- **"How would you add real-time updates?"** → Walk the polling → long-polling → SSE → WebSockets ladder, then name the scaling consequence: WebSockets are stateful and need a pub/sub adapter across instances.
- **"Random 502s behind an ALB. Where do you look?"** → Keep-alive timeout mismatch between the LB and Node.
- **"Should you restart the process after an uncaught exception?"** → Yes — exit and let a supervisor restart cleanly. Continuing risks corrupt state.

## Related

- [`app.js`](./app.js.md) · [`cluster.js`](./cluster.js.md) — the multi-core alternative
- [`config/db.js`](./config/db.js.md) — the connection awaited at boot
- [`middleware/errorHandler.js`](./middleware/errorHandler.js.md) — process handlers and draining
- [`utils/activityLogger.js`](./utils/activityLogger.js.md) — the events bridged to sockets
