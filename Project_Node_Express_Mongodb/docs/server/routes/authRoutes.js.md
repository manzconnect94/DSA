# `server/routes/authRoutes.js`

> Mounted at `/api/auth`. The one router with genuinely public endpoints, so it mixes scopes deliberately.

**Lines:** 59 · **Concept blocks:** 4

## Routes

| Method | Path | Middleware chain | Public? |
|---|---|---|---|
| `POST` | `/register` | `registerLimiter` → `registerValidation` → handler | ✅ |
| `POST` | `/login` | `loginLimiter` → `loginValidation` → handler | ✅ |
| `POST` | `/refresh` | handler | ✅ (cookie-authenticated) |
| `POST` | `/logout` | handler | ✅ (idempotent) |
| — | `router.use(verifyAccessToken)` | ← everything below inherits this | |
| `GET` | `/me` | handler | 🔒 |
| `GET` | `/sessions` | handler | 🔒 |
| `POST` | `/logout-all` | handler | 🔒 |
| `PATCH` | `/password` | handler | 🔒 |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Routes define wiring only** | Every line is path + middleware + handler. Logic here would be untestable, unreusable and unexpected. |
| **The middleware chain, read left to right** | The order **is** the execution order, and each step can short-circuit. ⭐ **The rate limiter is first deliberately** — it's the cheapest check, and you want to reject abuse *before* spending CPU on validation or a DB query. Ordering middleware cheapest-first is a real consideration under attack. |
| **`/refresh` is public, but not unauthenticated** | It deliberately does **not** use `verifyAccessToken` — by the time you need to refresh, your access token has expired, so requiring one would be a **deadlock**. The httpOnly refresh cookie *is* the credential, verified in the controller against both signature and database. |
| **`router.use()` for the protected half** | Everything registered **below** that line inherits auth. Secure by default: a new endpoint added at the bottom is protected automatically. ⚠️ It must come *after* the public routes — `router.use()` only affects what follows it. |

## The chain, concretely

`POST /register`:

```
registerLimiter     → too many from this IP?  → 429, chain stops
registerValidation  → body malformed?          → 400, chain stops
                    → role/isActive present?   → 400 (mass assignment)
authController.register
```

Three chances to reject before any database work happens.

## Why logout accepts either state

`/logout` sits **above** `router.use(verifyAccessToken)`, so it works with or without a valid access token. That's intentional: logout is [idempotent](../controllers/authController.js.md). Requiring a valid token would mean a user whose token just expired **cannot log out** — their client gets a 401, tries to refresh, and can get stuck.

## Interview questions

- **"Why isn't your refresh endpoint behind auth middleware?"** → Because the access token has expired by definition. The refresh cookie is the credential for that endpoint.
- **"Why is the rate limiter before validation?"** → Cheapest check first. Under attack you want to reject before spending CPU.
- **"Why does `router.use()` placement matter?"** → It only applies to routes registered after it. Put it too early and your public routes require auth; too late and your protected ones don't.
- **"Should logout require authentication?"** → No. It must be idempotent and always succeed, or an expired session traps the user.

## Related

- [`controllers/authController.js`](../controllers/authController.js.md) — the handlers
- [`middleware/rateLimiter.js`](../middleware/rateLimiter.js.md) — the login and register limiters
- [`middleware/validate.js`](../middleware/validate.js.md) — the validation chains
- [`middleware/auth.js`](../middleware/auth.js.md) — `verifyAccessToken`
