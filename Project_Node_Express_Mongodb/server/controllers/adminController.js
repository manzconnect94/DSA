// ============================================================
// 🧠 CONCEPT: Admin-only endpoints — RBAC in practice
// WHY IT MATTERS (interview angle): every route in this file sits behind
//   requireRole('admin'). It is the concrete payoff of the role field on
//   the User model, and it demonstrates the layering: verifyAccessToken
//   (authentication) runs first, then requireRole (authorization). Neither
//   one alone is sufficient.
// HOW IT WORKS HERE: user listing, role changes, session revocation, and a
//   worker-thread demo for CPU-heavy report generation.
// ============================================================

const path = require('path');
const User = require('../models/User');
const Task = require('../models/Task');
const RefreshToken = require('../models/RefreshToken');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

// ------------------------------------------------------------------
// GET /api/admin/users
// ------------------------------------------------------------------
const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const [users, total] = await Promise.all([
    User.find()
      .select('name email role isActive lastLoginAt createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(),
  ]);

  res.json({
    success: true,
    data: users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ------------------------------------------------------------------
// GET /api/admin/overview  — aggregation across collections
// ------------------------------------------------------------------
const overview = asyncHandler(async (_req, res) => {
  const [userCount, taskCount, activeSessions, tasksPerUser] = await Promise.all([
    // estimatedDocumentCount() is O(1) metadata read — correct choice for a
    // dashboard tile where "approximately" is fine. countDocuments() would
    // scan. See the concept block in controllers/taskController.js.
    User.estimatedDocumentCount(),
    Task.estimatedDocumentCount(),
    RefreshToken.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),

    // ============================================================
    // 🧠 CONCEPT: Aggregating ACROSS collections with $lookup
    // WHY IT MATTERS (interview angle): "MongoDB can't join" is outdated —
    //   $lookup has existed since 3.2. What is still true is that joins are
    //   more expensive than in a relational database and are a hint that
    //   your data model may want denormalising. Here we deliberately start
    //   from `tasks` and group, rather than starting from `users` and
    //   looking up tasks, because grouping 50k tasks by owner is far cheaper
    //   than joining a task array onto every user.
    //   ⭐ The general rule: start the pipeline on the collection you can
    //   FILTER most aggressively.
    // ============================================================
    Task.aggregate([
      { $group: { _id: '$owner', taskCount: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } } },
      { $sort: { taskCount: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, email: 1 } }] } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, name: '$user.name', email: '$user.email', taskCount: 1, done: 1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      userCount,
      taskCount,
      activeSessions,
      topUsers: tasksPerUser,
      cache: cache.getStats(),
    },
  });
});

// ------------------------------------------------------------------
// PATCH /api/admin/users/:id/role
// ------------------------------------------------------------------
const changeUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    throw ApiError.badRequest('role must be "user" or "admin"');
  }

  // ============================================================
  // 🧠 CONCEPT: Preventing privilege-escalation edge cases
  // WHY IT MATTERS (interview angle): two guards worth having, and
  //   interviewers like seeing that you thought about them:
  //   1. An admin must not demote THEMSELVES — you can lock the last admin
  //      out of the system and need database access to recover.
  //   2. Changing a role must INVALIDATE EXISTING TOKENS. The `role` claim
  //      is baked into every issued access token, so a demoted admin keeps
  //      admin rights until their token expires. Revoking their refresh
  //      tokens caps the exposure at the 15-minute access-token lifetime;
  //      if you need it instant, that is what the denylist discussed in
  //      authController.logout is for.
  // ============================================================
  if (String(req.params.id) === req.user.id) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User');

  const previous = user.role;
  user.role = role;
  await user.save();

  if (previous !== role) {
    await RefreshToken.revokeFamily(user._id, 'admin-revoked');
    logger.warn(`[admin] ${req.user.email} changed ${user.email} role ${previous} -> ${role}; sessions revoked`);
  }

  res.json({ success: true, data: user, note: 'Sessions revoked; the old role persists in any unexpired access token for up to 15 minutes.' });
});

// ------------------------------------------------------------------
// POST /api/admin/users/:id/revoke-sessions
// ------------------------------------------------------------------
const revokeUserSessions = asyncHandler(async (req, res) => {
  const result = await RefreshToken.revokeFamily(req.params.id, 'admin-revoked');
  logger.warn(`[admin] ${req.user.email} revoked ${result.modifiedCount} session(s) for user ${req.params.id}`);
  res.json({ success: true, message: `Revoked ${result.modifiedCount} session(s)` });
});

// ------------------------------------------------------------------
// POST /api/admin/cache/flush
// ------------------------------------------------------------------
const flushCache = asyncHandler(async (_req, res) => {
  const cleared = await cache.invalidateByPrefix('tasks:');
  cache.resetStats();
  res.json({ success: true, message: `Cleared ${cleared} cache key(s) and reset stats` });
});

