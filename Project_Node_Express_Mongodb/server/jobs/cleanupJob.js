// ============================================================
// 🧠 CONCEPT: Scheduled background jobs (cron) — and their scaling trap
// WHY IT MATTERS (interview angle): every real app has periodic work:
//   expiring sessions, sending digests, reconciling payments, pruning logs.
//   The interview value is in knowing the failure modes, not the syntax.
//
//   ⚠️⚠️ THE TRAP: IN-PROCESS CRON DOES NOT SURVIVE HORIZONTAL SCALING.
//   Run 4 instances (cluster.js, or 4 Kubernetes pods) and the job fires
//   FOUR TIMES at 3am — four duplicate emails to every user, four
//   concurrent writers racing on the same rows. This is one of the most
//   common production bugs when a team scales from one server to two, and
//   it is exactly the same "per-process state" lesson as the cache, the
//   rate limiter and Socket.io.
//
//   THE FIXES, roughly in order of maturity:
//   1. A DISTRIBUTED LOCK — every instance tries to acquire a Redis key
//      (`SET jobname NX EX 300`); only the winner runs. Simple and
//      effective. ⚠️ Needs a lock TTL longer than the job, or a second
//      instance grabs it mid-run. (Redlock formalises this.)
//   2. A LEADER ELECTION — one instance is designated and only it schedules
//      jobs.
//   3. A DEDICATED SCHEDULER — a separate deployment/pod that runs no web
//      traffic, or a Kubernetes CronJob. Clean separation: the job cannot
//      starve your request handlers of CPU, and it scales independently.
//   4. A JOB QUEUE (BullMQ, Agenda, SQS + Lambda) — the real answer at
//      scale. You get persistence across restarts, retries with backoff,
//      dead-letter queues, concurrency control and observability. An
//      in-process cron has NONE of those: if the process dies mid-job, the
//      work is silently lost with no record it ever started.
//
//   ⚠️ ALSO: a heavy cron job runs ON THE SAME EVENT LOOP as your requests.
//   A 30-second synchronous cleanup blocks every user for 30 seconds.
//   Either keep jobs async and chunked, or move them off the web process.
//
// HOW IT WORKS HERE: disabled by default (ENABLE_CRON_JOBS=false) precisely
//   because of the duplication problem above. The Redis lock is implemented
//   so the mechanism is concrete rather than hand-waved.
// ============================================================

const cron = require('node-cron');
const RefreshToken = require('../models/RefreshToken');
const Task = require('../models/Task');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

// ============================================================
// 🧠 CONCEPT: A distributed lock with SET NX EX
// WHY IT MATTERS (interview angle): `SET key value NX EX 300` is ATOMIC —
//   it sets the key ONLY IF it does not exist (NX) and expires it after 300
//   seconds (EX), in one round-trip. Atomicity is the whole point: doing it
//   as GET-then-SET leaves a window where two instances both see "no lock"
//   and both proceed.
//   The EX is equally important — it is the deadlock guard. Without a TTL,
//   an instance that crashes while holding the lock blocks the job FOREVER.
//   ⚠️ And the honest caveat: this is "good enough" locking, not a
//   correctness guarantee. If the job runs longer than the TTL, a second
//   instance acquires the lock while the first is still working. For work
//   that must run exactly once, you need fencing tokens or idempotent job
//   design — make the job safe to run twice rather than trying to guarantee
//   it never is.
// ============================================================
async function withLock(lockName, ttlSeconds, fn) {
  const redis = getRedisClient();
  const key = `lock:${lockName}`;
  const token = `${process.pid}-${Date.now()}`;

  let acquired = false;
  try {
    const result = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
    acquired = result === 'OK';
  } catch (err) {
    logger.warn(`[job] could not reach Redis for lock "${lockName}": ${err.message}`);
    // Fail CLOSED for jobs: if we cannot coordinate, do not run. The
    // opposite choice (run anyway) reintroduces the duplication bug on
    // exactly the day your cache is having problems.
    return { skipped: true, reason: 'lock-unavailable' };
  }

  if (!acquired) {
    logger.debug(`[job] "${lockName}" is held by another instance — skipping`);
    return { skipped: true, reason: 'lock-held' };
  }

  try {
    return await fn();
  } finally {
    // ⚠️ Only release the lock if WE still hold it. Between acquiring and
    // releasing, the TTL may have expired and another instance may now own
    // it — deleting the key blindly would release SOMEONE ELSE'S lock.
    // Strictly this check-then-delete should be a Lua script to be atomic.
    try {
      const current = await redis.get(key);
      if (current === token) await redis.del(key);
    } catch (_err) {
      /* the TTL will clean it up */
    }
  }
}

