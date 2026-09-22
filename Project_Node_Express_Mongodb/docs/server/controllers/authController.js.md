# `server/controllers/authController.js`

> The complete JWT access + refresh flow. Being able to narrate this end to end is the difference between "I've used JWT" and "I understand JWT".

**Lines:** 501 · **Concept blocks:** 12

## The full lifecycle

| Step | Endpoint | What happens |
|---|---|---|
| 1 | `POST /register` | bcrypt-hash (via the model hook), create user, issue both tokens |
| 2 | `POST /login` | Verify password → **access** (15 min, response body) + **refresh** (7 days, httpOnly cookie **and** hashed in Mongo) |
| 3 | *any API call* | Access token verified by **signature alone** — no DB hit. This is what makes the API horizontally scalable. |
| 4 | *15 min later* | API returns `401 TOKEN_EXPIRED` |
| 5 | `POST /refresh` | Cookie sent automatically → verify signature **+ DB** → new access token **and rotate** the refresh token |
| 6 | `POST /logout` | Revoke the DB row. Refresh dies instantly; access dies within 15 min. |

⭐ **Why two tokens:** one long-lived token means a theft grants a week of access with no way to stop it. One short-lived token means re-login every 15 minutes. The split gives you both — the frequently-sent credential is short-lived and stateless (fast), and the long-lived one is rarely sent, harder to steal (httpOnly, path-scoped) and revocable.

## Handlers

| Handler | Route | Notes |
|---|---|---|
| `register` | `POST /register` | Explicit 3-field allowlist |
| `login` | `POST /login` | Enumeration + timing defences, session cap |
| `refresh` | `POST /refresh` | 3-step validation, rotation, reuse detection |
| `logout` | `POST /logout` | Idempotent |
| `logoutAll` | `POST /logout-all` | `revokeFamily` |
| `me` | `GET /me` | `Promise.all` of 4 independent queries |
| `listSessions` | `GET /sessions` | Device list, flags the current one |
| `changePassword` | `PATCH /password` | Re-auth required; revokes all sessions |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **The complete flow** | The table above. |
| **Explicit field allowlist** | Note what it *doesn't* do: `User.create(req.body)`. Three fields are destructured, so even if validation were removed, `role: 'admin'` is never read. Two independent layers. |
| **⚠️ Check-then-insert race** | The `findOne` pre-check is a **UX nicety, not the guarantee**. Two simultaneous requests can both pass it (neither has inserted yet) — a TOCTOU race. The actual guarantee is the **unique index**, the only atomic thing involved. **Never enforce a constraint with a read followed by a write.** |
| **⭐ User enumeration + timing** | See below — one of the best blocks in the codebase. |
| **Capping concurrent sessions** | Without a cap, a user who logs in daily for a year has 365 live standing credentials. Bounded to 5, evicting the oldest. |
| **Access token in the BODY, not a cookie** | Deliberate asymmetry: the body forces the client to attach it manually as a header, so those requests are **structurally immune to CSRF**. A cookie would be attached automatically — including by evil.com. **Each token gets the protection matching its threat.** |
| **⭐ Refresh with rotation + reuse detection** | See below. |
| **What "logout" actually means** | See below. |
| **Logout is idempotent** | If the token is already gone, the desired end state is satisfied. Returning 401 from logout is a real UX bug — the client's error handler may try to refresh, fail, and trap the user. |
| **`Promise.all` for independent queries** | `me` runs 4 queries in parallel: ~20ms instead of ~60ms sequential. ⚠️ Caveat worth volunteering: `Promise.all` over 10,000 items opens 10,000 concurrent queries and exhausts the [pool](../config/db.js.md). |
| **⚠️ Aggregation doesn't cast ObjectIds** | A genuinely nasty bug. `find()` consults the schema and casts a string to ObjectId; **an aggregation pipeline bypasses the schema entirely.** So `$match: { owner: "6512ab..." }` compares a string to an ObjectId, **matches nothing, and returns an empty array** — no error, no warning, your stats page silently shows zero. |
| **Re-authenticate before a sensitive action** | Even with a valid token, demand the current password before changing it. If an attacker briefly obtains a token, without this they take permanent ownership; with it, the 15-minute window expires and the user keeps control. |

