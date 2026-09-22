# `client/src/pages/QueryDemoPage.jsx`

> A UI for the backend's slow-vs-fast query demos. Click a button, see real numbers from your own machine.

**Lines:** 140 · **Concept blocks:** 2 · **Route:** `/demo` (lazy)

## What it does

Six buttons, each calling one [`/api/demo/*`](../../../server/controllers/queryDemoController.js.md) endpoint and rendering the JSON response with a client-measured round-trip time alongside the server's own timings.

| Button | Endpoint | Shows |
|---|---|---|
| ⚡ **Run the comparison** | `/demo/compare` | The **speedup ratio** and round-trips saved |
| 🐌 Slow path | `/demo/tasks-slow` | COLLSCAN + no projection + no `.lean()` + N+1 + JS aggregation |
| 🚀 Fast path | `/demo/tasks-fast` | IXSCAN + `$project` + `$lookup` + `$group` — **one query** |
| 🔍 explain | `/demo/explain` | `.explain("executionStats")` — unindexed vs indexed vs **covered** |
| 🔗 populate | `/demo/populate` | Loop vs `.populate()` vs `$lookup`, timed |
| 📇 indexes | `/demo/indexes` | Index inventory + `$indexStats` usage counts |

⭐ **Start with "Run the comparison"** — it's the single headline number.

## ⚠️ Seed data first

The page leads with a callout, because the demo is meaningless without it:

```
cd server && npm run seed:big     # 50,000 tasks
```

⭐ **With only a handful of documents, a COLLSCAN and an IXSCAN are both sub-millisecond and these numbers mean nothing.**

That's itself the lesson: **performance bugs don't appear in dev, they appear in production, because production is where the data is.** See [`seed.js`](../../../server/seed.js.md).

## ⭐ The reading legend

An open `<details>` explaining what to look for — because the numbers only teach you something if you know which ones matter:

| Look for | Meaning |
|---|---|
| `dbQueryCount` | The slow path makes **1 + N** queries (one per task); the fast path makes **1**. ⭐ **Network round-trips usually dominate everything else.** |
| `winningStage: COLLSCAN` | ❌ No index. MongoDB read **every** document. |
| `winningStage: IXSCAN` | ✅ A B-tree seek instead of a scan. |
| `PROJECTION_COVERED` + `totalDocsExamined: 0` | ✅✅ Answered from the **index alone**; documents never read. |
| `efficiencyRatio` | `totalDocsExamined ÷ nReturned`. **1:1 ideal; 100:1 means you examined 100 docs to return 1.** |
| `SORT` in the plan | ❌ An **in-memory sort**, which **fails outright above 100MB**. Add an index matching the sort order. |
| `timesUsedSinceRestart: 0` | An index nobody queries. **It still taxes every write.** Drop it. |

⭐ **That legend is the same checklist you'd use reading a real `explain()` plan in production** — which is the point of putting it in the UI rather than a comment.

## Client-measured round-trip

```js
const startedAt = performance.now();
const res = await axiosClient.get(url);
const roundTripMs = Math.round(performance.now() - startedAt);
```

Merged into the response as `_clientRoundTripMs` alongside the server's own timings.

⭐ Useful because the two numbers differ: the server reports **query** time, the client reports **query + serialisation + network**. On the slow path the gap is large (a big unprojected payload has to be serialised and transferred), which **demonstrates mistake #2 — the missing projection — from the client side.**

`performance.now()` is a **monotonic** clock, for the same reason the server uses [`process.hrtime`](../../../server/middleware/requestLogger.js.md): `Date.now()` can jump backwards.

## Single-flight button state

```js
const [running, setRunning] = useState(null);
// ...
<button disabled={running !== null}>{running === b.key ? 'Running…' : b.label}</button>
```

**All** buttons disable while any request is in flight — deliberate, because running two demos simultaneously would have them **compete for the same database and distort both sets of timings.** A benchmark you can accidentally invalidate by double-clicking isn't much of a benchmark.

⚠️ The endpoints are also behind [`expensiveLimiter`](../../../server/middleware/rateLimiter.js.md) (10/min) — the slow path is a *deliberate* full collection scan, and each call evicts the WiredTiger working set, slowing every other query.

## Interview questions

- **"How do you prove a query uses an index?"** → `.explain("executionStats")`. Then the four numbers to read.
- **"What's the efficiency ratio?"** → docs examined ÷ returned. One number summarising index quality.
- **"Why do your local timings look identical?"** → Not enough data. Both paths are sub-millisecond until the collection is large.
- **"Server-side or client-side timing?"** → Both — the gap is the serialisation and transfer cost, which is exactly what a missing projection inflates.

## Related

- [`server/controllers/queryDemoController.js`](../../../server/controllers/queryDemoController.js.md) — ⭐ all the substance
- [`server/seed.js`](../../../server/seed.js.md) — the data this needs
- [`server/models/Task.js`](../../../server/models/Task.js.md) — ESR, the prefix rule, when indexes hurt
- [`server/routes/demoRoutes.js`](../../../server/routes/demoRoutes.js.md) — the endpoints
