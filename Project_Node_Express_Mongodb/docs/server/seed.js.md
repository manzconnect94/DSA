# `server/seed.js`

> Generates realistic data volumes so the performance demos are measurable rather than theoretical.

**Lines:** 214 · **Concept blocks:** 5

## Usage

```bash
node seed.js                              # 10,000 tasks, 20 users
node seed.js --tasks=50000 --users=200    # what the perf demos want
node seed.js --reset                      # wipe first
npm run seed        /  npm run seed:big   # shortcuts
```

Creates two known logins: `demo@example.com` (owns ~60% of tasks) and `admin@example.com`, both `Password123`.

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Seeding enough data to make performance REAL** | ⭐ With 20 documents a COLLSCAN and an IXSCAN are both sub-millisecond, so the slow/fast demo proves nothing. That's the lesson: **performance bugs don't appear in dev, they appear in production, because production is where the data is.** Seeding realistic volumes locally is how you catch them first. |
| **`legacyTag` cardinality is what makes the demo work** | `'batch-import'` is given to ~10% of tasks — selective enough that an index *would* help a lot, so its absence is a genuine loss. At 90% the index would be useless anyway ([low cardinality](./models/Task.js.md)) and the demo would teach the wrong lesson. |
| **Why users use `.save()`, not `insertMany()`** | ⚠️ A direct consequence of the hook rules: `insertMany` **does not fire document middleware**, so the [`pre('save')` hashing hook](./models/User.js.md) would be skipped and every seeded password stored **in plaintext**. Embarrassing in a seed script; a breach in a "bulk import users" feature. |
| **`insertMany` + batching** | One command instead of 50,000 round-trips (50–100× faster). Batch anyway because: a command can't exceed 16MB, a giant array holds everything in memory, and `ordered: false` lets the server apply the batch in **parallel** and continue past individual failures. |
| **Build indexes AFTER a bulk load** | If indexes exist during the insert, every document updates every index — [write amplification](./models/Task.js.md) paid 50,000 times. Loading first and building once is a single efficient sort instead of 50,000 B-tree inserts. |

## The rule it demonstrates

> **Bulk methods for data with no hooks (tasks). `.save()` for data that depends on middleware (users).**

This is the practical face of the Mongoose hook asymmetry — the same reason [`changePassword`](./controllers/authController.js.md) loads a document rather than using `findByIdAndUpdate`.

## What it generates

| Field | Distribution | Why |
|---|---|---|
| `owner` | 60% to the demo user | So `/api/demo/*` has plenty to work with after logging in as demo |
| `status` / `priority` | Uniform over the enums | Meaningful `$group` output |
| `description` | ~900 chars of filler | Gives the "no projection" mistake a **real cost** to demonstrate |
| `legacyTag` | ~10% `batch-import` | The COLLSCAN target |
| `createdAt` | Random over the past year | Makes sort-by-date and cursor pagination realistic |

The long `description` is not padding — without it, fetching all fields versus a projection would cost almost the same and [mistake #2](./controllers/queryDemoController.js.md) would be invisible.

## Output

Prints per-stage timings, a docs/sec rate, the resulting index list (flagging that `legacyTag` is deliberately unindexed), and a sanity check of row counts. Ends with the exact next commands to run.

## Interview questions

- **"How do you insert 50,000 documents efficiently?"** → `insertMany` in batches with `ordered: false`; build indexes afterwards. Explain the 16MB command limit and why batching still matters.
- **"What does `ordered: false` actually do?"** → Lets the server apply writes in parallel and continue past a failing document instead of aborting at the first error. Faster, but you must accept partial success.
- **"Why did your seeded users end up with plaintext passwords?"** → `insertMany` bypasses document middleware, so the pre-save hash never ran.
- **"How do you speed up a large data import?"** → Drop/defer indexes, bulk write, then rebuild. Also consider `mongoimport` for raw files.

## Related

- [`models/User.js`](./models/User.js.md) — the hook that forces `.save()`
- [`models/Task.js`](./models/Task.js.md) — the indexes built here, and the one deliberately missing
- [`controllers/queryDemoController.js`](./controllers/queryDemoController.js.md) — what this data exists for
