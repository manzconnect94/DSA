# `server/utils/tokens.js`

> ⭐ JWT internals. Pure functions — no database, no `req`/`res` — which makes it the natural unit-test target.

**Lines:** 203 · **Concept blocks:** 5

## ⭐ JWT anatomy

Three base64url segments joined by dots:

```
eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiIxMjMifQ . dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
└────── header ─────┘  └───── payload ────┘  └──────────── signature ────────────────┘
```

| Segment | Contents |
|---|---|
| **Header** | `{"alg":"HS256","typ":"JWT"}` — which algorithm signed it |
| **Payload** | Your claims: `{"sub":"userId","role":"admin","iat":...,"exp":...}` |
| **Signature** | `HMAC_SHA256(base64(header) + "." + base64(payload), secret)` |

### ⚠️ The #1 misconception

**base64 is ENCODING, not ENCRYPTION.** Anyone can paste a JWT into jwt.io and read the payload. So **never** put a password, a credit card, or a secret in a JWT.

What the signature guarantees is **integrity** (nobody altered the claims), **not confidentiality**. [A test asserts this explicitly](../tests/unit.tokens.test.js.md) by decoding without the secret.

### ⚠️ The "alg: none" attack

Old JWT libraries trusted the header's `alg` field. An attacker sets `alg: "none"`, strips the signature, and the library accepts it. Modern libraries require you to pass the expected algorithms — which is why **every** `jwt.verify()` call here passes `algorithms: ['HS256']` explicitly. **Never omit it.** [Tested.](../tests/unit.tokens.test.js.md)

## ⭐ Stateless access vs stateful refresh

The core trade-off of JWT auth.

| | **Access token** | **Refresh token** |
|---|---|---|
| State | **Stateless** — verified by signature alone | **Stateful** — stored in MongoDB |
| DB hit | **None.** Any instance can validate it → horizontal scaling | One lookup per refresh (~every 15 min) |
| Lifetime | 15 min | 7 days |
| Revocable | ❌ **No.** If a user is banned or logs out, the token stays valid until expiry. **That's why it's short-lived — the expiry window is your maximum exposure.** | ✅ **Instantly** — delete the row |

⭐ **Net effect:** ~99.9% of requests are validated with **zero DB hits**, and you still keep a revocation lever.

## ⭐ `verify()` vs `decode()` — the difference that gets people rejected

| | What it does |
|---|---|
| `jwt.decode(token)` | Just base64-decodes the payload. **ZERO cryptographic checks.** An attacker can hand-craft `{"sub":"<admin id>","role":"admin"}`, base64 it, and decode() happily returns it. **Using decode() for auth is a total bypass.** |
| `jwt.verify(token, secret)` | Recomputes the HMAC over header+payload and compares to the signature, **and** checks `exp`/`nbf`/`iss`. **Only verify() is an authentication check.** |

Nothing in this codebase calls `decode()` for auth.

## ⭐ Where to store tokens on the frontend (XSS vs CSRF)

**There is no option with zero risk** — the interviewer wants to hear you reason about the trade-off.

| | ✅ | ❌ |
|---|---|---|
| **1. localStorage** | Survives refresh, trivially readable by your JS, **no CSRF risk** (the browser never attaches it automatically) | **Any XSS** — including one in a third-party npm package — can do `localStorage.getItem('token')` and exfiltrate it. **Worst option for a long-lived token.** |
| **2. In-memory** (a JS variable / React state) | Not reachable by a stored XSS payload on another page; gone when the tab closes, so a stolen device yields nothing | **Lost on every page refresh** — which is exactly why you need a refresh token to silently re-issue it on app boot |
| **3. httpOnly cookie** | JavaScript **literally cannot read it** (`document.cookie` skips httpOnly), so XSS cannot steal it | The browser attaches it to every matching request **automatically** — which is precisely what **CSRF** exploits. Mitigate with `SameSite` + a CSRF token for state-changing requests. |

