# `server/routes/adminRoutes.js`

> Mounted at `/api/admin`. The shortest router, and the one where secure-by-default matters most.

**Lines:** 26 · **Concept blocks:** 1

## Routes

```js
router.use(verifyAccessToken);          // 1. AuthN — who are you?
router.use(requireRole('admin'));       // 2. AuthZ — are you allowed?
```

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/users` | Paginated user list |
| `GET` | `/overview` | Counts, top users, cache stats |
| `PATCH` | `/users/:id/role` | Promote/demote |
| `POST` | `/users/:id/revoke-sessions` | Force logout |
| `POST` | `/cache/flush` | Clear the task cache |
| `GET` | `/report` | Worker-thread demo (`?mode=worker\|blocking`) |

## Concept

| Concept | Takeaway |
|---|---|
| **Stacking AuthN then AuthZ at router level** | The order is **not optional**. `verifyAccessToken` must run first to populate `req.user`; `requireRole` then reads it. Swap them and `req.user` is undefined — `requireRole` [fails closed](../middleware/auth.js.md) (returns 401, by design), but the intent is broken. |

## Why `router.use()` here specifically

⭐ **This is the single most important place to be secure by default.** Forgetting an auth check on an admin endpoint is a critical vulnerability — it exposes every user's data, role changes and session control to anyone.

With `router.use()`, a new route added anywhere in this file inherits both gates automatically. With per-route middleware, the protection depends on the next developer remembering — and the failure mode is silent (the endpoint works perfectly, for everybody).

## The status codes, and why both appear

| Caller | Response | Reason |
|---|---|---|
| Anonymous | **401** | AuthN runs first and fails. "I don't know who you are." |
| Logged-in non-admin | **403** | AuthN passed, AuthZ failed. "I know who you are, and no." |
| Admin | 200 | |

[Both directions are tested](../tests/integration.tasks.test.js.md) — asserting the *right* code, not just "it was rejected", is what proves the layering works.

## The one route-level guard

`changeUserRole` adds `mongoIdParamValidation` so a malformed id returns 400 rather than a CastError 500. The privilege-escalation guards (an admin can't demote themselves; a role change revokes sessions) live in the [controller](../controllers/adminController.js.md), because they're business rules, not wiring.

## Interview questions

- **"Where do you enforce admin-only access?"** → Router-level, after authentication. Secure by default so a new endpoint can't ship unprotected.
- **"401 or 403 for a logged-in non-admin?"** → 403. 401 means unauthenticated; 403 means authenticated but not permitted. Mixing them up is a common nitpick.
- **"What if `requireRole` runs without `verifyAccessToken`?"** → `req.user` is undefined. A naive implementation throws a TypeError → 500; this one fails closed with a 401. **Always fail closed when a precondition is missing.**

## Related

- [`middleware/auth.js`](../middleware/auth.js.md) — `requireRole`, and the RBAC → ABAC → ReBAC progression
- [`controllers/adminController.js`](../controllers/adminController.js.md) — the handlers
- [`models/User.js`](../models/User.js.md) — the `role` field this is built on
