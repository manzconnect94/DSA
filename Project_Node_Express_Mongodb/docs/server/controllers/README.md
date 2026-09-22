# `server/controllers/`

> Business logic. Deliberately thin — it's a task manager, and the code exists to demonstrate infrastructure patterns, not to be a product.

## Files

| File | Doc | Lines | Concept blocks | Headline |
|---|---|---|---|---|
| `authController.js` | [→](./authController.js.md) | 501 | 12 | The full JWT flow, user enumeration, timing attacks |
| `taskController.js` | [→](./taskController.js.md) | 691 | 19 | Streams, pagination, caching, aggregation |
| `queryDemoController.js` | [→](./queryDemoController.js.md) | 631 | 7 | **Slow vs fast**, N+1, `.explain()` |
| `adminController.js` | [→](./adminController.js.md) | 242 | 4 | RBAC, worker threads |

`taskController.js` is the densest file in the project; `queryDemoController.js` is the one to read first if you only read one.

## Conventions

Every handler follows the same shape:

```js
const handler = asyncHandler(async (req, res) => {
  const { field } = req.body;              // 1. explicit allowlist
  if (bad) throw ApiError.badRequest(...);  // 2. throw, never return an error
  const doc = await Model.create({ ...,     // 3. identity from the TOKEN
                                   owner: req.user.id });
  await cache.invalidateTaskCache(...);     // 4. invalidate on write
  activityLogger.emit(EVENTS.X, {...});     // 5. emit, don't call subsystems
  res.status(201).json({ success: true, data: doc });
});
```

| # | Rule | Why |
|---|---|---|
| 1 | **Destructure, never spread `req.body`** | [Mass assignment](../middleware/validate.js.md) — `User.create(req.body)` lets an attacker send `role: 'admin'` |
| 2 | **Throw `ApiError`, don't return** | One [central handler](../middleware/errorHandler.js.md) shapes every response |
| 3 | **`owner`/`role` from `req.user`** | The token is verified; the body is not |
| 4 | **Invalidate cache on every write** | Or the user doesn't see their own change |
| 5 | **Emit events** | Keeps the controller ignorant of email/sockets/audit — see [`activityLogger`](../utils/activityLogger.js.md) |

Every handler is wrapped in [`asyncHandler`](../utils/asyncHandler.js.md). Without it, an async rejection in Express 4 means the request **hangs** — Express never sees the error.

## What the controllers do *not* do

| Not here | Where instead |
|---|---|
| Password hashing | [`models/User.js`](../models/User.js.md) `pre('save')` |
| Token signing/verifying | [`utils/tokens.js`](../utils/tokens.js.md) |
| Ownership checks | [`middleware/auth.js`](../middleware/auth.js.md) `requireOwnership` |
| Input validation | [`middleware/validate.js`](../middleware/validate.js.md) |
| Error shaping | [`middleware/errorHandler.js`](../middleware/errorHandler.js.md) |
| Reading `req.headers` | middleware only |

The ownership one is the important one: `requireOwnership` loads the document **scoped to the caller** and attaches it as `req.resource`. The controller uses `req.resource` and never re-queries — so there's no second round-trip, and no chance of forgetting the check.

## Response envelope

```js
{ success: true,  data: ..., pagination?: ..., diagnostics?: ... }
{ success: false, error: { code, message, details?, requestId? } }
```

A machine-readable `code` matters: the [client interceptor](../../client/src/api/axiosClient.js.md) branches on `TOKEN_EXPIRED` (refresh and retry) vs `TOKEN_INVALID` (log out). An undifferentiated 401 would force the client into a refresh loop on a forged token.

## Interview questions

- **"Fat model or fat controller?"** → Fat model. Data rules belong where the data is defined, so every code path gets them. Controllers orchestrate.
- **"Why throw instead of returning an error response?"** → One place to shape, log and sanitise every error. Returning early from 40 handlers means 40 chances to leak a stack trace or forget a status code.
- **"What's wrong with `Model.create(req.body)`?"** → Mass assignment. Enumerate the fields you accept.

## Related

- [`routes/`](../routes/README.md) — what dispatches to these
- [`middleware/`](../middleware/README.md) — what runs before them
- [`tests/`](../tests/README.md) — what verifies them
