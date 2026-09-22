# `server/tests/integration.tasks.test.js`

> 22 tests covering CRUD, ⭐ **IDOR**, RBAC, pagination stability, aggregation and the streaming export.

**Lines:** 285 · **Concept blocks:** 8 · **Tests:** 22

## ⭐ Testing AUTHORIZATION, not just authentication

Most test suites only check "does a logged-out user get 401?" and stop there. **That misses IDOR entirely** — the bug is that a **logged-in** user can reach **someone else's** data.

The test you actually need: **create two users, have user B try to touch user A's resource, assert 404.**

⭐ **If you write one security test in a codebase, write this one.** Broken access control is OWASP's **#1** risk, and it's **invisible in manual QA** because testers only ever look at their own data.

## The IDOR suite

```js
alice = await createUserAndLogin('alice@example.com');
bob   = await createUserAndLogin('bob@example.com');
aliceTaskId = /* a task created by Alice */;
```

| Test | Assertion |
|---|---|
| Bob **cannot read** Alice's task | `404` — and the response body **doesn't contain "Alice"** |
| Bob **cannot update** it | `404` — **and the data is genuinely untouched** (re-queried to confirm) |
| Bob **cannot delete** it | `404` — **and the document still exists** |
| Alice **can** do all three | `200` / `200` / `204` |

Three details worth copying:

1. ⚠️ **The assertion is 404, not 403.** Returning 403 would **confirm the resource exists** and let an attacker enumerate ids. See [`middleware/auth.js`](../middleware/auth.js.md).
2. **It verifies the data, not just the status.** `expect(task.title).toBe("Alice's private task")` after a failed update proves nothing leaked *and* nothing changed. A status-only assertion could pass while a write went through.
3. **The positive case is tested too.** Without it, a middleware that 404s on *everything* would pass all three negative tests.

⭐ That third point is the one people miss — a security test suite that only asserts denials can be satisfied by something completely broken.

## Coverage

| Group | Tests |
|---|---|
| **CRUD** | 7 — owner from token, ⭐ `owner` rejected from body, list is scoped to caller, update stamps `completedAt`, delete → 204, malformed id → **400 not 500**, valid-but-missing → 404 |
| ⭐ **IDOR** | 4 — the table above |
| **RBAC** | 3 — user → **403**, anonymous → **401**, admin → 200 |
| **Pagination** | 5 — offset metadata, last page, cursor shape, ⭐ **cursor has no duplicates**, `?limit=1000000` → 400 |
| **Aggregation** | 1 — correct grouped counts |
| **CSV export** | 2 — well-formed streaming CSV, ⭐ **formula injection neutralised** |

## ⭐ The tests worth studying

### RBAC, tested in *both* directions and with the *right* codes

| Caller | Expected | Why |
|---|---|---|
| Regular user | **403** `FORBIDDEN` | Authenticated but not permitted |
| Anonymous | **401** | AuthN runs first and fails |
| Admin | 200 | |

⭐ Asserting the **right** code, not just "it was rejected", is what proves the [layering](../middleware/auth.js.md) works. A single implementation returning 403 for both would pass a sloppier test.

The admin test also **logs in again** after the role change — a neat demonstration that **JWT claims are a snapshot, not live data.**

### ⭐ Cursor pagination has no duplicates

```js
do {
  const res = await authed(`/api/tasks?mode=cursor&limit=10&cursor=${cursor}`);
  for (const task of res.body.data) {
    expect(seen.has(task._id)).toBe(false);   // ← the assertion that matters
    seen.add(task._id);
  }
  cursor = res.body.pagination.nextCursor;
} while (cursor && pages < 10);

expect(seen.size).toBe(25);
expect(pages).toBe(3);
```

This walks the **entire** result set and proves **no row is ever returned twice** — which is precisely offset pagination's [core weakness](../controllers/taskController.js.md). ⭐ **A test that demonstrates the difference is worth more than an explanation.**

### Malformed id → 400, not 500

```js
await authed('get', '/api/tasks/not-a-valid-id').expect(400);
```

Guards the [ObjectId pre-check](../middleware/auth.js.md). Without it, Mongoose throws a `CastError` → an ugly 500 — and **a 500 on attacker-supplied input signals an unhandled path worth probing.**

### The aggregation test catches the ObjectId gotcha

```js
expect(res.body.data.total).toBe(3);   // would be 0 if the ObjectId cast were missing
```

⭐ **Aggregation pipelines bypass schema casting**, so a string `$match` silently returns an empty array. With known data, this test catches exactly that — instead of the dashboard quietly showing zeros in production.

### CSV injection

```js
await Task.create({ title: '=HYPERLINK("http://evil.com","click")', owner });
expect(res.text).toContain("'=HYPERLINK");   // leading quote neutralises it
```

The attack targets **your user's machine**, not your server, which is why it gets overlooked.

### What a streaming test *can* prove

```js
expect(res.headers['content-length']).toBeUndefined();   // ⇒ chunked ⇒ streamed
expect(res.text).toContain('"Second, with a comma"');    // correct CSV quoting
```

⭐ Supertest **buffers** the response, so you cannot directly observe chunking. But you *can* assert the headers that make it a stream and that the body is correct. **The memory behaviour is what you'd verify with a load test, not a unit test** — and being clear about what a test can and cannot prove is itself a good signal.

## The test helper

```js
async function createUserAndLogin(email) {
  const res = await request(app).post('/api/auth/register').send({ name:'User', email, password:'Password123' });
  return { token: res.body.data.accessToken, userId: res.body.data.user.id };
}
```

⚠️ Note this only works because rate limiting is [disabled in tests](../middleware/rateLimiter.js.md) — the suite registers well over ten users from one IP.

## Interview questions

- **"Write one security test."** → The IDOR test, with all three details: 404 not 403, verify the data, and test the positive case.
- **"How do you test authorization?"** → Two users, cross-access, assert 404. Plus RBAC in both directions with the right codes.
- **"How would you prove cursor pagination is stable?"** → Walk the whole set and assert no id repeats.
- **"Can you unit-test a streaming endpoint?"** → You can test correctness and the headers; memory behaviour needs a load test.
- **"Why 400 and not 500 for a malformed id?"** → Validate before querying. A 500 on user input is both bad UX and an attacker's signal.

## Related

- [`middleware/auth.js`](../middleware/auth.js.md) — ⭐ the full IDOR breakdown
- [`controllers/taskController.js`](../controllers/taskController.js.md) — pagination, aggregation, streaming
- [`routes/taskRoutes.js`](../routes/taskRoutes.js.md) — where `requireOwnership` is attached
- [`setup.js`](./setup.js.md) — the in-memory database
