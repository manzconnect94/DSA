# `server/models/Task.js`

> The domain object, and the **indexing strategy** the whole performance demo depends on. The most database-dense file in the project.

**Lines:** 263 · **Concept blocks:** 10

## Schema

| Field | Indexed? | Notes |
|---|---|---|
| `title` | no | max 200 |
| `description` | **no, deliberately** | A B-tree index on long free text only serves prefix matches |
| `status` | via compound | `enum` of 4 |
| `priority` | no | `enum` of 4 |
| `owner` | **yes** | `ObjectId` ref to User. The IDOR scoping field. |
| `dueDate` | **yes** | Range queries need it |
| `tags` | **yes (multikey)** | Array |
| **`legacyTag`** | **⚠️ NO — the control group** | This is what makes the COLLSCAN demo real |
| `estimatedHours`, `completedAt`, `attachment` | no | |

## Indexes

```js
{ owner: 1, status: 1, createdAt: -1 }   // the main list query
{ owner: 1, dueDate: 1 }                 // "my tasks due soon"
{ owner: 1, tags: 1 }                    // multikey
```

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Schema design + indexing strategy** | Built with *some* fields indexed and some not, so the [slow/fast demo](../controllers/queryDemoController.js.md) has a real, measurable difference. |
| **Referencing vs embedding** | ⭐ **Embed** when the child is owned by and always read with the parent, and the array is bounded. **Reference** when it's large, shared, independently queried, or unbounded. The decider: **a BSON document cannot exceed 16MB** — an unbounded embedded array works for two years, then a power user hits the ceiling and *all* their writes fail. |
| **Index every field you filter on** | MongoDB creates **no** index for a reference (no foreign-key concept at all). Every "list this user's tasks" filters on `owner`, so without the index each one is a full scan. One line = IXSCAN of 20 vs COLLSCAN of 50,000. |
| **Multikey indexes** | Indexing an array creates **one index entry per element** — a doc with 10 tags produces 10 entries. Larger index, more expensive writes, and you **cannot** build a compound index across two array fields. |
| **A deliberately un-indexed field** | To demonstrate a slow query you need a field with no index. `legacyTag` is it. |
| **⭐ Compound indexes & field ORDER** | See below — the deepest indexing question you'll get. |
| **Cursor pagination needs an indexed cursor field** | `_id` is the most common cursor precisely because it has a unique index automatically **and** embeds a 4-byte timestamp, so sorting by `_id` approximates creation order for free. ⚠️ "Approximates": resolution is 1 second, so same-second docs can order arbitrarily. Fine for a feed, not for billing. |
| **⭐ When an index HURTS** | See below. |
| **Text index** | Only **one** per collection (may span fields). Does stemming and stop-words — far better than regex, but not a search engine. Left commented out because it would make the "slow" search fast and break the demo. |
| **Query middleware** | `pre('save')` gets a *document*; `pre(/^find/)` gets a *Query*. Mixing them up is a common "why isn't my hook running?" |

## ⭐ Compound indexes: the ESR rule

A compound index is sorted by field 1, then within each value by field 2 — exactly like a phone book sorted by (lastName, firstName). You can find "Smith" and "Smith, John", but **not** "everyone named John".

**Order fields by ESR:**

| | Meaning | Example |
|---|---|---|
| **E** | **Equality** first | `owner`, `status` |
| **S** | **Sort** next | `createdAt` |
| **R** | **Range** last | `dueDate` (`$gt`/`$lt`) |

**The prefix rule** — `{ owner, status, createdAt }` serves:

| Query | Served? |
|---|---|
| `{ owner }` | ✅ |
| `{ owner, status }` | ✅ |
| `{ owner, status, createdAt }` | ✅ |
| `{ status }` | ❌ skips the prefix → COLLSCAN |
| `{ status, createdAt }` | ❌ same |

So you need one index **per prefix path**, not per field combination. That's how you avoid over-indexing.

**Sorting for free:** index entries are already sorted, so a matching sort needs no in-memory sort. That matters — MongoDB **aborts** an in-memory sort above 100MB with "Sort exceeded memory limit" unless `allowDiskUse` is on. Note the `-1`: index direction must match the sort (or be its exact inverse, which Mongo can walk backwards).

## ⭐ When an index hurts

Candidates who only say "add an index" get marked down. Five real costs:

| Cost | Detail |
|---|---|
| **Write amplification** | Every insert/update/delete must update **every** index. Ten indexes = eleven B-tree writes per insert. On write-heavy collections (logs, metrics, IoT) this can halve throughput. |
| **RAM** | Indexes must fit the WiredTiger cache. Exceed RAM and an "indexed" query can be slower than scanning cached data. |
| **Low cardinality = useless** | An index on a boolean, or on `status` where 95% are `'done'`, barely narrows anything. The planner may correctly **ignore** it, because reading 950k index entries then fetching 950k documents (random access) is slower than one sequential COLLSCAN. **Rule of thumb: an index pays off when it eliminates ~90%+ of the collection.** Fix with a partial index. |
| **Disk & backup size** | Routinely +20–50%. |
| **Planner mistakes** | More candidates to evaluate, and a cached plan chosen when data was small can become wrong. |

**Finding dead weight:** `db.tasks.aggregate([{$indexStats:{}}])` gives an access count per index. `ops: 0` after a week is pure write tax — drop it. Exposed at [`/api/demo/indexes`](../controllers/queryDemoController.js.md).

## API

| Member | Purpose |
|---|---|
| `pre('save')` | Stamps `completedAt` when status flips to/from `done` |
| `isOverdue` | Virtual — not queryable |
| `Task.STATUSES` / `Task.PRIORITIES` | Exported for [validation](../middleware/validate.js.md) |

## Interview questions

- **"How do you order fields in a compound index?"** → ESR: equality, sort, range. Explain the phone-book analogy and the prefix rule.
- **"Does an index on `{a,b,c}` help a query on `{b}`?"** → No — it skips the prefix.
- **"Why not index everything?"** → Write amplification, RAM, low-cardinality uselessness, disk, planner confusion. Audit with `$indexStats`.
- **"When do you embed vs reference?"** → Bounded/co-read → embed. Unbounded/shared/independently-queried → reference. 16MB is the hard limit.
- **"What's a multikey index and what does it cost?"** → One entry per array element; bigger index, costlier writes, no compound across two arrays.
- **"Your sort query suddenly fails in production."** → In-memory sort exceeded 100MB. Add an index matching the sort order.

## Related

- [`controllers/queryDemoController.js`](../controllers/queryDemoController.js.md) — where these indexes are proven with `.explain()`
- [`controllers/taskController.js`](../controllers/taskController.js.md) — the queries these indexes serve
- [`seed.js`](../seed.js.md) — `legacyTag` cardinality, and building indexes after a bulk load
