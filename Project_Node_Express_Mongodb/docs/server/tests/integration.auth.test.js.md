# `server/tests/integration.auth.test.js`

> 27 integration tests driving the real Express app against a real (in-memory) MongoDB.

**Lines:** 271 · **Concept blocks:** 8 · **Tests:** 27

## What integration tests catch that unit tests can't

A unit test proves one function works. An integration test proves the **pieces work together** — routing, middleware order, validation, the controller, the model, and the real database. That catches an entire class of bug:

- Middleware registered in the **wrong order**
- A route **path typo**
- A validation rule that **rejects valid input**
- ⭐ A **Mongoose hook that doesn't fire** (e.g. `insertMany` skipping password hashing)

## ⭐ Why Supertest, not a real HTTP client

`request(app)` takes the Express app **object**. Supertest binds it to an **ephemeral port** automatically, makes the request, and tears it down.

| Benefit | Detail |
|---|---|
| No fixed port | **No conflicts in CI** |
| No leaked servers | Nothing keeps Jest alive |
| Fast | No network stack in the way |

⭐ This is exactly why [`app.js` and `server.js` are separate files](../server.js.md) — a combined file would start a listening server on import.

## `request.agent(app)` — the cookie jar

```js
agent = request.agent(app);          // persists cookies across requests
await agent.post('/api/auth/register').send(validUser);
await agent.post('/api/auth/refresh').expect(200);   // the cookie is sent automatically
```

Plain `request(app)` is **stateless** — each call is a fresh client with no cookie jar, so the refresh cookie set by login wouldn't be sent on a subsequent refresh. `agent()` keeps a jar, which is what lets you test a **real multi-request session flow**.

## Coverage

| Group | Tests |
|---|---|
| `POST /register` | 11 — creation, hash never leaks, hash stored not plaintext, httpOnly cookie, ⭐ **mass assignment rejected**, duplicate → 409, 4 validation cases, ⭐ **NoSQL injection rejected** |
| `POST /login` | 4 — success, ⭐ **identical enumeration error**, injection rejected, refresh token stored **hashed** |
| `POST /refresh` | 4 — new token, ⭐ **rotation**, ⭐ **reuse detection**, no cookie → 401 |
| `POST /logout` | 2 — revokes the row, idempotent |
| `GET /me` | 6 — success, no token, malformed, missing scheme, ⭐ **deleted user**, deactivated → 403 |

## ⭐ The security tests

### Mass assignment

```js
await request(app).post('/api/auth/register')
  .send({ ...validUser, role: 'admin' })
  .expect(400);
expect(await User.countDocuments()).toBe(0);   // nothing was created
```

Short, and it guards a **critical** vulnerability: an attacker making themselves an admin by adding one field.

### User enumeration

```js
const wrongPassword = await login(validUser.email, 'WrongPassword123').expect(401);
const unknownEmail  = await login('nobody@example.com', 'Password123').expect(401);

expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
```

⭐ The two failure modes must be **indistinguishable**. If a refactor ever splits them into "no such user" and "wrong password", **this test fails and stops the information leak from shipping.**

### NoSQL injection

```js
.send({ name: 'Attacker', email: { $ne: null }, password: 'Password123' })
.expect(400);
```

The concrete test for the `{"$ne": null}` login-bypass attack.

### ⭐ Reuse detection — the centrepiece

Simulates a **stolen** refresh token:

```js
// 1. Legitimate use — this rotates the token
await refresh(stolenToken).expect(200);

// 2. The "attacker" replays the same (now revoked) token
const replay = await refresh(stolenToken).expect(401);
expect(replay.body.error.message).toMatch(/security/i);

// ⭐ 3. The crucial assertion: EVERY token for this user is now revoked
expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
```

That third assertion is the whole point — **including the new token the legitimate user was holding.** Both parties are logged out; only the real user can log back in. Being able to demonstrate this signals you understand the OAuth 2.0 Security BCP, not just "JWTs".

### The hash never leaves the server

```js
expect(res.body.data.user.password).toBeUndefined();
expect(JSON.stringify(res.body)).not.toContain('$2a$');   // belt and braces
```

Verifies the whole chain — [`select: false`](../models/User.js.md) **and** the `toJSON` transform — **at the HTTP boundary**, so it covers any endpoint someone adds later. The second line catches a leak through some nested field.

### Stored hashed, not plaintext

```js
const stored = await User.findOne({ email }).select('+password');
expect(stored.password).not.toBe(validUser.password);
expect(stored.password).toMatch(/^\$2[aby]\$/);
```

⭐ Note it goes **around the API and looks directly at the database**. That's the only way to verify the `pre('save')` hook actually ran — an API response would tell you nothing.

### A deleted user's token stops working

```js
await User.deleteMany({});
const res = await me(accessToken).expect(401);
expect(res.body.error.code).toBe('USER_DELETED');
```

⭐ **This is the test that justifies the per-request DB lookup** in [`verifyAccessToken`](../middleware/auth.js.md). Without that lookup, a deleted user's token would keep working until expiry. With it, rejected immediately — and this proves it.

## `test.each` for validation

```js
test.each([
  ['missing name',    { email: 'a@b.co', password: 'Password123' }],
  ['invalid email',   { name: 'X', email: 'not-an-email', ... }],
  ['short password',  { ... }],
  ['no digit',        { ... }],
])('rejects %s with 400', async (_label, payload) => { ... });
```

Table-driven tests for the same assertion across many inputs — one test body, four cases, and the `%s` label makes failures readable.

## Interview questions

- **"What does an integration test catch that a unit test can't?"** → Middleware order, wiring, hooks, real DB error codes.
- **"Why Supertest instead of starting a server?"** → It binds an ephemeral port from the app object — no conflicts, no leaks. Enabled by the app/server split.
- **"How do you test a multi-request session flow?"** → `request.agent()` for the cookie jar.
- **"How would you test for user enumeration?"** → Assert the two failure responses are *identical*.
- **"How do you verify a password is actually hashed?"** → Query the database directly; the API response can't tell you.

## Related

- [`controllers/authController.js`](../controllers/authController.js.md) — the code under test
- [`models/RefreshToken.js`](../models/RefreshToken.js.md) — rotation and reuse detection
- [`middleware/validate.js`](../middleware/validate.js.md) — the defences being verified
- [`setup.js`](./setup.js.md) — the in-memory database
