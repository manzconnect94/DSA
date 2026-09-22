# `server/utils/activityLogger.js`

> A shared EventEmitter for in-process pub/sub. Controllers emit; listeners log, buffer and (optionally) broadcast over WebSocket.

**Lines:** 174 · **Concept blocks:** 5

## Why it exists

EventEmitter is the **backbone of Node** — streams, HTTP servers, sockets and process signals are all emitters. Knowing it isn't trivia; it's how you decouple "something happened" from "here is everything that should happen next".

**Without it,** `createTask()` would call `sendEmail()`, `writeAuditLog()`, `updateSearchIndex()` and `bumpMetrics()` inline. The controller now depends on four subsystems, and **a failure in the email service breaks task creation.**

**With it,** the controller emits `taskCreated` and moves on; listeners subscribe independently. Real-time was later [added over WebSocket](../server.js.md) without touching a single controller — that's the payoff.

## ⭐ Is it a message queue? NO.

The follow-up that catches people out. **This is the distinction:**

| | **EventEmitter** | **Message queue** (RabbitMQ / SQS / Kafka) |
|---|---|---|
| Scope | **In-process only** | Crosses process & machine boundaries |
| Timing | Listeners are **synchronous** by default — `emit()` runs each to completion inline | Consumers are asynchronous, decoupled in time |
| Persistence | **None** — process dies, pending work is gone forever | **Durable** — survives a crash, messages are redelivered |
| Retry | None, no dead-letter queue | Built-in retry + DLQ |
| Backpressure | None | Consumers pull at their own rate |
| Fan-out | This process only | Across many services |

⭐ **So: EventEmitter is for in-process decoupling.** The moment you need the work to **survive a crash**, be **retried**, or be handled by **another service**, you need a real queue.

**"I'd start with an emitter and move to BullMQ/SQS when durability matters"** is the answer that lands.

## ⭐ `emit()` is SYNCHRONOUS — the most misunderstood part

People assume `emit()` schedules work for "later". **It does not.** It calls every registered listener **in order, on the current tick**, and only returns once they've all finished.

**Consequences:**

| | |
|---|---|
| A slow, CPU-heavy listener | **BLOCKS the request** that emitted the event |
| A listener that **throws** | Propagates back into the emitter's call stack, breaking the `emit()` caller |
| An `async` listener | `emit()` does **not await it** — it gets a floating promise, and an unhandled rejection can **crash the process** (Node 15+ makes them fatal) |

**Rule of thumb:** keep listeners fast and synchronous, or have the listener itself hand the work to a queue.

Every listener here is wrapped in `safeListener()`, a try/catch so a listener bug **can never take down the request that emitted**.

## ⚠️ The `'error'` event is special

If an EventEmitter emits `'error'` and **nothing is listening**, Node does not ignore it — it **throws the error and crashes the process**. This is unique to the `'error'` event name and is deliberate ("errors must not pass silently"). **Always attach an `'error'` listener to any long-lived emitter.** Done here.

## The maxListeners warning

Node prints `MaxListenersExceededWarning: Possible EventEmitter memory leak` past 10 listeners on one event. It's a **warning, not an error**, and it exists because the usual cause is a real leak: **attaching a listener inside a request handler and never removing it**, so the array grows unboundedly with traffic.

⚠️ **Raising the limit to silence the warning without checking why is how leaks ship.** Set to 20 here because a handful are knowingly attached **at boot** — a bounded count.

## `once()` vs `on()`

| | Behaviour | Use for |
|---|---|---|
| `on()` | Stays forever | Long-lived subscriptions |
| `once()` | **Auto-removes** after the first call | One-shot things ("warm the cache after the first request") |

⚠️ Forgetting `off()`/`removeListener()` on a **per-request** listener is the textbook EventEmitter memory leak. A one-shot boot marker demonstrates `once()` in the file.

## Events

| Event | Emitted by |
|---|---|
| `taskCreated` / `taskUpdated` / `taskDeleted` | [`taskController`](../controllers/taskController.js.md) |
| `userRegistered` / `userLoggedIn` / `userLoggedOut` | [`authController`](../controllers/authController.js.md) |

Named constants, because a **typo'd `emit()` fails silently** — emitting an event nobody listens to is perfectly legal and does nothing.

## API

| Export | Purpose |
|---|---|
| `activityLogger` | The shared singleton (extends `EventEmitter`) |
| `EVENTS` | Named event constants |
| `.record(entry)` / `.getRecent()` | A **bounded** 50-entry ring buffer for `/api/tasks/activity` |

⚠️ The buffer is capped at 50 — **an unbounded array here would itself be the memory leak** the maxListeners warning is about.

## ⚠️ It's per-process

With multiple [cluster workers](../cluster.js.md) or pods, this emitter is **per-process**. A task created on worker 2 will not notify a client connected to worker 1. The fix is Redis pub/sub or the Socket.io Redis adapter — the same "per-process state doesn't survive horizontal scaling" lesson as the [cache](./cache.js.md) and [rate limiter](../middleware/rateLimiter.js.md).

## Interview questions

- **"Is an EventEmitter a message queue?"** → No. Give the table — in-process, synchronous, no persistence, no retry.
- **"Does `emit()` schedule work for later?"** → No. It runs every listener inline on the current tick.
- **"What if a listener throws?"** → It propagates into the emitter's caller. Wrap listeners.
- **"What happens if an emitter emits `'error'` with no listener?"** → The process crashes.
- **"You see MaxListenersExceededWarning. What do you check?"** → Whether listeners are being attached per-request and never removed — not how to raise the limit.
- **"When would you move to a real queue?"** → When the work must survive a crash, be retried, or cross a service boundary.

## Related

- [`server.js`](../server.js.md) — bridges these events to Socket.io
- [`controllers/taskController.js`](../controllers/taskController.js.md) · [`authController.js`](../controllers/authController.js.md) — the emitters
- [`cluster.js`](../cluster.js.md) — the per-process limitation
- [`jobs/cleanupJob.js`](../jobs/cleanupJob.js.md) — the durable-work alternative
