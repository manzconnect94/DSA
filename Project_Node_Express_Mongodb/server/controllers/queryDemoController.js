// ============================================================
// 🧠 CONCEPT: SLOW QUERY vs FAST QUERY — the dedicated deep dive
// WHY IT MATTERS (interview angle): "This endpoint is slow. How do you fix
//   it?" is the most common practical backend question there is. This file
//   implements the SAME RESULT twice — once with every classic mistake, once
//   optimised — so the difference is measurable rather than theoretical.
//
//   Run seed.js first (10,000+ tasks), then hit:
//     GET /api/demo/tasks-slow     -> the four mistakes
//     GET /api/demo/tasks-fast     -> the four fixes
//     GET /api/demo/compare        -> runs both and reports the speedup
//     GET /api/demo/explain        -> raw .explain('executionStats') output
//     GET /api/demo/indexes        -> index list + $indexStats usage counts
//
//   THE FOUR MISTAKES DEMONSTRATED, and what each costs:
//
//   1. NO INDEX on the filtered field        -> COLLSCAN, O(n) docs examined
//   2. NO PROJECTION (fetching every field)  -> wasted I/O, network, CPU
//   3. JS LOOPS instead of aggregation       -> data pulled to the app tier
//   4. N+1 QUERIES instead of a join         -> 1 + N network round-trips
//
//   Mistake 4 is usually the largest by far, because network round-trips
//   dominate everything else.
// ============================================================

const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const ms = (startBigInt) => Number(Number(process.hrtime.bigint() - startBigInt) / 1e6).toFixed(2);