## ⭐ User enumeration and the timing side channel

**The naive version:**

```js
if (!user)  return res.status(404).json({ msg: 'No user with that email' });
if (!match) return res.status(401).json({ msg: 'Wrong password' });
```

The attacker now has an **oracle**: feed in a leaked email list and the different responses reveal exactly which addresses have accounts. For a dating site, a medical service or a political org, merely confirming someone *has* an account is the breach. It also focuses a subsequent credential-stuffing attack on only the addresses that will work.

**Fix 1** — one identical error for both cases: same status, same message, same shape.

**⚠️ Fix 2 — the timing leak, which most people miss.** Even with identical messages the paths differ in cost:

| Case | Work done | Time |
|---|---|---|
| Unknown email | Return immediately | ~5ms |
| Known email | Run `bcrypt.compare` | ~100ms |

A 95ms difference is trivially measurable over a network and **rebuilds the oracle**. The fix: always perform a bcrypt comparison — against a dummy hash when the user doesn't exist — so both paths cost the same.

The same reasoning applies to "forgot password": always respond "if that account exists, we've sent an email".

## ⭐ Refresh: three steps

```
1. Verify SIGNATURE            ← cheap, no DB
2. Verify against the DATABASE ← the revocation check; the whole point of statefulness
3. ROTATE                      ← revoke the old, issue a new one
```

Step 3 makes a stolen refresh token time-limited: the thief's copy stops working the moment the real user refreshes.

**Reuse detection** closes the loop. A request presenting an already-revoked token means either the attacker used a stolen token (and the real user is replaying their dead copy), or the reverse. You can't distinguish — so revoke the **whole family** and force a login. Logged at `error` level with a 🚨 marker.

⚠️ This is exactly why the client needs [**single-flight** refresh](../../client/src/api/axiosClient.js.md). Five parallel 401s → five refresh calls → the first rotates, the other four present a revoked token → reuse detected → the user is logged out at random.

## ⭐ What logout actually means

| | Effect |
|---|---|
| Refresh token | ✅ Revoked in the DB. Genuinely dead, immediately. |
| Cookie | ✅ Cleared. |
| **Access token** | ⚠️ **Still cryptographically valid until it expires.** Nothing server-side can un-sign it. |

If you need instant access-token revocation: a Redis **denylist** keyed by `jti` with a TTL equal to the remaining life (but you've reintroduced a per-request lookup), a per-user `tokenVersion` counter (same trade-off), or just a very short expiry.

**The interviewer is checking whether you know the limitation exists.** "Logout invalidates the JWT" without qualification is the wrong answer.

## Shared helper

`issueTokenPair(user, req, { replacesJti })` — signs both tokens, persists `sha256(refresh)` with device metadata, links the rotation chain. Used by register, login and refresh so rotation logic exists in exactly one place.

## Interview questions

- **"Walk me through your auth flow."** → The 6-step table, then the two-token rationale.
- **"What's wrong with 'no user with that email'?"** → Enumeration. Then volunteer the timing leak — that's what distinguishes the answer.
- **"How do you log out a JWT?"** → Revoke the refresh token; the access token survives until expiry. Name the denylist option and its cost.
- **"How do you handle a stolen refresh token?"** → Rotation + reuse detection + family revocation.
- **"Two users register the same email simultaneously."** → Both pass the pre-check; the unique index rejects the second with 11000 → 409.
- **"Why does my aggregation return nothing when `find` works?"** → Pipelines bypass schema casting. Cast the ObjectId manually.

## Related

- [`utils/tokens.js`](../utils/tokens.js.md) — JWT internals, storage trade-offs
- [`models/RefreshToken.js`](../models/RefreshToken.js.md) — rotation, hashing, TTL
- [`middleware/auth.js`](../middleware/auth.js.md) — the verification side
- [`middleware/rateLimiter.js`](../middleware/rateLimiter.js.md) — the login limiter
- [`tests/integration.auth.test.js`](../tests/integration.auth.test.js.md) — enumeration and reuse-detection tests
- [`client/src/api/axiosClient.js`](../../client/src/api/axiosClient.js.md) — the client mirror
