// ============================================================
// 🧠 CONCEPT: The cluster module — using every CPU core
// WHY IT MATTERS (interview angle): the direct answer to "Node is
//   single-threaded, so how do you use a 16-core server?"
//
//   Run this instead of server.js:   npm run cluster
//
//   ⭐ WHY NODE IS SINGLE-THREADED IN THE FIRST PLACE — this is the part
//   people skip, and it is the better half of the answer. It is a DESIGN
//   CHOICE, not a limitation:
//   • No shared mutable state between requests means NO LOCKS, no mutexes,
//     no race conditions, no deadlocks. An entire category of concurrency
//     bug simply does not exist.
//   • Threads are expensive: ~1MB of stack each plus context-switch cost.
//     Apache's thread-per-connection model collapses at ~10k connections
//     (the "C10k problem"). Node holds tens of thousands of sockets on one
//     thread because an idle connection costs only a file descriptor and a
//     callback, not a thread.
//   • For I/O-BOUND work — which is the overwhelming majority of web
//     servers — the thread would be blocked waiting on the network anyway.
//     An event loop uses that dead time to serve other requests.
//
//   THE COST: one thread means one CPU core. A 16-core box runs at 1/16th
//   capacity, and one CPU-heavy request blocks everyone.
//
//   ⭐ HOW CLUSTER WORKS: the PRIMARY process forks N WORKER processes
//   (via child_process.fork). Each is a FULL, SEPARATE Node process with
//   its own memory, its own V8 heap and its own event loop. They all SHARE
//   ONE LISTENING SOCKET — the primary creates it and passes the handle
//   down, so all workers accept on the same port.
//
//   HOW CONNECTIONS ARE DISTRIBUTED (two schedulers):
//   • SCHED_RR (round-robin) — the DEFAULT everywhere except Windows. The
//     primary accepts each connection and hands it to a worker in turn.
//     Fair, predictable distribution.
//   • SCHED_NONE — the OS decides which worker wakes up. Lower overhead but
//     notoriously UNBALANCED: a couple of workers can end up handling most
//     of the traffic (the "thundering herd" effect). This is the Windows
//     default, which is why local numbers on Windows may look lopsided.
//
//   ⚠️⚠️ THE CRITICAL CONSEQUENCE — WORKERS SHARE NOTHING.
//   This is the point the whole codebase has been building toward, and it
//   explains three earlier design decisions at once:
//     • A JS Map used as a cache is PER WORKER -> 4 divergent caches, and
//       invalidating on worker 1 leaves workers 2-4 serving stale data.
//       (See config/redis.js.)
//     • express-rate-limit's in-memory store is PER WORKER -> your "5
//       attempts" limit is really 5 × N. (See middleware/rateLimiter.js.)
//     • An in-memory session store is PER WORKER -> a user load-balanced
//       to a different worker appears logged out. (This is exactly why
//       STATELESS JWT AUTH is what makes this app clusterable at all.)
//     • The Socket.io event bridge is PER WORKER. (See server.js.)
//   The general rule: ANY STATE SHARED BETWEEN REQUESTS MUST LIVE OUTSIDE
//   THE PROCESS — in Redis, in MongoDB, or in a queue.
//
//   ⚠️ CLUSTER vs WORKER THREADS: cluster gives you N event loops for
//   THROUGHPUT; it does nothing for a single slow request. Worker threads
//   fix a single slow CPU-bound request. Different problems — see the
//   comparison table in controllers/adminController.js.
//
//   ⚠️ IN PRODUCTION you usually do NOT run cluster.js yourself. PM2
//   (`pm2 start server.js -i max`) does it with better restart logic, or
//   you run ONE process per container and let Kubernetes/ECS scale the
//   container count — which is cleaner, because the orchestrator already
//   handles restarts, health checks and rolling deploys, and one process
//   per container makes per-pod metrics meaningful.
// ============================================================

const cluster = require('cluster');
const os = require('os');
const logger = require('./utils/logger');

// ============================================================
// 🧠 CONCEPT: availableParallelism() over cpus().length
// WHY IT MATTERS (interview angle): `os.cpus().length` reports the HOST's
//   core count, which is wrong inside a container. A pod limited to 0.5 CPU
//   on a 64-core node still sees 64 and forks 64 workers — massively
//   oversubscribing the cgroup quota, causing constant context switching
//   and making everything slower. `os.availableParallelism()` (Node 18.14+)
//   respects the cgroup limit. This is a real and very common container bug.
// ============================================================
const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