// ==================================================================
// THE SLOW VERSION — every mistake, deliberately
// GET /api/demo/tasks-slow
// ==================================================================
// ============================================================
// 🧠 CONCEPT: What actually makes a query slow
// WHY IT MATTERS (interview angle): the analysis below is the answer you
//   want to be able to give, in these terms.
//
//   ── MISTAKE 1: FILTERING ON AN UNINDEXED FIELD ────────────────────
//   `legacyTag` has no index (see models/Task.js). MongoDB therefore has no
//   sorted structure to seek into, so it performs a COLLSCAN: read EVERY
//   document in the collection and test each one.
//     • Complexity: O(n) documents examined, where n = collection size.
//     • With 50,000 tasks it examines 50,000 to return maybe 500.
//     • The efficiency ratio (examined ÷ returned) is 100:1. Healthy is ~1:1.
//     • It also evicts your entire working set from the WiredTiger cache on
//       the way past, slowing down every OTHER query for a while. A single
//       COLLSCAN has collateral damage.
//   The indexed equivalent is an IXSCAN: a B-tree seek, O(log n) to find the
//   range start, then a sequential walk of only the matching entries.
//   50,000 docs -> ~16 comparisons instead of 50,000.
//
//   ── MISTAKE 2: NO PROJECTION ──────────────────────────────────────
//   `.find(filter)` with no `.select()` returns every field, including the
//   2KB description we never use. Costs: more disk read, more BSON to
//   decode (CPU), more bytes over the network, more memory, and a bigger
//   JSON serialisation at the end. Typically 5-20x more data than needed.
//   Worse, it forfeits the chance of a COVERED QUERY — where every field
//   requested lives in the index, so MongoDB never touches the documents at
//   all (`totalDocsExamined: 0`).
//
//   ── MISTAKE 3: AGGREGATING IN JAVASCRIPT ──────────────────────────
//   Pulling all matching documents to the app and reducing them in a JS
//   loop means: transferring N documents over the network instead of a
//   handful of summary rows; allocating all of them in the V8 heap; and
//   BLOCKING THE EVENT LOOP while you iterate, which stalls every other
//   concurrent request. The database is a purpose-built, C++-optimised
//   aggregation engine sitting right next to the data — use it.
//
//   ── MISTAKE 4: THE N+1 QUERY PROBLEM ──────────────────────────────
//   The single most common performance bug in ORM/ODM code, and the one
//   most likely to come up:
//
//       const tasks = await Task.find(filter);          // 1 query
//       for (const task of tasks) {
//         task.user = await User.findById(task.owner);  // N more queries
//       }
//
//   500 tasks = 501 queries. Each is a full network round-trip. Even at a
//   fast 1ms each, that is 500ms of pure waiting — and on a cloud database
//   with 5ms latency it is 2.5 SECONDS. The query time itself is almost
//   irrelevant; LATENCY × COUNT is what kills you.
//
//   It is called "N+1" because it is 1 query for the list plus N for the
//   children. It hides well: with 10 test rows it is imperceptible, and it
//   only surfaces in production with real data volumes.
//
//   THE FIXES:
//     (a) $lookup in an aggregation      -> 1 query, joined server-side
//     (b) .populate()                    -> 2 queries total (see caveat below)
//     (c) manual batch: collect the ids, one `$in` query, build a Map
//   All three turn N+1 into a constant number of round-trips.
//
//   ⚠️ HOW TO SPOT IT: watch the Mongoose debug log (enabled in dev in
//   config/db.js) and count the lines. If the count scales with your result
//   set, you have an N+1.
// ============================================================
const tasksSlow = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const totalStart = process.hrtime.bigint();
  const timings = {};

  // ---- MISTAKE 1 + 2: unindexed filter, and no projection ----
  const t1 = process.hrtime.bigint();
  const tasks = await Task.find({
    legacyTag: 'batch-import', // ❌ NO INDEX on this field -> COLLSCAN
    status: { $ne: 'archived' },
  })
    // ❌ No .select()  -> every field, including the big description
    // ❌ No .lean()    -> every doc hydrated into a full Mongoose Document
    .limit(limit);
  timings.fetchMs = ms(t1);

  // ---- MISTAKE 4: N+1 — one query per task ----
  const t2 = process.hrtime.bigint();
  const enriched = [];
  let queryCount = 1; // the find() above

  for (const task of tasks) {
    // ❌ A separate DB round-trip for EVERY task, inside a loop, awaited
    // sequentially. This is the N+1. Note it is also SEQUENTIAL — each
    // await waits for the previous one, so the latencies add up rather
    // than overlapping.
    const owner = await User.findById(task.owner).select('name email');
    queryCount += 1;

    enriched.push({
      id: task._id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimatedHours: task.estimatedHours,
      ownerName: owner?.name || 'unknown',
      ownerEmail: owner?.email || null,
    });
  }
  timings.n1LoopMs = ms(t2);

  // ---- MISTAKE 3: grouping and summing in JavaScript ----
  const t3 = process.hrtime.bigint();
  const statusCounts = {};
  const hoursByStatus = {};
  for (const row of enriched) {
    // ❌ An O(n) JS loop over data that should never have left the database.
    // This runs ON THE EVENT LOOP, so every other request is blocked while
    // it executes.
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    hoursByStatus[row.status] = (hoursByStatus[row.status] || 0) + (row.estimatedHours || 0);
  }
  timings.jsAggregationMs = ms(t3);

  timings.totalMs = ms(totalStart);

  logger.warn(`[demo] SLOW path: ${queryCount} DB queries, ${timings.totalMs}ms total`);

  res.json({
    success: true,
    variant: 'SLOW',
    data: enriched.slice(0, 20), // truncated for readability
    diagnostics: {
      dbQueryCount: queryCount,
      documentsReturned: enriched.length,
      timings,
      statusCounts,
      hoursByStatus,
      mistakes: [
        '1. Filtered on `legacyTag`, which has NO INDEX -> COLLSCAN, O(n) docs examined',
        '2. No .select() projection -> every field fetched, including the 2KB description',
        '3. No .lean() -> every result hydrated into a full Mongoose Document (CPU + memory)',
        `4. N+1: ${queryCount - 1} separate User lookups inside a loop, awaited sequentially`,
        '5. Grouping done in a JS loop on the event loop instead of in the database',
      ],
    },
  });
});

