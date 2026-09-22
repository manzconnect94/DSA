# `server/controllers/queryDemoController.js`

> The centrepiece. Implements the **same result twice** — once with every classic mistake, once optimised — so the difference is measurable rather than theoretical.

**Lines:** 631 · **Concept blocks:** 7

> ⚠️ **Seed first:** `npm run seed:big` (50,000 tasks). With 20 documents a COLLSCAN and an IXSCAN are both sub-millisecond and this teaches nothing.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/demo/compare` | Runs both paths, reports the speedup ratio and round-trips saved |
| `GET /api/demo/tasks-slow` | All four mistakes |
| `GET /api/demo/tasks-fast` | All four fixes — **one** query |
| `GET /api/demo/explain` | `.explain("executionStats")`: unindexed vs indexed vs covered |
| `GET /api/demo/populate` | Manual loop vs `.populate()` vs `$lookup`, timed |
| `GET /api/demo/indexes` | Index inventory + `$indexStats` usage counts |

## The four mistakes

| # | Mistake | Cost | Fix |
|---|---|---|---|
| 1 | Filter on unindexed `legacyTag` | **COLLSCAN** — O(n) docs examined | Index it → IXSCAN, ~O(log n) |
| 2 | No `.select()` | 5–20× more I/O, network, CPU | `$project` only needed fields |
| 3 | JS loops instead of aggregation | Transfers everything, blocks the event loop | `$group` in the database |
| 4 | **N+1 queries** | **1 + N round-trips** | `$lookup` |

### Mistake 1 in detail

`legacyTag` has no index, so MongoDB has no sorted structure to seek into — it reads **every** document and tests each one.

- O(n) documents examined. 50,000 examined to return ~500.
- Efficiency ratio **100:1** (healthy is ~1:1).
- ⚠️ It also **evicts your entire working set** from the WiredTiger cache on the way past, slowing every *other* query for a while. A single COLLSCAN has collateral damage.

The indexed equivalent: a B-tree seek, ~16 comparisons instead of 50,000.

### Mistake 4 — the N+1 problem

```js
const tasks = await Task.find(filter);          // 1 query
for (const task of tasks) {
  task.user = await User.findById(task.owner);  // N more queries
}
```

500 tasks = **501 queries**. Each is a full network round-trip. At 1ms each that's 500ms of *pure waiting*; on a cloud database with 5ms latency it's **2.5 seconds**. **The query time is almost irrelevant — LATENCY × COUNT is what kills you.**

It's called N+1 because it's 1 for the list plus N for the children. **It hides well:** with 10 test rows it's imperceptible, and it only surfaces in production.

⭐ **How to spot it:** watch the [Mongoose debug log](../config/db.js.md) and count the lines. If the count scales with your result set, that's an N+1.

## The four fixes, applied

```js
{ $match: { owner: ObjectId, status: {$ne:'archived'} } }  // FIX 1: indexed
{ $sort: { createdAt: -1 } }                               // free — served by index
{ $limit: limit }                                          // ⭐ BEFORE the join
{ $lookup: { from:'users', ..., pipeline:[{$project:{name:1}}] } }  // FIX 4
{ $unwind: { path:'$ownerDoc', preserveNullAndEmptyArrays:true } }
{ $project: { title:1, status:1, ownerName:'$ownerDoc.name' } }     // FIX 2
{ $facet: { rows:[...], statusCounts:[{$group:...}] } }            // FIX 3
```

⭐ **`$limit` before `$lookup`** means you join 200 documents, not 50,000. **Stage order is the single biggest lever in an aggregation.**

Expect **20–100×** on a 50k collection — and the gap *widens* as data grows, because the slow path is O(n) and the fast path is O(log n + k).

### `$lookup` caveats worth naming

- The foreign field **should be indexed** (`_id` is, automatically). Without an index, `$lookup` runs a **COLLSCAN of the foreign collection for every input document** — catastrophically worse than the N+1 you were fixing.
- It produces an **array**, even for 1:1 — hence the `$unwind`.
- `preserveNullAndEmptyArrays` keeps tasks whose owner was deleted. **Without it, this silently becomes an INNER join and drops rows.**
- `from: 'users'` is the **collection** name (lowercase, pluralised), not the model name.
- The `pipeline` form lets you project *inside* the join, so you don't drag whole documents across.

## ⭐ `.populate()` is NOT a join

The most common Mongoose misconception. What it actually does:

```
1. Task.find(...)                                  → 1 query
2. Mongoose collects every distinct `owner` id
3. User.find({ _id: { $in: [...those ids] } })     → 1 more query
4. Stitches them together in JavaScript
```

So it's **2 queries, not N+1** — a genuine, large improvement over a loop. It de-duplicates ids too: 500 tasks owned by 3 users looks up 3 users.

⚠️ **But it can still become N+1, three ways:**

| Way | Example |
|---|---|
| **Inside a loop** | `for (const t of tasks) { await t.populate('owner') }` — batching only happens when called on the *query* |
| **Nested/deep populate** | One extra query **per level**; three levels deep is 4 queries |
| **Inside an async `.map()`** | Same as the loop, harder to see |

**Other costs:** without `.select()` inside populate you pull every field of every related document; a huge `$in` array (10,000 ids) is itself a slow query and can exceed the 16MB command limit; and the stitching happens in JS on the event loop.

### The ranking

| | Round-trips | When |
|---|---|---|
| ❌ Loop + `findById` | 1 + N | Never |
| ✅ `.populate('owner')` | 2 | Idiomatic, readable, correct for most cases. Add `.select()`. |
| ✅✅ `$lookup` | 1 | When already aggregating, when the result set is large, or when you must **filter/sort on joined fields** |

⭐ **That last point is the decider in practice:** `Task.find().populate({ path:'owner', match:{ role:'admin' }})` does **not** return only admin-owned tasks — it returns **all** tasks with `owner: null` on the non-matching ones. You then filter in JS, having already transferred everything. `$lookup` + `$match` does it server-side.

## `.explain("executionStats")`

Three verbosity modes: `queryPlanner` (the chosen plan, without running), **`executionStats`** (runs it, real counts), `allPlansExecution` (also shows rejected plans).

**The four numbers:**

| # | What | Reading it |
|---|---|---|
| 1 | `winningPlan.stage` | `COLLSCAN` ❌ · `IXSCAN` ✅ · `SORT` ❌ (in-memory, **fails above 100MB**) · `PROJECTION_COVERED` ✅✅ · note `SKIP` still **walks** the skipped docs |
| 2 | **`totalDocsExamined` ÷ `nReturned`** | The efficiency ratio — index quality as one number. 100:1 ❌ · 1:1 ✅ · 0 examined = covered ✅✅. Worse than ~10:1 needs attention. |
| 3 | `totalKeysExamined` | If keys ≫ docs, the compound index **field order** is probably wrong (violating [ESR](../models/Task.js.md)) |
| 4 | `executionTimeMillis` | ⚠️ **Noisy** — affected by cache warmth. Run twice. **The document counts are the stable signal.** |

⚠️ Also check `rejectedPlans`: MongoDB **caches the winning plan per query shape**, so a plan chosen when the collection was small can persist and become wrong. `db.tasks.getPlanCache().clear()` forces re-evaluation — a real production diagnostic.

## `$indexStats`

The complement to "add an index". Reports an **access count per index** since the last restart. `ops: 0` after a representative period means the index costs you write throughput, RAM and disk **for nothing** — drop it. Being able to say "I *audit* indexes, not just add them" is a strong signal.

## Interview questions

- **"This endpoint is slow. How do you fix it?"** → Name the four mistakes, then measure with `.explain()`.
- **"What is N+1, and how do you spot it?"** → 1 query + N children; count the query log and see if it scales with result size.
- **"How many queries does `.populate()` make?"** → Two. Then name the three ways it degenerates to N+1.
- **"How do you prove a query uses an index?"** → `.explain("executionStats")`; read the stage and the examined/returned ratio.
- **"Why is `$lookup` sometimes worse than N+1?"** → Unindexed foreign field means a full scan per input document.
- **"How do you find indexes nobody uses?"** → `$indexStats`.

## Related

- [`models/Task.js`](../models/Task.js.md) — ESR, the prefix rule, when indexes hurt
- [`seed.js`](../seed.js.md) — the data this needs
- [`config/db.js`](../config/db.js.md) — the debug hook that makes N+1 visible
- [`client/src/pages/QueryDemoPage.jsx`](../../client/src/pages/QueryDemoPage.jsx.md) — the UI