// Leave headroom; forking more workers than cores just adds context
// switching. Capped at 4 here to keep the demo output readable.
const WORKER_COUNT = Math.min(Number(process.env.WEB_CONCURRENCY) || cpuCount, 4);

if (cluster.isPrimary) {
  logger.info('='.repeat(62));
  logger.info(`  CLUSTER MODE — primary pid ${process.pid}`);
  logger.info(`  detected ${cpuCount} available core(s), forking ${WORKER_COUNT} worker(s)`);
  logger.info(`  scheduling policy: ${cluster.schedulingPolicy === cluster.SCHED_RR ? 'SCHED_RR (round-robin)' : 'SCHED_NONE (OS decides)'}`);
  logger.info('='.repeat(62));

  // ============================================================
  // 🧠 CONCEPT: The primary does NO request handling
  // WHY IT MATTERS (interview angle): its only jobs are forking workers,
  //   distributing connections and restarting dead ones. Doing real work in
  //   the primary makes it a bottleneck and a single point of failure —
  //   if it blocks, no worker receives new connections.
  // ============================================================
  for (let i = 0; i < WORKER_COUNT; i += 1) {
    cluster.fork();
  }

  // ============================================================
  // 🧠 CONCEPT: Automatic restart, with a crash-loop guard
  // WHY IT MATTERS (interview angle): a worker crash should not reduce
  //   capacity permanently, so the primary forks a replacement. But naive
  //   "always restart immediately" is dangerous: if the bug is
  //   deterministic (a bad config, a missing env var), you get an infinite
  //   fork loop that pins every core at 100% and floods your logs. Real
  //   supervisors use exponential backoff and a restart budget. The guard
  //   below is a simplified version of that idea.
  // ============================================================
  let restarts = 0;
  const RESTART_LIMIT = 10;
  const restartWindowMs = 60_000;
  setInterval(() => {
    restarts = 0;
  }, restartWindowMs).unref();

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`[cluster] worker ${worker.process.pid} died (code=${code} signal=${signal})`);

    // A deliberate shutdown (exit code 0, or a SIGTERM we sent) must not be
    // "recovered" from — otherwise you can never stop the server.
    if (code === 0 || signal === 'SIGTERM') {
      logger.info('[cluster] clean exit — not restarting');
      return;
    }

    restarts += 1;
    if (restarts > RESTART_LIMIT) {
      logger.error(`[cluster] ${restarts} restarts in under a minute — crash loop. Giving up.`);
      process.exit(1);
    }

    logger.info('[cluster] forking a replacement worker');
    cluster.fork();
  });

  // ============================================================
  // 🧠 CONCEPT: Zero-downtime rolling restart
  // WHY IT MATTERS (interview angle): a nice thing to be able to describe.
  //   To deploy without dropping requests, restart workers ONE AT A TIME:
  //   tell worker 1 to stop accepting new connections and finish what it
  //   has (`worker.disconnect()`), wait for it to exit, fork a fresh one,
  //   wait for it to be listening, then move to worker 2. At every instant
  //   at least N-1 workers are serving traffic. Send SIGUSR2 to trigger it.
  // ============================================================
  process.on('SIGUSR2', async () => {
    logger.info('[cluster] SIGUSR2 — beginning rolling restart');
    const workers = Object.values(cluster.workers);

    for (const worker of workers) {
      await new Promise((resolve) => {
        worker.once('exit', () => {
          const replacement = cluster.fork();
          replacement.once('listening', resolve);
        });
        // disconnect() = graceful: stop accepting, drain in-flight requests.
        worker.disconnect();
        // Hard deadline in case a request hangs.
        setTimeout(() => worker.kill('SIGKILL'), 10_000).unref();
      });
      logger.info('[cluster] one worker replaced');
    }
    logger.info('[cluster] rolling restart complete');
  });

  process.on('SIGTERM', () => {
    logger.info('[cluster] SIGTERM — shutting down all workers');
    for (const worker of Object.values(cluster.workers)) {
      worker.kill('SIGTERM');
    }
  });
} else {
  // ============================================================
  // 🧠 CONCEPT: Each worker runs the ENTIRE server
  // WHY IT MATTERS (interview angle): note that server.js needs NO changes
  //   to work under cluster. Each worker requires it, connects to MongoDB
  //   independently (so N workers = N connection pools — watch your total
  //   connection count, see config/db.js) and listens on the same port via
  //   the shared handle. The app code is entirely unaware it is clustered.
  //   That only works because the app is STATELESS. Hit /api/health
  //   repeatedly and watch the `pid` field change — that is the load
  //   balancing, visible.
  // ============================================================
  require('./server');
  logger.info(`[cluster] worker ${process.pid} online`);
}