// ==================================================================
// THE FAST VERSION — identical result, every mistake fixed
// GET /api/demo/tasks-fast
// ==================================================================
// ============================================================
// 🧠 CONCEPT: The four fixes, applied
// WHY IT MATTERS (interview angle): note that the fixes are mechanical once
//   you can name the problems. That is the point of being able to name them.
//
//   FIX 1 — filter on an INDEXED field (`owner` + `status`, which the
//           compound index { owner, status, createdAt } serves). IXSCAN
//           instead of COLLSCAN: ~O(log n) instead of O(n).
//   FIX 2 — `$project` / `.select()` only the fields actually used. Less
//           disk I/O, less network, less CPU decoding BSON.
//   FIX 3 — `$group` inside the database. The aggregation happens in C++,
//           next to the data, and only summary rows cross the network.
//   FIX 4 — `$lookup` joins Users server-side. ONE round-trip replaces N+1.
//
//   Expect roughly 20-100x on a 50k-document collection — and the gap WIDENS
//   as the collection grows, because the slow path is O(n) and the fast path
//   is O(log n + k).
// ============================================================
const tasksFast = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const totalStart = process.hrtime.bigint();

  // One aggregation pipeline replaces: 1 find + N user lookups + 2 JS loops.
  const pipeline = [
    // ---- FIX 1: $match FIRST, on INDEXED fields ----
    // ⭐ Only a $match in the first stage can use an index. Moving this
    // after $lookup would make the whole pipeline a scan.
    {
      $match: {
        owner: new mongoose.Types.ObjectId(String(req.user.id)), // indexed
        status: { $ne: 'archived' }, // part of the compound index
      },
    },

    // ---- Limit EARLY, before the expensive join ----
    // ⭐ $limit placed before $lookup means we join 200 documents, not
    // 50,000. Stage order is the single biggest lever in an aggregation.
    { $sort: { createdAt: -1 } }, // served by the index, so it is free
    { $limit: limit },

    // ---- FIX 4: $lookup replaces the N+1 loop ----
    // ============================================================
    // 🧠 CONCEPT: $lookup — a server-side LEFT OUTER JOIN
    // WHY IT MATTERS (interview angle): $lookup does the join inside
    //   MongoDB, so N round-trips collapse into one. Know the caveats,
    //   because "just use $lookup" invites them:
    //   • The foreign field SHOULD BE INDEXED (_id is, automatically).
    //     Without an index, $lookup runs a COLLSCAN of the foreign
    //     collection FOR EVERY INPUT DOCUMENT — catastrophically worse than
    //     the N+1 you were fixing.
    //   • It produces an ARRAY, even for a one-to-one relationship, hence
    //     the $unwind (or $arrayElemAt) that follows.
    //   • In a sharded cluster $lookup has real restrictions and costs.
    //   • The `pipeline` form (used here) lets you PROJECT INSIDE the join,
    //     so you don't drag the whole user document in just to read a name.
    // ============================================================
    {
      $lookup: {
        from: 'users', // ⚠️ the COLLECTION name (lowercase, pluralised), not the model name
        localField: 'owner',
        foreignField: '_id',
        as: 'ownerDoc',
        // Project inside the sub-pipeline: only two fields cross the join.
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },

    // $lookup always yields an array; flatten the single match.
    // preserveNullAndEmptyArrays keeps tasks whose owner was deleted —
    // without it this silently becomes an INNER join and drops rows.
    { $unwind: { path: '$ownerDoc', preserveNullAndEmptyArrays: true } },

    // ---- FIX 2: project only what the client needs ----
    {
      $project: {
        _id: 1,
        title: 1,
        status: 1,
        priority: 1,
        estimatedHours: 1,
        ownerName: '$ownerDoc.name',
        ownerEmail: '$ownerDoc.email',
        // Note: `description` is deliberately absent.
      },
    },

    // ---- FIX 3: group in the database, via $facet so we still get rows ----
    {
      $facet: {
        rows: [{ $limit: 20 }],
        statusCounts: [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalHours: { $sum: '$estimatedHours' },
            },
          },
        ],
        totals: [{ $count: 'documentsReturned' }],
      },
    },
  ];

  const [result] = await Task.aggregate(pipeline);
  const totalMs = ms(totalStart);

  logger.info(`[demo] FAST path: 1 DB query, ${totalMs}ms total`);

  res.json({
    success: true,
    variant: 'FAST',
    data: result.rows,
    diagnostics: {
      dbQueryCount: 1, // <- the headline number
      documentsReturned: result.totals[0]?.documentsReturned || 0,
      timings: { totalMs },
      statusCounts: result.statusCounts.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {}),
      hoursByStatus: result.statusCounts.reduce((acc, r) => ({ ...acc, [r._id]: r.totalHours }), {}),
      fixes: [
        '1. Filtered on INDEXED fields (owner + status) -> IXSCAN instead of COLLSCAN',
        '2. $project fetches only the 6 fields actually used',
        '3. $group runs inside MongoDB (C++, next to the data) — the event loop stays free',
        '4. $lookup joins Users server-side: ONE round-trip instead of N+1',
        '5. $sort + $limit placed BEFORE $lookup, so we join 200 docs rather than 50,000',
      ],
    },
  });
});

