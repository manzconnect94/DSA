# `server/routes/demoRoutes.js`

> Mounted at `/api/demo`. The six performance-demo endpoints.

**Lines:** 29 · **Concept blocks:** 1

## Routes

```js
router.use(verifyAccessToken);   // the fast path filters by owner
router.use(expensiveLimiter);    // the slow path is a deliberate COLLSCAN
```

| Route | Purpose |
|---|---|
| `GET /tasks-slow` | ❌ COLLSCAN + no projection + no `.lean()` + N+1 + JS aggregation |
| `GET /tasks-fast` | ✅ IXSCAN + `$project` + `$lookup` + `$group` — one query |
| `GET /compare` | Runs both, reports the speedup and round-trips saved |
| `GET /explain` | `.explain("executionStats")` — unindexed vs indexed vs covered |
| `GET /indexes` | Index inventory + `$indexStats` usage counts |
| `GET /populate` | Loop vs `.populate()` vs `$lookup`, timed |

## Why both middleware are router-level

**`verifyAccessToken`** — the fast path filters by `owner: req.user.id`, so it needs an identity to be a fair comparison. (It also means you must log in before the demos work, which is why [`seed.js`](../seed.js.md) creates known accounts.)

**`expensiveLimiter`** (10/minute) — `/tasks-slow` is a *deliberate* full collection scan over 50,000 documents. Left unthrottled it's a self-inflicted denial of service: each call also [evicts the WiredTiger working set](../controllers/queryDemoController.js.md), slowing every other query on the instance. This is [cost-based limiting](../middleware/rateLimiter.js.md) in its clearest form — some endpoints are simply worth more than others.

## Usage

```bash
cd server && npm run seed:big        # 50,000 tasks — essential
npm run dev
# log in as demo@example.com / Password123, then:
curl -H "Authorization: Bearer $TOKEN" localhost:5000/api/demo/compare
```

Or use the [UI page](../../client/src/pages/QueryDemoPage.jsx.md), which renders the JSON with a legend for reading it.

## Interview questions

- **"Would you ship an endpoint that does a deliberate COLLSCAN?"** → Only behind auth and a tight rate limit, and only as a diagnostic. The interesting part is *why* it needs protecting: it's not just slow for the caller, it degrades the cache for everyone.
- **"How do you rate-limit fairly when endpoints differ in cost?"** → Assign a weight per endpoint and deduct from a shared budget — GitHub's GraphQL API is the canonical public example.

## Related

- [`controllers/queryDemoController.js`](../controllers/queryDemoController.js.md) — all the substance
- [`seed.js`](../seed.js.md) — the data these need
- [`client/src/pages/QueryDemoPage.jsx`](../../client/src/pages/QueryDemoPage.jsx.md) — the UI
