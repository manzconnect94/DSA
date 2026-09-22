# `server/jobs/`

> Scheduled background work. One file, and it's mostly about why in-process cron is a trap.

| File | Doc | Lines |
|---|---|---|
| `cleanupJob.js` | [→](./cleanupJob.js.md) | 182 |

## Disabled by default

`ENABLE_CRON_JOBS=false` in [`.env.example`](../env.example.md) — deliberately, because of the duplication problem below. Enable it only when you understand what happens at scale.

## ⚠️ The headline problem

**In-process cron does not survive horizontal scaling.** Run 4 instances and the job fires **four times** at 3am — four duplicate emails to every user, four concurrent writers racing on the same rows.

This is one of the most common production bugs when a team scales from one server to two, and it's the **same lesson** as the [cache](../config/redis.js.md), the [rate limiter](../middleware/rateLimiter.js.md) and the [event emitter](../utils/activityLogger.js.md) — collected in [`cluster.js`](../cluster.js.md).

## The escalation ladder

| Maturity | Approach | Trade-off |
|---|---|---|
| 1 | **Distributed lock** — every instance tries `SET jobname NX EX 300`; only the winner runs | Simple and effective. ⚠️ Needs a TTL longer than the job. **Implemented here.** |
| 2 | **Leader election** — one instance is designated and only it schedules | More coordination machinery |
| 3 | **Dedicated scheduler** — a separate deployment with no web traffic, or a Kubernetes CronJob | Clean separation: the job can't starve request handlers of CPU, and scales independently |
| 4 | ⭐ **Job queue** (BullMQ, Agenda, SQS + Lambda) | **The real answer at scale**: persistence across restarts, retries with backoff, dead-letter queues, concurrency control, observability. An in-process cron has **none** of those — if the process dies mid-job, the work is **silently lost with no record it ever started.** |

## ⚠️ And it shares your event loop

A heavy cron job runs on the **same event loop** as your requests. A 30-second synchronous cleanup blocks every user for 30 seconds. Either keep jobs async and chunked, or move them off the web process entirely (option 3/4 above).

## Interview questions

- **"You run 4 instances. How many times does your 3am job fire?"** → Four. Then give the ladder.
- **"Where should scheduled work live?"** → Not in the web process, once you scale. A dedicated worker or a queue.
- **"What does a queue give you that cron doesn't?"** → Durability, retries, DLQ, concurrency control, visibility.

## Related

- [`cleanupJob.js`](./cleanupJob.js.md) — the implementation and the lock
- [`cluster.js`](../cluster.js.md) — the unifying lesson
- [`models/RefreshToken.js`](../models/RefreshToken.js.md) — the TTL index that handles *most* of the cleanup for free