// ==================================================================
// GET /api/demo/compare — run both and report the speedup
// ==================================================================
const compare = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const ownerId = new mongoose.Types.ObjectId(String(req.user.id));

  // ---- SLOW ----
  const slowStart = process.hrtime.bigint();
  let slowQueries = 1;
  const slowTasks = await Task.find({ owner: ownerId, status: { $ne: 'archived' } }).limit(limit);
  for (const task of slowTasks) {
    await User.findById(task.owner).select('name');
    slowQueries += 1;
  }
  const slowCounts = {};
  for (const t of slowTasks) slowCounts[t.status] = (slowCounts[t.status] || 0) + 1;
  const slowMs = Number(ms(slowStart));

  // ---- FAST ----
  const fastStart = process.hrtime.bigint();
  const fastResult = await Task.aggregate([
    { $match: { owner: ownerId, status: { $ne: 'archived' } } },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'o', pipeline: [{ $project: { name: 1 } }] } },
    { $unwind: { path: '$o', preserveNullAndEmptyArrays: true } },
    { $project: { title: 1, status: 1, ownerName: '$o.name' } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const fastMs = Number(ms(fastStart));

  res.json({
    success: true,
    comparison: {
      slow: { timeMs: slowMs, dbQueries: slowQueries, docsProcessed: slowTasks.length },
      fast: { timeMs: fastMs, dbQueries: 1, docsProcessed: limit },
      speedup: fastMs > 0 ? `${(slowMs / fastMs).toFixed(1)}x faster` : 'n/a',
      roundTripsSaved: slowQueries - 1,
      note:
        'Seed more data (npm run seed:big) to widen the gap. The slow path is O(n) in ' +
        'round-trips, so it degrades LINEARLY with result size while the fast path stays flat.',
    },
    fastStatusCounts: fastResult.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {}),
    slowStatusCounts: slowCounts,
  });
});

