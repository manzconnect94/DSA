# `server/models/`

> Mongoose schemas. "Fat model, thin controller" — validation, hashing, indexes and shaping all live here.

## Files

| File | Doc | Owns | Lines |
|---|---|---|---|
| `User.js` | [→](./User.js.md) | Identity, password hashing, the `role` field | 267 |
| `Task.js` | [→](./Task.js.md) | The domain object, and the **indexing strategy** | 263 |
| `RefreshToken.js` | [→](./RefreshToken.js.md) | Session revocation, rotation, reuse detection | 155 |

## Data model

```
┌─────────────────┐
│ User            │
│  email (unique) │
│  password ──────┼── select: false, hashed by pre('save')
│  role           │── 'user' | 'admin'  → the RBAC primitive
│  passwordChangedAt ── invalidates older access tokens
└────┬───────┬────┘
     │       │
     │ 1:N   │ 1:N
     ▼       ▼
┌──────────┐ ┌────────────────────┐
│ Task     │ │ RefreshToken       │
│  owner ──┼─┤  user              │
│  status  │ │  tokenHash (sha256)│── never the raw token
│  legacyTag│ │  jti              │── revoke ONE session
│   (no index!)│  revokedAt       │── the revocation lever
└──────────┘ │  expiresAt (TTL)   │── MongoDB deletes it for you
             └────────────────────┘
```

Both children **reference** the user rather than embedding — the [normalisation decision](./Task.js.md) is explained in `Task.js`.

## ⚠️ The hook asymmetry — the single most important thing here

Mongoose has two kinds of middleware, and confusing them causes real security bugs:

| | Runs on | `this` is | Skipped by |
|---|---|---|---|
| **Document** middleware — `pre('save')` | `.save()`, `.create()` | the document | `updateOne`, `findOneAndUpdate`, `insertMany` |
| **Query** middleware — `pre(/^find/)` | `find*` operations | the Query | — |

**Why it matters concretely:** the password hashing hook is `pre('save')`. So:

- `user.password = x; await user.save()` → **hashed** ✅
- `User.findByIdAndUpdate(id, { password: x })` → **stored in plaintext** ❌
- `User.insertMany([...])` → **stored in plaintext** ❌

This is why [`changePassword`](../controllers/authController.js.md) loads the document and calls `.save()`, and why [`seed.js`](../seed.js.md) creates users one at a time instead of using `insertMany`. Both have comments pointing back here.

## Cross-cutting patterns

| Pattern | Where | Why |
|---|---|---|
| `select: false` | `User.password` | Defence in depth — the field is omitted from *every* query unless explicitly requested. You can't forget it on a new endpoint. |
| `toJSON` transform | `User`, `Task` | Shapes the API response **at the model**, so every endpoint that ever returns one gets the safe shape for free. Drops `password`/`__v`, renames `_id` → `id`. |
| `enum` on `role`/`status` | all | Stops anyone inventing `role: 'superadmin'` |
| `autoIndex: false` in prod | all | ⚠️ Building an index at boot on a million-document collection can lock the DB for minutes while pods sit "starting" |
| Virtuals | `User.initials`, `Task.isOverdue` | Derived at read time, zero storage. ⚠️ **Cannot be queried or indexed.** |

## Interview questions

- **"MongoDB is schemaless — so what does Mongoose add?"** → An *application-level* schema: types, required fields, defaults, validators, middleware. The store imposes nothing, but virtually every real app imposes a schema somewhere, because without it one bad deploy writes garbage documents that live forever.
- **"When do you embed and when do you reference?"** → Embed when the child is owned by and always read with the parent, and the array is bounded. Reference when it's large, shared, independently queried, or unbounded. The decider: **a single document cannot exceed 16MB**, so an unbounded embedded array is a time bomb.
- **"Why didn't my pre-save hook run?"** → You used a query operation. Document middleware doesn't fire on `findOneAndUpdate`/`updateOne`/`insertMany`.
- **"Can you index a virtual?"** → No. MongoDB doesn't know it exists. If you need to query it, it must be a real (denormalised) field.

## Related

- [`server/README.md`](../README.md) — layering
- [`controllers/`](../controllers/README.md) — the consumers
- [`seed.js`](../seed.js.md) — where the hook asymmetry has practical consequences
