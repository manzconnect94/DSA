# `server/routes/`

> Wiring only. Every line is "path + middleware chain + handler". No business logic, ever.

## Files

| File | Doc | Mount | Lines |
|---|---|---|---|
| `index.js` | [→](./index.js.md) | `/api` — barrel + health checks | 76 |
| `authRoutes.js` | [→](./authRoutes.js.md) | `/api/auth` | 59 |
| `taskRoutes.js` | [→](./taskRoutes.js.md) | `/api/tasks` | 67 |
| `demoRoutes.js` | [→](./demoRoutes.js.md) | `/api/demo` | 29 |
| `adminRoutes.js` | [→](./adminRoutes.js.md) | `/api/admin` | 26 |

## Why routes contain no logic

A route file should read like a table of contents. Logic here is:

- **Untestable** in isolation — you can only reach it through HTTP
- **Unreusable** — it can't be called from a job, a script, or another route
- **Invisible** — nobody expects to find a business rule in a routing file

## ⭐ The three middleware scopes

Knowing which to use is a design question interviewers probe.

| Scope | Example | Use for |
|---|---|---|
| **App-level** | `app.use(helmet())` | Cross-cutting concerns: security headers, body parsing, CORS, logging, compression |
| **Router-level** | `router.use(verifyAccessToken)` | A whole resource sharing a requirement |
| **Route-level** | `router.delete('/:id', requireRole('admin'), h)` | Genuinely specific: a stricter limit on login, an admin gate on one action, a multer parser |

⚠️ **Security note: prefer router-level for auth.** If you protect routes individually, the day someone adds an endpoint and forgets the middleware, it ships **public**. Router-level auth is secure **by default** — you have to opt *out*, not remember to opt in. Every router here except `authRoutes` (which has genuinely public endpoints) uses `router.use()`.

⚠️ **Performance note:** app-level middleware runs on *every* request including health checks. Mounting something expensive app-level when three routes need it is real wasted CPU at scale — which is why multer is mounted per-route.

## Auth requirements at a glance

| Router | Protection |
|---|---|
| `/api/health*` | none |
| `/api/auth` | mixed — register/login/refresh/logout public, the rest `router.use(verifyAccessToken)` |
| `/api/tasks` | `router.use(verifyAccessToken)` + `requireOwnership(Task)` on every `/:id` route |
| `/api/demo` | `router.use(verifyAccessToken)` + `expensiveLimiter` |
| `/api/admin` | `router.use(verifyAccessToken)` **then** `router.use(requireRole('admin'))` |

## ⚠️ Route order matters

Express matches in **registration order** and stops at the first hit. Declare `/:id` before `/stats` and `GET /api/tasks/stats` matches `/:id` with `id = "stats"` — the controller looks up a Task with the id `"stats"` and you get a confusing CastError on a route you're certain you defined.

**Rule: static segments first, dynamic segments last.** See [`taskRoutes.js`](./taskRoutes.js.md).

## Interview questions

- **"Where do you put an auth check?"** → Router-level, so it's secure by default and a new endpoint inherits it.
- **"Your `/tasks/stats` route returns a 400. Why?"** → It's matching `/:id` declared above it.
- **"How would you version this API?"** → Path versioning (`/api/v1`), and only on a *breaking* change. Adding a field isn't breaking; removing or renaming one is. See [`index.js`](./index.js.md).

## Related

- [`server/README.md`](../README.md) — the full request lifecycle
- [`middleware/`](../middleware/README.md) · [`controllers/`](../controllers/README.md)
