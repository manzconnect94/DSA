# `server/jobs/cleanupJob.js`

> Two cron jobs guarded by a Redis distributed lock. Disabled by default.

**Lines:** 182 · **Concept blocks:** 5

## The jobs

| Job | Schedule (UTC) | Does |
|---|---|---|
| `pruneRefreshTokens` | `0 3 * * *` (03:00 daily) | Deletes revoked tokens older than 7 days |
| `archiveOldTasks` | `30 3 * * 0` (03:30 Sunday) | `status: 'done'` → `'archived'` after 90 days |

## Exports

| Export | Purpose |
|---|---|
| `start()` / `stop()` | Schedule / cancel |
| `withLock(name, ttl, fn)` | The distributed lock wrapper |
| `pruneRefreshTokens` / `archiveOldTasks` | The job bodies — **exported so they're unit-testable without the scheduler** |

## ⭐ The distributed lock: `SET key value NX EX`

```js
const result = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
acquired = result === 'OK';
```

| Flag | Meaning |
|---|---|
| `NX` | Set **only if the key does not exist** |
| `EX` | Expire after N seconds |

⭐ **Atomicity is the whole point.** Doing it as GET-then-SET leaves a window where two instances both see "no lock" and both proceed. `SET ... NX EX` is **one round-trip, one atomic operation**.

⭐ **The `EX` is equally important — it's the deadlock guard.** Without a TTL, an instance that **crashes while holding the lock blocks the job forever.**

### ⚠️ The honest caveat

This is "good enough" locking, **not a correctness guarantee**. If the job runs longer than the TTL, a second instance acquires the lock while the first is still working.

⭐ **For work that must run exactly once, you need fencing tokens or — better — idempotent job design: make the job safe to run twice rather than trying to guarantee it never is.** That reframing is the strong answer.

*(Redlock formalises multi-node Redis locking, and is itself [contested](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) — worth knowing that the debate exists.)*

### Releasing safely

```js
const current = await redis.get(key);
if (current === token) await redis.del(key);
```

⚠️ **Only release if WE still hold it.** Between acquiring and releasing, the TTL may have expired and another instance may now own the lock — **deleting the key blindly would release someone else's lock.** Strictly this check-then-delete should be a Lua script to be atomic; the file says so.

### Fail closed

If Redis is unreachable, the job **does not run**:

```js
catch (err) { return { skipped: true, reason: 'lock-unavailable' }; }
```

⭐ Note this is the **opposite** policy from the [cache](../utils/cache.js.md), which fails **open**. Deliberate: a cache miss is harmless, but running an uncoordinated job **reintroduces the duplication bug on exactly the day your Redis is having problems.** Choosing fail-open vs fail-closed per concern is the point.

## Cron expression syntax

```
┌─ minute (0-59)
│ ┌─ hour (0-23)
│ │ ┌─ day of month (1-31)
│ │ │ ┌─ month (1-12)
│ │ │ │ ┌─ day of week (0-7, 0 and 7 both = Sunday)
* * * * *
```

| Expression | Means |
|---|---|
| `0 3 * * *` | 03:00 every day |
| `*/15 * * * *` | Every 15 minutes |
| `30 3 * * 0` | 03:30 Sunday |

⚠️ **ALWAYS set an explicit timezone.** Without one, `node-cron` uses the **server's local time** — so a job scheduled for "3am" runs at a **different real moment depending on where the container is deployed**, and shifts twice a year with daylight saving. Worse, **a job scheduled in the hour DST skips may not run at all that day.** Both jobs here pin `timezone: 'UTC'`.

## Belt and braces with the TTL index

[`models/RefreshToken.js`](../models/RefreshToken.js.md) already has a TTL index that deletes **expired** tokens. This job handles what the TTL does **not**: tokens that were **revoked but not yet expired**, kept for a grace period as an audit trail of [reuse detection](../controllers/authController.js.md).

⭐ **Knowing which cleanup the database does for you and which you must do yourself is the point.**

## `updateMany` vs a loop of `save()`

`updateMany` is **one command** applied by the database across all matching documents. Looping and saving is **N round-trips plus N validations** — the batch-job version of the [N+1 problem](../controllers/queryDemoController.js.md).

⚠️ The trade-off, as always: `updateMany` is a **query** operation, so [document middleware and validators do NOT run](../models/README.md). Here we genuinely don't want the `pre('save')` hook — but **that has to be a decision, not an oversight.**

## Interview questions

- **"You run 4 instances. How many times does the job fire?"** → Four. Then the lock, then the ladder to a real queue.
- **"Implement a distributed lock."** → `SET key val NX EX ttl`. Explain why atomicity and the TTL both matter.
- **"What if the lock holder crashes?"** → The TTL releases it. Without one, permanent deadlock.
- **"What if the job outlives the TTL?"** → A second instance runs concurrently. Fencing tokens, or make the job idempotent.
- **"Why fail closed here but fail open for the cache?"** → A cache miss is harmless; an uncoordinated job causes duplicate side effects.
- **"Why set a cron timezone?"** → Otherwise the schedule depends on the host and shifts with DST.

## Related

- [`jobs/README.md`](./README.md) — the escalation ladder
- [`config/redis.js`](../config/redis.js.md) — the client, and the contrasting fail-open policy
- [`models/RefreshToken.js`](../models/RefreshToken.js.md) — the TTL index this complements
- [`cluster.js`](../cluster.js.md) — the per-process lesson