// ------------------------------------------------------------------
// Job 1: prune revoked/expired refresh tokens
// ------------------------------------------------------------------
async function pruneRefreshTokens() {
  // ============================================================
  // 🧠 CONCEPT: Belt and braces alongside the TTL index
  // WHY IT MATTERS (interview angle): models/RefreshToken.js already has a
  //   TTL index that deletes EXPIRED tokens. This job handles what the TTL
  //   does not: tokens that were REVOKED but have not yet expired, which
  //   we keep for a grace period as an audit trail of reuse detection.
  //   Knowing which cleanup the database does for you and which you must do
  //   yourself is the point.
  // ============================================================
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await RefreshToken.deleteMany({
    revokedAt: { $ne: null, $lt: cutoff },
  });
  return { deleted: result.deletedCount };
}

// ------------------------------------------------------------------
// Job 2: archive stale completed tasks
// ------------------------------------------------------------------
async function archiveOldTasks() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // ============================================================
  // 🧠 CONCEPT: updateMany vs a loop of save()
  // WHY IT MATTERS (interview angle): updateMany is ONE command applied by
  //   the database across all matching documents. Looping and saving is N
  //   round-trips plus N validations — the batch-job version of the N+1
  //   problem. The trade-off, as always: updateMany is a QUERY operation,
  //   so document middleware and validators do NOT run. Here we genuinely
  //   do not want the pre('save') hook, so it is the right call — but that
  //   has to be a decision, not an oversight.
  // ============================================================
  const result = await Task.updateMany(
    { status: 'done', completedAt: { $lt: cutoff } },
    { $set: { status: 'archived' } }
  );
  return { archived: result.modifiedCount };
}

// ------------------------------------------------------------------
// Scheduler
// ------------------------------------------------------------------
const scheduled = [];

function start() {
  // ============================================================
  // 🧠 CONCEPT: Cron expression syntax
  // WHY IT MATTERS (interview angle): minor, but people fumble it.
  //     ┌─ minute (0-59)
  //     │ ┌─ hour (0-23)
  //     │ │ ┌─ day of month (1-31)
  //     │ │ │ ┌─ month (1-12)
  //     │ │ │ │ ┌─ day of week (0-7, 0 and 7 both = Sunday)
  //     * * * * *
  //   '0 3 * * *'   = 03:00 every day
  //   '*/15 * * * *'= every 15 minutes
  //   ⚠️ ALWAYS set an explicit TIMEZONE. Without one, node-cron uses the
  //   server's local time — so a job scheduled for "3am" runs at a
  //   different real moment depending on where the container is deployed,
  //   and shifts twice a year with daylight saving. Worse, a job scheduled
  //   in the hour that DST skips may not run at all that day.
  // ============================================================
  scheduled.push(
    cron.schedule(
      '0 3 * * *',
      async () => {
        const outcome = await withLock('prune-refresh-tokens', 300, pruneRefreshTokens);
        logger.info(`[job] pruneRefreshTokens: ${JSON.stringify(outcome)}`);
      },
      { timezone: 'UTC' } // explicit, and UTC so it is deployment-independent
    )
  );

  scheduled.push(
    cron.schedule(
      '30 3 * * 0', // 03:30 every Sunday
      async () => {
        const outcome = await withLock('archive-old-tasks', 600, archiveOldTasks);
        logger.info(`[job] archiveOldTasks: ${JSON.stringify(outcome)}`);
      },
      { timezone: 'UTC' }
    )
  );

  logger.info(`[job] ${scheduled.length} cron job(s) scheduled (UTC, Redis-locked)`);
}

function stop() {
  for (const task of scheduled) task.stop();
  scheduled.length = 0;
}

module.exports = { start, stop, pruneRefreshTokens, archiveOldTasks, withLock };
