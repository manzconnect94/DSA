# `server/cluster.js`

> Alternative entry point that forks one worker process per CPU core. Run with `npm run cluster`.

**Lines:** 179 · **Concept blocks:** 6

## What it does

The primary process forks N workers; each runs the *entire* [`server.js`](./server.js.md) unchanged. All workers share one listening socket, so they all accept on port 5000.

```
        ┌─────────────────┐
        │ PRIMARY (pid 1) │  forks, distributes connections, restarts
        │  no request work│
        └────────┬────────┘
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│worker 1 │ │worker 2 │ │worker N │  ← separate PROCESSES
│own heap │ │own heap │ │own heap │  ← own memory, own event loop
│own pool │ │own pool │ │own pool │  ← own Mongo connection pool
└─────────┘ └─────────┘ └─────────┘
```

**See it working:** hit `GET /api/health` repeatedly and watch the `pid` field change. That's the load balancing, visible.

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Why Node is single-threaded** | ⭐ The better half of the answer, and most candidates skip it. It's a *design choice*: no shared mutable state means **no locks, no mutexes, no race conditions, no deadlocks** — an entire class of bug doesn't exist. Threads cost ~1MB stack each, which is why thread-per-connection servers collapse at ~10k connections (the C10k problem). And for I/O-bound work the thread would be blocked waiting anyway. |
| **`availableParallelism()` over `cpus().length`** | ⚠️ A real container bug. `os.cpus().length` reports the **host's** cores — a pod limited to 0.5 CPU on a 64-core node sees 64 and forks 64 workers, massively oversubscribing its cgroup quota and making everything *slower*. `os.availableParallelism()` (Node 18.14+) respects the limit. |
| **The primary does no request handling** | Its only jobs are forking, distributing and restarting. Real work there makes it a bottleneck and a single point of failure. |
| **Automatic restart with a crash-loop guard** | Naive "always restart" is dangerous: a deterministic bug (bad config, missing env var) gives an infinite fork loop pinning every core at 100%. Real supervisors use exponential backoff and a restart budget. |
| **Zero-downtime rolling restart** | On `SIGUSR2`, replace workers one at a time: `worker.disconnect()` (stop accepting, drain in-flight), wait for exit, fork a replacement, wait for `listening`, move on. At every instant N-1 workers serve traffic. |
| **Each worker runs the ENTIRE server** | `server.js` needs **zero changes**. That only works because the app is stateless. |

## Scheduling: two policies

| Policy | Behaviour |
|---|---|
| `SCHED_RR` (default everywhere except Windows) | Primary accepts each connection and hands it to a worker in turn. Fair, predictable. |
| `SCHED_NONE` (Windows default) | The OS decides which worker wakes. Lower overhead but notoriously **unbalanced** — a couple of workers can take most of the traffic. |

This is why local numbers on Windows may look lopsided. The file logs which policy is active.

## ⚠️ The critical consequence: workers share NOTHING

This is what the whole codebase has been building toward. Separate processes mean separate memory, which breaks six things — each commented at its own source:

| Per-process state | What breaks |
|---|---|
| [Map-based cache](./config/redis.js.md) | N divergent caches; invalidating on worker 1 leaves 2–N serving stale data |
| [Rate-limit counters](./middleware/rateLimiter.js.md) | "5 attempts" becomes 5 × N |
| [EventEmitter listeners](./utils/activityLogger.js.md) | An event on worker A never reaches worker B |
| [Socket.io connections](./server.js.md) | A client on worker A misses events emitted on B |
| [In-process cron](./jobs/cleanupJob.js.md) | The 3am job fires N times |
| [Local-disk uploads](./middleware/upload.js.md) | Invisible to other workers; lost on redeploy |

**The rule:** any state shared between requests must live outside the process — Redis, MongoDB, or a queue. Stateless JWT auth is precisely what makes this app clusterable at all.

## cluster vs worker threads

| | Solves | Doesn't solve |
|---|---|---|
| **cluster** | Throughput across cores | A single slow request — it still runs on one thread in one process |
| **worker threads** | Latency of one CPU-bound request | Throughput (one event loop for HTTP) |

See the full three-way comparison in [`adminController.js`](./controllers/adminController.js.md).

## ⚠️ You probably shouldn't run this in production

PM2 (`pm2 start server.js -i max`) does it with better restart logic, or — more commonly — you run **one process per container** and let Kubernetes/ECS scale the container count. That's cleaner: the orchestrator already handles restarts, health checks and rolling deploys, and one process per container makes per-pod metrics meaningful.

## Interview questions

- **"Node is single-threaded — how do you use a 16-core server?"** → cluster or a process manager. But lead with *why* it's single-threaded: no locks, cheap concurrency, and I/O-bound work doesn't need threads.
- **"What breaks when you go from 1 process to 4?"** → Everything in the table above. The unifying answer: per-process state.
- **"cluster or worker threads?"** → cluster scales throughput; worker threads fix latency on CPU-bound work. Different problems.
- **"Your pod has a 0.5 CPU limit but forks 64 workers. Why?"** → `os.cpus()` sees the host, not the cgroup.

## Related

- [`server.js`](./server.js.md) — what each worker runs
- [`adminController.js`](./controllers/adminController.js.md) — worker threads, and the live blocked-event-loop demo
- [`config/db.js`](./config/db.js.md) — N workers × `maxPoolSize` = your real connection count