⭐ **This app uses the standard hybrid:** access token in **memory** (option 2 — [`AuthContext`](../../client/src/context/AuthContext.jsx.md)), refresh token in an **httpOnly + SameSite cookie** (option 3). XSS cannot read the refresh token; SameSite blunts CSRF; and the access token's 15-minute life caps the damage if it's somehow captured.

## Cookie options

```js
{
  httpOnly: true,                            // XSS-resistant
  secure: isProd,                            // HTTPS only in prod; must be false on localhost http
  sameSite: isProd ? 'strict' : 'lax',       // primary CSRF defence
  path: '/api/auth',                         // ⭐ scoped — NOT sent on every API call
  maxAge: 7 days,
}
```

⭐ **Path scoping** means the cookie isn't attached to every request — smaller attack surface and less bandwidth.

⚠️ **`clearRefreshCookie` must pass the SAME path/sameSite options** or the browser won't match and clear it — a subtle, very common logout bug. [Asserted in tests.](../tests/unit.tokens.test.js.md)

## Hashing the refresh token

Store `sha256(token)`, never the raw value. **Why SHA-256 and not bcrypt**, when we bcrypt passwords? The token is already ~128 bits of cryptographic randomness, so there's **no dictionary to attack** — bcrypt's slow-KDF property is pointless and would make every refresh 100ms slower.

⭐ **Bcrypt is for LOW-ENTROPY human secrets; a fast hash is fine for HIGH-ENTROPY machine-generated ones.**

## API

| Export | Purpose |
|---|---|
| `signAccessToken(user)` | `{ sub, role, type:'access' }`, 15 min. Payload is minimal — **every byte is sent on every request.** |
| `signRefreshToken(user, jti?)` | `{ sub, jti, type:'refresh' }`, returns `{ token, jti }` |
| `verifyAccessToken(token)` | verify + `algorithms` + `issuer` + **`type` check** |
| `verifyRefreshToken(token)` | same, for refresh |
| `hashToken(token)` | sha256 hex |
| `setRefreshCookie` / `clearRefreshCookie` / `refreshCookieOptions` | Cookie handling |
| `REFRESH_COOKIE_NAME` | `'refreshToken'` |

The `type` claim is **defence in depth** on top of separate secrets: a refresh token reaching `verifyAccessToken` is rejected twice over. [Tested both directions.](../tests/unit.tokens.test.js.md)

⚠️ Note on the access payload: `role` is a **snapshot**. Embed it, then demote the user, and the old token still says "admin" until it expires. See [`adminController`](../controllers/adminController.js.md).

## Interview questions

- **"What are a JWT's three parts?"** → header.payload.signature. Then immediately: the payload is **not encrypted**.
- **"Can you put a password in a JWT?"** → No — base64 is reversible with no key.
- **"`verify()` or `decode()`?"** → decode does nothing cryptographic. Total bypass.
- **"What's the `alg: none` attack?"** → Header-declared algorithm trusted by the library. Fix: always pass an algorithm allowlist.
- **"localStorage or cookie?"** → Neither is risk-free. Walk the three options and describe the hybrid.
- **"Why bcrypt passwords but SHA-256 tokens?"** → Entropy. No dictionary exists for a random 128-bit value.
- **"Why two different secrets?"** → Otherwise a refresh token validates as an access token.

## Related

- [`middleware/auth.js`](../middleware/auth.js.md) — the verification side
- [`controllers/authController.js`](../controllers/authController.js.md) — the full flow
- [`models/RefreshToken.js`](../models/RefreshToken.js.md) — where the hash is stored
- [`tests/unit.tokens.test.js`](../tests/unit.tokens.test.js.md) — tamper, expiry and `alg:none` tests
- [`client/src/api/axiosClient.js`](../../client/src/api/axiosClient.js.md) — where the in-memory storage lives