// ==================================================================
// GET /api/demo/explain — reading .explain('executionStats')
// ==================================================================
// ============================================================
// 🧠 CONCEPT: .explain("executionStats") — how you PROVE a query is slow
// WHY IT MATTERS (interview angle): "how do you know it's the index?" —
//   guessing is not an answer. explain() is. Know the three verbosity modes
//   and, more importantly, the four numbers to read.
//
//   THE MODES:
//     'queryPlanner'          (default) — the plan the optimiser CHOSE,
//                                         without running the query.
//     'executionStats'        — ⭐ runs it and reports real counts/timings.
//     'allPlansExecution'     — also shows the rejected candidate plans and
//                               why the winner won.
//
//   HOW TO RUN IT:
//     // in mongosh:
//     db.tasks.find({ legacyTag: "batch-import" }).explain("executionStats")
//     // in Mongoose:
//     await Task.find({ legacyTag: 'batch-import' }).explain('executionStats')
//
//   ⭐ THE FOUR NUMBERS THAT MATTER:
//
//   1. winningPlan.stage — THE HEADLINE
//      • COLLSCAN  ❌ full collection scan. No usable index. Fix it.
//      • IXSCAN    ✅ index scan. Good.
//      • FETCH     — follows an IXSCAN to load the full documents. Normal,
//                    but its ABSENCE is better (see #4).
//      • SORT      ❌ an IN-MEMORY sort. Means no index satisfied your
//                    sort order. Fails outright above 100MB. Add an index
//                    matching the sort, or you are one traffic spike from
//                    "Sort exceeded memory limit".
//      • PROJECTION_COVERED ✅✅ the best case — answered from the index
//                    alone, documents never read.
//      • LIMIT / SKIP — note that a SKIP stage still WALKS the skipped
//                    documents. This is offset pagination's O(offset) cost,
//                    visible in the plan.
//
//   2. totalDocsExamined vs nReturned — THE EFFICIENCY RATIO
//      The single most diagnostic pair of numbers.
//        examined 50,000 / returned 500  = 100:1  ❌ terrible
//        examined 500    / returned 500  = 1:1    ✅ ideal
//        examined 0      / returned 500  = covered query ✅✅
//      Anything worse than roughly 10:1 deserves investigation. This ratio
//      is index quality expressed as one number.
//
//   3. totalKeysExamined
//      Index entries scanned. Compare to totalDocsExamined: if keys ≈ docs,
//      the index is selective and doing its job. If keys >> docs, the index
//      is being scanned broadly and then filtered — often a sign that the
//      compound index field ORDER is wrong (violating the ESR rule).
//
//   4. executionTimeMillis
//      Wall-clock time. ⚠️ Treat with care: it is affected by cache warmth.
//      Run the query twice — the first may read from disk, the second from
//      the WiredTiger cache. The DOCUMENT COUNTS are the stable signal;
//      timing is the noisy one.
//
//   ⚠️ ALSO WORTH KNOWING: `rejectedPlans` shows what the optimiser
//   considered and discarded. MongoDB CACHES the winning plan per query
//   SHAPE, so a plan chosen when the collection was small can persist and
//   become wrong as the data grows. `db.tasks.getPlanCache().clear()` forces
//   a re-evaluation — this is a real production diagnostic.
//
// HOW IT WORKS HERE: runs explain on both the unindexed and the indexed
//   query and returns the key numbers side by side.
// ============================================================
const explainQueries = asyncHandler(async (req, res) => {
  const ownerId = new mongoose.Types.ObjectId(String(req.user.id));

  const pick = (plan) => {
    const exec = plan.executionStats || {};
    const winning = plan.queryPlanner?.winningPlan || {};
    // The plan is a nested tree; walk down to the leaf stage.
    const leafStage = (node) => (node?.inputStage ? leafStage(node.inputStage) : node?.stage);

    return {
      winningStage: winning.stage,
      leafStage: leafStage(winning),
      indexUsed: winning.inputStage?.indexName || winning.queryPlan?.inputStage?.indexName || null,
      nReturned: exec.nReturned,
      totalDocsExamined: exec.totalDocsExamined,
      totalKeysExamined: exec.totalKeysExamined,
      executionTimeMillis: exec.executionTimeMillis,
      efficiencyRatio:
        exec.nReturned > 0 ? `${(exec.totalDocsExamined / exec.nReturned).toFixed(1)} docs examined per doc returned` : 'n/a',
    };
  };

  // ❌ UNINDEXED — expect COLLSCAN and a terrible ratio.
  const slowPlan = await Task.find({ legacyTag: 'batch-import' }).explain('executionStats');

  // ✅ INDEXED — expect IXSCAN and a ratio near 1:1.
  const fastPlan = await Task.find({ owner: ownerId, status: 'todo' }).explain('executionStats');

  // ✅✅ COVERED — every projected field is in the index, so totalDocsExamined
  // should be 0 (the documents are never read at all).
  const coveredPlan = await Task.find({ owner: ownerId, status: 'todo' })
    .select({ _id: 0, owner: 1, status: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .explain('executionStats');

  res.json({
    success: true,
    howToRead: {
      COLLSCAN: '❌ Full collection scan — no index used. O(n).',
      IXSCAN: '✅ Index scan — B-tree seek. O(log n) to locate the range.',
      SORT: '❌ In-memory sort — no index matched the sort order. Fails above 100MB.',
      PROJECTION_COVERED: '✅✅ Answered from the index alone; documents never touched.',
      efficiencyRatio: 'totalDocsExamined ÷ nReturned. 1:1 is ideal; worse than 10:1 needs attention.',
    },
    slowQuery: {
      description: "find({ legacyTag: 'batch-import' }) — legacyTag has NO index",
      ...pick(slowPlan),
    },
    fastQuery: {
      description: "find({ owner, status: 'todo' }) — uses the owner_status_createdAt compound index",
      ...pick(fastPlan),
    },
    coveredQuery: {
      description: 'Same filter, but projecting ONLY indexed fields — expect totalDocsExamined: 0',
      ...pick(coveredPlan),
    },
  });
});

// ==================================================================
// GET /api/demo/indexes — what indexes exist, and are they used?
// ==================================================================
// ============================================================
// 🧠 CONCEPT: $indexStats — finding indexes that are pure dead weight
// WHY IT MATTERS (interview angle): the complement to "add an index". Every
//   index taxes every write (see the "when an index HURTS" block in
//   models/Task.js). $indexStats reports an ACCESS COUNT per index since the
//   last server restart. An index with `ops: 0` after a representative
//   period is costing you write throughput, RAM and disk for nothing —
//   drop it. Being able to say "I audit indexes with $indexStats, not just
//   add them" is a strong signal.
// ============================================================
const indexInfo = asyncHandler(async (_req, res) => {
  const [indexes, stats] = await Promise.all([
    Task.collection.indexes(),
    Task.collection.aggregate([{ $indexStats: {} }]).toArray(),
  ]);

  const usageByName = stats.reduce((acc, s) => ({ ...acc, [s.name]: s.accesses?.ops ?? 0 }), {});

  res.json({
    success: true,
    collection: 'tasks',
    indexes: indexes.map((idx) => ({
      name: idx.name,
      keys: idx.key,
      unique: Boolean(idx.unique),
      timesUsedSinceRestart: usageByName[idx.name] ?? 0,
      verdict:
        (usageByName[idx.name] ?? 0) === 0 && idx.name !== '_id_'
          ? '⚠️ unused since restart — candidate for removal (it still taxes every write)'
          : '✅ in use',
    })),
    notIndexed: {
      legacyTag: 'Deliberately unindexed so /api/demo/tasks-slow produces a real COLLSCAN.',
      description: 'A B-tree index on long free text is near-useless — it only serves prefix matches.',
    },
    compoundIndexNote:
      'owner_status_createdAt follows the ESR rule: Equality (owner, status), Sort (createdAt), Range last. ' +
      'It serves queries on {owner}, {owner,status} and {owner,status,createdAt} — but NOT {status} alone, ' +
      'because that skips the index prefix.',
  });
});

// ==================================================================
// GET /api/demo/populate — populate() vs manual join vs $lookup
// ==================================================================
// ============================================================
// 🧠 CONCEPT: .populate() — what it REALLY does, and how it still N+1s
// WHY IT MATTERS (interview angle): the most common misconception about
//   Mongoose. People assume populate() is a database JOIN. IT IS NOT.
//
//   MongoDB does not join on a normal find(). What populate() actually does
//   is run a SECOND QUERY from your application:
//
//     1. Task.find(...)                              -> 1 query
//     2. Mongoose collects every distinct `owner` id
//     3. User.find({ _id: { $in: [ ...those ids ] } }) -> 1 more query
//     4. It stitches the results together in JavaScript
//
//   So populate() is 2 queries, not N+1 — and that is a genuine, large
//   improvement over a loop. It de-duplicates ids too, so 500 tasks owned
//   by 3 users triggers a lookup of only 3 users.
//
//   ⚠️ BUT IT CAN STILL BECOME N+1, IN THREE WAYS — and this is the part
//   interviewers actually probe:
//
//   (a) POPULATE INSIDE A LOOP. The classic:
//         for (const task of tasks) { await task.populate('owner'); }
//       You have manually reconstructed N+1. populate() batches ONLY when
//       called on the query, not per-document.
//
//   (b) NESTED / DEEP POPULATE. `.populate({ path: 'owner', populate:
//       { path: 'team' } })` is one extra query PER LEVEL. Three levels
//       deep is 4 queries — and each level's $in can be enormous.
//
//   (c) POPULATING INSIDE A .map() OF ASYNC CALLS — same as (a), just
//       harder to see.
//
//   ⚠️ OTHER COSTS WORTH NAMING:
//   • Without `.select()` inside populate, you pull EVERY field of every
//     related document. Populating an author onto 500 posts without a
//     projection can transfer megabytes you discard.
//   • A huge `$in` array (10,000 ids) is itself a slow query and can
//     exceed the 16MB BSON command limit.
//   • The stitching happens in JS, on the event loop.
//
//   ── THE THREE APPROACHES, RANKED ──────────────────────────────────
//   1. ❌ Loop with findById   -> 1 + N round-trips. Never do this.
//   2. ✅ .populate('owner')   -> 2 round-trips. Idiomatic, readable, and
//                                 correct for most cases. Add .select().
//   3. ✅✅ $lookup aggregation -> 1 round-trip. Best when you are already
//                                 aggregating, need to FILTER OR SORT ON
//                                 THE JOINED FIELDS (populate cannot do
//                                 that — it happens after the fact), or the
//                                 result set is large.
//
//   The "populate can't filter on joined fields" point is the deciding one
//   in practice: `Task.find().populate({ path:'owner', match:{ role:'admin' }})`
//   does NOT return only admin-owned tasks — it returns ALL tasks with
//   `owner: null` on the non-matching ones. You then filter in JS, having
//   already transferred everything. $lookup + $match does it server-side.
//
// HOW IT WORKS HERE: all three run against the same data, timed.
// ============================================================
const populateDemo = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const ownerId = new mongoose.Types.ObjectId(String(req.user.id));
  const filter = { owner: ownerId };

  // ---- 1. ❌ Manual loop: 1 + N queries ----
  const t1 = process.hrtime.bigint();
  const loopTasks = await Task.find(filter).select('title owner').limit(limit).lean();
  let loopQueries = 1;
  for (const task of loopTasks) {
    await User.findById(task.owner).select('name').lean();
    loopQueries += 1;
  }
  const loopMs = Number(ms(t1));

  // ---- 2. ✅ populate(): exactly 2 queries ----
  const t2 = process.hrtime.bigint();
  const populated = await Task.find(filter)
    .select('title owner')
    .limit(limit)
    // ⭐ ALWAYS pass select inside populate. Without it you fetch every
    // field of every related user — including the password hash, were it
    // not for select:false on the model.
    .populate({ path: 'owner', select: 'name email' })
    .lean();
  const populateMs = Number(ms(t2));

  // ---- 3. ✅✅ $lookup: exactly 1 query ----
  const t3 = process.hrtime.bigint();
  const looked = await Task.aggregate([
    { $match: filter },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: 'owner',
        foreignField: '_id',
        as: 'owner',
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
    { $project: { title: 1, 'owner.name': 1, 'owner.email': 1 } },
  ]);
  const lookupMs = Number(ms(t3));

  res.json({
    success: true,
    results: {
      manualLoop: {
        dbQueries: loopQueries,
        timeMs: loopMs,
        verdict: '❌ N+1 — round-trips scale linearly with result size',
      },
      populate: {
        dbQueries: 2,
        timeMs: populateMs,
        verdict: '✅ Two queries: the find, then one $in for all distinct owner ids',
      },
      lookup: {
        dbQueries: 1,
        timeMs: lookupMs,
        verdict: '✅✅ One query, joined server-side. Can also filter/sort on joined fields.',
      },
    },
    speedups: {
      populateVsLoop: populateMs > 0 ? `${(loopMs / populateMs).toFixed(1)}x` : 'n/a',
      lookupVsLoop: lookupMs > 0 ? `${(loopMs / lookupMs).toFixed(1)}x` : 'n/a',
    },
    sample: { populate: populated.slice(0, 3), lookup: looked.slice(0, 3) },
    keyInsight:
      'populate() is NOT a database join — it is a second query issued by Mongoose and ' +
      'stitched together in JavaScript. It becomes N+1 the moment you call it inside a loop.',
  });
});

module.exports = { tasksSlow, tasksFast, compare, explainQueries, indexInfo, populateDemo };
