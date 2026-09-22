// ============================================================
// 🧠 CONCEPT: Schema design + indexing strategy (the core of the perf demo)
// WHY IT MATTERS (interview angle): indexes are the highest-leverage
//   performance topic in any database interview. This model is deliberately
//   built with SOME fields indexed and SOME NOT, so the slow-vs-fast demo in
//   controllers/queryDemoController.js has a real, measurable difference to
//   show rather than a contrived one.
// HOW IT WORKS HERE: `owner`, `status`, `dueDate` are indexed. `legacyTag`
//   and `description` are deliberately NOT — querying them forces a COLLSCAN.
// ============================================================

const mongoose = require('mongoose');
const config = require('../config/env');

const STATUSES = ['todo', 'in-progress', 'done', 'archived'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title must be at most 200 characters'],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description must be at most 2000 characters'],
      default: '',
      // NOT indexed on purpose. Indexing a long free-text field with a
      // regular B-tree index is nearly useless anyway: it can only serve
      // prefix matches (/^foo/), never /foo/ in the middle. For real text
      // search you need a text index or Atlas Search — see the note at the
      // bottom of this file.
    },

    status: {
      type: String,
      enum: { values: STATUSES, message: '{VALUE} is not a valid status' },
      default: 'todo',
    },

    priority: {
      type: String,
      enum: { values: PRIORITIES, message: '{VALUE} is not a valid priority' },
      default: 'medium',
    },

    // ============================================================
    // 🧠 CONCEPT: Referencing (normalisation) vs embedding (denormalisation)
    // WHY IT MATTERS (interview angle): THE MongoDB data-modelling question.
    //   • EMBED when the child is owned by, and always read with, the parent;
    //     when the array is bounded; when you want a single atomic write.
    //     e.g. a task's 2-3 comments. One read, no join.
    //   • REFERENCE when the child is large, shared between parents, updated
    //     independently, or unbounded in count. A user has unbounded tasks,
    //     and tasks are queried on their own, so tasks reference the user.
    //   The hard limit that decides many arguments: a single BSON document
    //   cannot exceed 16MB. An unbounded embedded array is a time bomb — it
    //   works for two years and then a power user hits the ceiling and
    //   ALL their writes start failing.
    // HOW IT WORKS HERE: `owner` is an ObjectId reference, enabling
    //   .populate() (and the N+1 discussion that comes with it).
    // ============================================================
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // the model name .populate() will look up
      required: true,
      // ============================================================
      // 🧠 CONCEPT: Index every field you filter on, especially foreign keys
      // WHY IT MATTERS (interview angle): MongoDB does NOT create indexes for
      //   references automatically (no foreign-key concept at all). Every
      //   "list this user's tasks" query filters on owner, so without this
      //   index each one is a full collection scan. This single line is the
      //   difference between an IXSCAN of 20 docs and a COLLSCAN of 50,000.
      // ============================================================
      index: true,
    },

    dueDate: {
      type: Date,
      default: null,
      index: true, // range queries ($lt/$gte) need this
    },

    tags: {
      type: [String],
      default: [],
      // ============================================================
      // 🧠 CONCEPT: Multikey indexes
      // WHY IT MATTERS (interview angle): index an ARRAY field and MongoDB
      //   creates a "multikey" index with one index entry PER ARRAY ELEMENT.
      //   A doc with 10 tags produces 10 entries. Consequences: the index is
      //   larger than you expect, writes are more expensive, and you cannot
      //   build a compound index across TWO array fields (the Cartesian
      //   product would explode). Declared in the compound index below.
      // ============================================================
    },

    // ============================================================
    // 🧠 CONCEPT: A deliberately UN-indexed field (the demo's control group)
    // WHY IT MATTERS (interview angle): to demonstrate a slow query you need
    //   a field with no index. Filtering on legacyTag forces MongoDB to read
    //   every document in the collection (COLLSCAN) and test each one — O(n)
    //   in documents examined. The identical query on an indexed field is an
    //   IXSCAN, roughly O(log n) to locate the range.
    // HOW IT WORKS HERE: seed.js populates legacyTag; /api/demo/tasks-slow
    //   filters on it, /api/demo/tasks-fast filters on the indexed `status`.
    // ============================================================
    legacyTag: {
      type: String,
      default: 'none',
      // NO INDEX — this is the point.
    },

    completedAt: {
      type: Date,
      default: null,
    },

    estimatedHours: {
      type: Number,
      min: [0, 'Estimated hours cannot be negative'],
      max: [1000, 'That is not a realistic estimate'],
      default: 1,
    },

    attachment: {
      filename: { type: String, default: null },
      originalName: { type: String, default: null },
      mimeType: { type: String, default: null },
      sizeBytes: { type: Number, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ============================================================
// 🧠 CONCEPT: COMPOUND INDEXES and why FIELD ORDER MATTERS
// WHY IT MATTERS (interview angle): the deepest indexing question you'll get.
//   A compound index is sorted by field 1, then within each field-1 value by
//   field 2, and so on — exactly like a phone book sorted by (lastName,
//   firstName). You can look up "everyone named Smith", and "Smith, John",
//   but you CANNOT efficiently find "everyone named John" — you'd have to
//   read the whole book.
//
//   This is the ESR RULE for ordering compound index fields:
//     E — EQUALITY fields first   (owner: exact match)
//     S — SORT fields next        (createdAt: the order you return in)
//     R — RANGE fields last       (dueDate: $gt/$lt)
//
//   THE PREFIX RULE: an index on { owner, status, createdAt } can serve
//   queries on:
//     ✅ { owner }
//     ✅ { owner, status }
//     ✅ { owner, status, createdAt }
//   but NOT:
//     ❌ { status }             — skips the prefix, so it's a COLLSCAN
//     ❌ { status, createdAt }  — same problem
//   So you do not need a separate index per field combination; you need one
//   per *prefix path*. This is how you avoid over-indexing.
//
//   SORTING FOR FREE: because index entries are stored in sorted order, a
//   query whose sort matches the index order needs no in-memory sort. That
//   matters a lot: MongoDB aborts an in-memory sort that exceeds 100MB with
//   "Sort exceeded memory limit" unless allowDiskUse is on. An indexed sort
//   never hits that wall. Note -1 below: the index direction must match the
//   sort direction (or be its exact inverse, which Mongo can walk backwards).
//
// HOW IT WORKS HERE: the main task-list query is
//   find({ owner, status }).sort({ createdAt: -1 }) — fully served by index #1.
// ============================================================
taskSchema.index({ owner: 1, status: 1, createdAt: -1 }, { name: 'owner_status_createdAt' });

// Supports the "my tasks due soon" query: equality on owner, range on dueDate.
taskSchema.index({ owner: 1, dueDate: 1 }, { name: 'owner_dueDate' });

// Multikey index for tag filtering.
taskSchema.index({ owner: 1, tags: 1 }, { name: 'owner_tags' });

// ============================================================
// 🧠 CONCEPT: Cursor-based pagination needs an index on the cursor field
// WHY IT MATTERS (interview angle): cursor pagination does
//   find({ _id: { $lt: lastSeenId } }).sort({ _id: -1 }).limit(20).
//   That is only fast if the sort/range field is indexed. _id has a unique
//   index automatically, which is exactly why _id is the most common cursor:
//   ObjectIds embed a 4-byte timestamp in their leading bytes, so sorting by
//   _id is *approximately* sorting by creation time — for free.
//   ⚠️ "Approximately" is doing work in that sentence: ObjectId time
//   resolution is 1 second, and the remaining bytes are machine/process/
//   counter, so two docs created in the same second can order arbitrarily
//   relative to wall-clock. Fine for a feed, not for billing.
// ============================================================

// ============================================================
// 🧠 CONCEPT: When an index HURTS — the other half of the answer
// WHY IT MATTERS (interview angle): candidates who only say "add an index"
//   get marked down. Indexes have real costs:
//
//   1. WRITE AMPLIFICATION. Every insert/update/delete must also update
//      EVERY index on the collection. Ten indexes means an insert does
//      eleven B-tree writes. On a write-heavy collection (event logs,
//      metrics, IoT ingest) indexes can halve your throughput. The extreme
//      case is a pure append-only log where you only ever query recent data:
//      fewer indexes is genuinely faster.
//
//   2. RAM. Indexes must fit in the WiredTiger cache to be fast. If your
//      working set of indexes exceeds RAM, the server starts paging from
//      disk and an "indexed" query can be slower than a scan of cached data.
//
//   3. LOW CARDINALITY = USELESS INDEX. An index on a boolean, or on
//      `status` where 95% of rows are 'done', barely narrows anything. The
//      query planner may correctly decide to ignore it, because reading
//      950k index entries and then fetching 950k documents (a random-access
//      pattern) is SLOWER than one sequential COLLSCAN. Rule of thumb: an
//      index pays off when it eliminates roughly 90%+ of the collection.
//      Partial indexes are the fix — index only the rows you actually query:
//        { status: 1 }, { partialFilterExpression: { status: 'todo' } }
//
//   4. DISK AND BACKUP SIZE. Indexes routinely add 20-50% to collection size.
//
//   5. THE PLANNER CAN GET IT WRONG. More candidate indexes means more plans
//      to evaluate, and a cached plan chosen when data was small can become
//      a bad plan as the distribution shifts.
//
//   How to find dead weight: `db.tasks.aggregate([{$indexStats:{}}])` shows
//   an access count per index. An index with `ops: 0` after a week is pure
//   write tax — drop it.
// ============================================================

// ============================================================
// 🧠 CONCEPT: Text index (only ONE allowed per collection)
// WHY IT MATTERS (interview angle): MongoDB permits exactly one text index
//   per collection, though it may span multiple fields. It does stemming and
//   stop-word removal, which is far better than a regex, but it is not a
//   real search engine — no fuzzy matching, no relevance tuning. Beyond
//   basics you move to Atlas Search or Elasticsearch.
//   Left commented out because it competes with the demo's COLLSCAN: with a
//   text index present, the "slow" search would not be slow any more.
// ============================================================
// taskSchema.index({ title: 'text', description: 'text' }, { weights: { title: 10, description: 1 } });

// ============================================================
// 🧠 CONCEPT: Query middleware (pre-hook on a query, not a document)
// WHY IT MATTERS (interview angle): `pre('save')` receives a DOCUMENT and
//   `this` is that document. `pre(/^find/)` receives a QUERY and `this` is
//   the Query object — you cannot touch document fields there, only the
//   filter/options. Mixing them up is a common source of "why isn't my hook
//   running?" (and the answer is often: because findOneAndUpdate is a query
//   operation, not a document one).
// HOW IT WORKS HERE: auto-stamp completedAt whenever status flips to 'done'.
// ============================================================
taskSchema.pre('save', function stampCompletion(next) {
  if (this.isModified('status')) {
    this.completedAt = this.status === 'done' ? new Date() : null;
  }
  next();
});

// A virtual: derived, never stored, and therefore NOT queryable.
taskSchema.virtual('isOverdue').get(function isOverdue() {
  if (!this.dueDate || this.status === 'done') return false;
  return this.dueDate < new Date();
});

if (config.isProd) {
  taskSchema.set('autoIndex', false);
}

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;
module.exports.STATUSES = STATUSES;
module.exports.PRIORITIES = PRIORITIES;
