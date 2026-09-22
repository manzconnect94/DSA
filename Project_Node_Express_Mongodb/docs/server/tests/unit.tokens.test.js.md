# `server/tests/unit.tokens.test.js`

> 16 unit tests on [`utils/tokens.js`](../utils/tokens.js.md). No database, no HTTP, no mocks.

**Lines:** 159 · **Concept blocks:** 5 · **Tests:** 16

## Why this is the ideal unit-test target

`utils/tokens.js` is **pure**: same input → same output, no database, no network, no `req`/`res`. That means:

- Tests run in **milliseconds**
- **100% deterministic** — no flake
- When one fails you know **exactly which function is broken** — no "is it the route, the middleware, or the DB?" bisecting

⭐ **This is why "extract the logic into a pure function" is such common testability advice** — it's the difference between a 2ms test and a 2s one.

## Coverage

| Group | Tests |
|---|---|
| **Signing** | 3-part structure · payload is readable without the secret · standard claims (`iat`/`exp`/`iss`) · unique `jti` per token |
| **Verification** | Accepts our own token · ⭐ **rejects tampering** · rejects the wrong secret · **refresh ≠ access** (both directions) · rejects expired · ⭐ **rejects `alg: none`** |
| **Hashing** | Deterministic · 64-char sha256 · one-way · different inputs differ |
| **Cookie options** | `httpOnly` · `sameSite` · path-scoped to `/api/auth` |

## ⭐ The tests worth studying

### "The payload is READABLE by anyone"

```js
const [, payloadSegment] = token.split('.');
const decoded = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
expect(decoded.role).toBe('admin');      // ← plainly visible to anybody
```

This test exists to **make the point concrete**: we decode **without the secret** and still get the claims. **base64 is encoding, not encryption.** Never put anything sensitive in a JWT.

### ⭐ "REJECTS a token whose payload was tampered with"

The test that proves the signature **actually does something**:

```js
const forgedPayload = base64url({ sub: userId, role: 'admin', type: 'access' });
const forged = `${header}.${forgedPayload}.${signature}`;   // original signature glued on

expect(jwt.decode(forged).role).toBe('admin');              // decode() hands back admin!
expect(() => verifyAccessToken(forged)).toThrow(jwt.JsonWebTokenError);  // verify() refuses
```

⭐ **Without a test like this, a refactor that accidentally swapped `verify()` for `decode()` would pass every other test in the suite while completely opening the door.** That's the value: it guards a property no functional test would notice.

### ⭐ "REJECTS an unsigned `alg: none` token"

A famous JWT vulnerability — the attacker sets the header algorithm to `none` and strips the signature; libraries that trust the header accept it. Passing `algorithms: ['HS256']` to `verify()` is what blocks it.

**This test is what stops someone removing that option in a future refactor.**

### Access and refresh are not interchangeable

Tested **both directions**. Proves the [separate-secrets design](../config/env.js.md): a stolen 7-day refresh token must not work as a 15-minute access token.

### Asserting on security-critical config

```js
expect(refreshCookieOptions().httpOnly).toBe(true);
expect(['strict','lax']).toContain(refreshCookieOptions().sameSite);
expect(refreshCookieOptions().path).toBe('/api/auth');
```

⭐ `httpOnly` and `sameSite` are **one-line settings that are easy to delete while debugging and easy to forget to restore.** A test that asserts on them turns a **silent security regression into a failing build.**

## The pattern to take away

These tests use **plain objects** as stand-ins:

```js
const fakeUser = { _id: '507f1f77bcf86cd799439011', role: 'user' };
```

No Mongoose, no database. The functions only read `_id` and `role`, so that's all the test provides. ⭐ **A test should supply the minimum the code under test actually needs** — anything more couples the test to irrelevant details and makes it brittle.

## Interview questions

- **"What makes code easy to unit test?"** → Purity: no I/O, no hidden state, deterministic. When something is hard to test, that's a design signal.
- **"How do you test that JWT verification works?"** → Forge a payload, keep the original signature, assert `verify()` rejects while `decode()` doesn't. That contrast *is* the test.
- **"What's the `alg: none` attack and how do you test for it?"** → Header-declared algorithm; craft a token with an empty signature and assert rejection.
- **"Should you test configuration?"** → For security-critical flags, yes — they're trivially deleted and silently dangerous.

## Related

- [`utils/tokens.js`](../utils/tokens.js.md) — the code under test
- [`middleware/auth.js`](../middleware/auth.js.md) — `verify` vs `decode` at the call site
- [`integration.auth.test.js`](./integration.auth.test.js.md) — the same concerns end to end over HTTP
