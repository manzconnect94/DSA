# `server/routes/taskRoutes.js`

> Mounted at `/api/tasks`. The clearest demonstration of route ordering and of ownership-as-middleware.

**Lines:** 67 · **Concept blocks:** 4

## Routes

```js
router.use(verifyAccessToken);        // ← every route below requires auth
```

| Method | Path | Chain |
|---|---|---|
| `GET` | `/stats` | handler *(static — declared first)* |
| `GET` | `/activity` | handler |
| `GET` | `/export` | `expensiveLimiter` → handler |
| `GET` | `/` | `listTasksValidation` → handler |
| `POST` | `/` | `createTaskValidation` → handler |
| `GET` | `/:id` | `mongoIdParamValidation` → `requireOwnership(Task)` → handler |
| `PATCH` | `/:id` | `updateTaskValidation` → `requireOwnership(Task)` → handler |
| `DELETE` | `/:id` | `mongoIdParamValidation` → `requireOwnership(Task)` → handler |
| `POST` | `/:id/attachment` | `upload.single('file')` → `mongoIdParamValidation` → `requireOwnership(Task)` → handler |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Router-level auth for a resource** | Every task route needs a logged-in user, so the check belongs here **once** rather than on eight individual routes. Secure by default. |
| **⚠️ Route order — static before dynamic** | A classic Express bug. Express matches in **registration order** and stops at the first hit. Declare `/:id` before `/stats` and `GET /api/tasks/stats` matches `/:id` with `id = "stats"` — the controller looks up a Task with the id `"stats"`, producing a CastError 400 (or a confusing 404) on a route you're certain you defined. **Rule: static segments first, dynamic last.** |
| **`requireOwnership` is the IDOR fix, as middleware** | Every route below takes an id from the URL, which is **attacker-controlled**. `requireOwnership(Task)` loads the document **scoped to the caller** and 404s if it isn't theirs. Because it's *middleware* rather than a line inside each controller, it **cannot be forgotten** when someone adds the next `/:id` route. |
| **⚠️ Multer must run BEFORE anything reading `req.body`** | `express.json()` cannot parse `multipart/form-data`, so on the attachment route `req.body` is **empty** until `upload.single()` has parsed the request. Validation placed before it would see nothing. |

## Why `/export` has its own limiter

The CSV export is the most expensive endpoint in the app — it streams the caller's entire task collection. A flat global limit is simultaneously too strict for cheap endpoints and far too lax for this one, so [cost-based limiting](../middleware/rateLimiter.js.md) is applied at route level.

## The ownership pattern, end to end

```
1. mongoIdParamValidation   → malformed id?           → 400
2. requireOwnership(Task)   → findOne({_id, owner})
                            → not found / not yours?  → 404 (not 403 — no enumeration)
                            → attaches req.resource
3. controller               → uses req.resource, never re-queries
```

Three properties worth stating: the ownership condition is **in the query** (impossible to fetch then forget the check), there's **one round-trip**, and the controller operates on the exact document that passed the check (**no TOCTOU gap**).

## Interview questions

- **"Your `/tasks/stats` endpoint returns a CastError. Why?"** → It's matching `/:id` declared above it.
- **"This DELETE route is authenticated. Is it secure?"** → No — authentication isn't authorization. Without an ownership check it's IDOR. See [`middleware/auth.js`](../middleware/auth.js.md).
- **"Why is ownership middleware rather than a controller check?"** → So it can't be forgotten on the next endpoint. Centralising the check is the structural fix.
- **"`req.body` is empty on my upload route."** → Multer hasn't run yet, or isn't in the chain at all.

## Related

- [`middleware/auth.js`](../middleware/auth.js.md) — the full IDOR breakdown
- [`controllers/taskController.js`](../controllers/taskController.js.md) — the handlers
- [`middleware/upload.js`](../middleware/upload.js.md) — the multer config
- [`tests/integration.tasks.test.js`](../tests/integration.tasks.test.js.md) — ⭐ the IDOR test