// ------------------------------------------------------------------
// GET /api/admin/report  — WORKER THREADS
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: WORKER THREADS vs CHILD PROCESSES vs CLUSTER
// WHY IT MATTERS (interview angle): "Node is single-threaded — how do you
//   handle CPU-heavy work?" The answer is three different tools, and the
//   discriminating question is WHICH ONE and WHY.
//
//   ── worker_threads ─────────────────────────────────────────────────
//   Real OS threads INSIDE the same process. Each gets its own V8 isolate
//   and event loop, but they SHARE the process's memory space, so you can
//   pass data via SharedArrayBuffer with ZERO COPYING, or transfer an
//   ArrayBuffer's ownership cheaply.
//     ✅ USE FOR: CPU-BOUND JavaScript. Image resizing, encryption,
//        large JSON parsing, data compression, report generation, ML
//        inference. Anything that would otherwise block the event loop.
//     ❌ DON'T USE FOR: I/O. Node's async I/O is already non-blocking and
//        handled by libuv — a worker thread adds overhead and gains nothing.
//        This is the mistake to call out: threads do not speed up a slow
//        database query.
//     Cost: ~10-30ms and a few MB to spin one up. For frequent small jobs
//     use a WORKER POOL (piscina) rather than creating one per request.
//
//   ── child_process (fork/spawn/exec) ────────────────────────────────
//   A SEPARATE OS PROCESS with its own memory. Communication is via IPC,
//   which means everything is SERIALISED — much more expensive than a
//   worker thread for large payloads.
//     ✅ USE FOR: running a NON-JAVASCRIPT program (ffmpeg, ImageMagick,
//        a Python script), or isolating untrusted/crash-prone code so a
//        segfault cannot take your server down.
//     ⚠️ exec() runs its argument through a SHELL — passing user input to
//        it is command injection. Use spawn() with an argument ARRAY.
//
//   ── cluster ────────────────────────────────────────────────────────
//   Forks N copies of your WHOLE SERVER and load-balances connections
//   across them.
//     ✅ USE FOR: scaling THROUGHPUT across CPU cores. See cluster.js.
//     ❌ DOES NOT HELP with one slow request — that request still runs on
//        one thread in one process. Cluster increases how MANY requests you
//        can serve, not how FAST any single one is.
//
//   ⭐ THE ONE-LINE SUMMARY: cluster scales THROUGHPUT, worker threads fix
//      LATENCY on CPU-bound work, child processes give ISOLATION and let
//      you run other languages.
//
// HOW IT WORKS HERE: a real (small) worker thread computing a report,
//   compared against doing the same work inline on the main thread. Watch
//   the health endpoint stay responsive during the worker run and stall
//   during the blocking run.
// ============================================================
const { Worker } = require('worker_threads');

function runReportInWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'workers', 'reportWorker.js'), {
      workerData: payload,
    });

    // The message/error/exit trio is the standard worker contract. Handle
    // all three — a worker that exits without posting a message would
    // otherwise leave this promise pending forever (a leak).
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });

    // Never let a runaway worker hang a request.
    setTimeout(() => {
      worker.terminate();
      reject(new Error('Report worker timed out'));
    }, 30_000).unref();
  });
}

const generateReport = asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'blocking' ? 'blocking' : 'worker';
  const iterations = Math.min(Number(req.query.iterations) || 5_000_000, 50_000_000);

  const tasks = await Task.find().select('status priority estimatedHours').limit(5000).lean();

  const started = process.hrtime.bigint();

  let result;
  if (mode === 'blocking') {
    // ❌ THE BAD WAY: heavy CPU work on the main thread.
    // While this loop runs, the event loop is FROZEN. Try hitting
    // GET /api/health in another terminal during this request — it will
    // hang until this finishes. That is every user's experience, not just
    // the one who asked for the report.
    let checksum = 0;
    for (let i = 0; i < iterations; i += 1) {
      checksum += Math.sqrt(i) * Math.sin(i);
    }
    const byStatus = tasks.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }), {});
    result = { checksum: Number(checksum.toFixed(2)), byStatus, computedOn: 'main thread (event loop BLOCKED)' };
  } else {
    // ✅ THE GOOD WAY: offload to a worker thread.
    // The main event loop stays free the entire time, so /api/health and
    // every other request are served normally.
    result = await runReportInWorker({ iterations, tasks });
  }

  const durationMs = Number(Number(process.hrtime.bigint() - started) / 1e6).toFixed(1);

  res.json({
    success: true,
    mode,
    durationMs: Number(durationMs),
    data: result,
    tryThis:
      mode === 'blocking'
        ? 'Now call GET /api/health in a second terminal WHILE this runs — it will hang. That is a blocked event loop.'
        : 'Call GET /api/health in a second terminal WHILE this runs — it responds instantly. The main loop is free.',
  });
});

module.exports = { listUsers, overview, changeUserRole, revokeUserSessions, flushCache, generateReport };
