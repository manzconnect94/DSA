# `server/models/User.js`

> Identity. Owns password hashing (so no controller ever touches bcrypt) and the `role` field that RBAC is built on.

**Lines:** 267 · **Concept blocks:** 14

## Schema

| Field | Type | Notes |
|---|---|---|
| `name` | String | 2–80 chars, trimmed |
| `email` | String | **unique index**, lowercased, regex-validated, max 254 (RFC 5321) |
| `password` | String | min 8, **`select: false`**, hashed by `pre('save')` |
| `role` | String | `enum: ['user','admin']`, indexed. **Never settable from a request body.** |
| `isActive` | Boolean | Checked on every authenticated request |
| `passwordChangedAt` | Date | Invalidates access tokens issued earlier |
| `lastLoginAt`, `avatarUrl` | | |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Mongoose schema** | What Mongoose adds on top of a schemaless store. |
| **`bcryptjs` vs `bcrypt`** | Same algorithm and hash format; pure JS installs anywhere, native is faster but needs a compiler. Either way bcrypt is **CPU-bound and blocks the event loop** — a real reason to run [multiple workers](../cluster.js.md). |
| **⚠️ `unique: true` is an INDEX, not a validator** | It runs **no validation**. A duplicate produces a raw `MongoServerError` with **`code: 11000`**, *not* a `ValidationError`. If you only handle `ValidationError`, every duplicate signup returns a 500. [Translated to 409 here](../middleware/errorHandler.js.md). Second gotcha: with `autoIndex` off in production, a forgotten migration means the constraint **silently doesn't exist**. |
| **`select: false`** | Defence in depth against "we accidentally returned the password hash". The field is omitted from every query unless you opt in with `.select('+password')` — so you can't forget it on a new endpoint. Only the login controller opts back in. |
| **RBAC — the `role` field** | The entire basis of [`requireRole()`](../middleware/auth.js.md). `enum` stops anyone inventing a privilege tier. |
| **`passwordChangedAt`** | A great answer to "you said you can't revoke a JWT — so what if my password is stolen?" Store the change time; reject any token whose `iat` predates it. Targeted revocation of a stateless token. |
| **`timestamps`** | ⚠️ `updatedAt` is only touched by **Mongoose-issued** writes — a raw driver update or a shell edit bypasses it. |
| **`toJSON` transform** | `res.json(user)` calls `toJSON()` internally, so putting the transform here means every endpoint that ever returns a user gets the safe shape. The alternative (a DTO per controller) eventually fails. |
| **Virtuals** | `initials` is derived at read time. ⚠️ **Not queryable, not indexable** — `User.find({ initials: 'MH' })` matches nothing. |
| **⭐ `pre('save')` hashing** | "Where do you hash the password?" If the answer is "in the register controller", the follow-up writes itself: what about reset-password, admin-create-user, and the seed script? Each is a chance to store plaintext. A hook makes it *structurally impossible*. |
| **Salting, and why no salt column** | bcrypt **generates the salt itself and embeds it in the output**: `$2a$10$<22-char salt><31-char hash>`. So you store one string — `compare()` reads the cost and salt back out. It also means you can raise the cost factor over time and rehash on next login. |
| **Instance methods vs statics** | Instance = one document (`user.comparePassword()`); static = the model (`User.findByEmail()`). ⚠️ Must be `function`, never an arrow — arrows have no own `this`. |
| **Timing-safe comparison** | `bcrypt.compare` is constant-time. `hash(candidate) === stored` with `===` **short-circuits on the first differing byte**, so response timing can leak the hash. Never compare secrets with `===`. |
| **`autoIndex` in production** | Convenient in dev, dangerous in prod — an index build at startup can lock a large collection for minutes. |

## The `isModified` guard

```js
if (!this.isModified('password')) return next();
```

⚠️ Essential. Without it, **every** `save()` — even one only updating `lastLoginAt` — would re-hash the already-hashed password, producing a hash-of-a-hash and **locking the user out permanently**.

## The 1-second backdate

```js
this.passwordChangedAt = new Date(Date.now() - 1000);
```

The JWT `iat` claim has 1-second resolution, so a token issued in the same second as the change could otherwise be wrongly rejected (or wrongly accepted). A classic off-by-one.

## API

| Member | Type | Purpose |
|---|---|---|
| `comparePassword(candidate)` | instance | Timing-safe bcrypt compare. Throws if `password` wasn't selected. |
| `passwordChangedAfter(iat)` | instance | Used by [`verifyAccessToken`](../middleware/auth.js.md) |
| `findByEmail(email, {withPassword})` | static | Normalises case; optionally re-selects the hash |
| `initials` | virtual | Display only |
| `User.ROLES` | export | `['user','admin']` |

## Interview questions

- **"How do you enforce unique emails, and what error do you get?"** → A unique index. A duplicate is `code: 11000`, not a validation error — you must translate it to a 409.
- **"Where do you hash the password?"** → A pre-save hook, so every code path that persists a user is covered. Then name the caveat: it doesn't fire on `findOneAndUpdate` or `insertMany`.
- **"Why is there no salt column?"** → bcrypt embeds the salt and cost in the hash string.
- **"How do you make sure the hash never leaks?"** → `select: false` plus a `toJSON` transform, then a [test that asserts on the actual HTTP response](../tests/integration.auth.test.js.md).
- **"Your users can suddenly no longer log in after a profile update. Why?"** → A save re-hashed the hash. Missing `isModified` guard.

## Related

- [`controllers/authController.js`](../controllers/authController.js.md) — register, login, changePassword
- [`middleware/auth.js`](../middleware/auth.js.md) — consumes `role`, `isActive`, `passwordChangedAt`
- [`seed.js`](../seed.js.md) — why it uses `.save()` and not `insertMany`
- [`tests/integration.auth.test.js`](../tests/integration.auth.test.js.md) — asserts the hash never leaves the server
