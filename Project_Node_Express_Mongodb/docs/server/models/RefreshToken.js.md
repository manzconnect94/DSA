# `server/models/RefreshToken.js`

> The revocation lever. This collection is the answer to "you can't log out a stateless JWT".

**Lines:** 155 · **Concept blocks:** 7

## The design in one table

| | Access token | Refresh token |
|---|---|---|
| Stored server-side? | **No** | **Yes — here** |
| Verified by | Signature alone | Signature **+ this collection** |
| Lifetime | 15 min | 7 days |
| Revocable? | ❌ Not until expiry | ✅ **Instantly** — delete the row |
| DB cost | Zero per request | One lookup per *refresh* (~every 15 min) |

⭐ **That asymmetry is the whole design:** ~99.9% of requests are validated with zero DB hits, and you still keep a revocation lever. Explaining this trade-off is the strongest available answer on JWT auth.

## Schema

| Field | Notes |
|---|---|
| `user` | Indexed — "revoke every session for this user" |
| `jti` | Unique. Lets you revoke **one** session (this phone) not all. |
| `tokenHash` | **sha256 of the token**, indexed. Never the raw value. |
| `expiresAt` | **TTL index** |
| `revokedAt` / `revokedReason` | `logout` \| `rotated` \| `reuse-detected` \| `admin-revoked` \| `password-changed` |
| `replacedByJti` | The rotation chain |
| `userAgent` / `ip` | For a "your sessions" UI |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Server-side storage = the revocation lever** | The core asymmetry above. |
| **`jti`** | The standard mechanism for per-token revocation and JWT denylists. |
| **⭐ Store a HASH, never the raw token** | "You store refresh tokens — what if the DB leaks?" Plaintext would hand the attacker **live sessions for every user**, surviving a password reset. Storing `sha256(token)` makes a dump useless. **Why SHA-256 and not bcrypt?** The token is already ~128 bits of cryptographic randomness, so there's no dictionary to attack — bcrypt's slow-KDF property is pointless and would make every refresh 100ms slower. **Bcrypt is for low-entropy human secrets; a fast hash is fine for high-entropy machine-generated ones.** |
| **Revocation flag vs hard delete** | Keeping the row is what lets you **detect replay**. Worth the storage, which the TTL reclaims anyway. |
| **Device metadata** | Powers the "logged in on Chrome, iPhone" screen. ⚠️ Don't over-trust it — User-Agent is client-controlled and trivially spoofed, and IP changes legitimately on mobile. Binding a session strictly to an IP mostly just logs out commuters. |
| **TTL index** | See below. |
| **⭐ Rotation + reuse detection** | See below. |

## TTL index details

```js
{ expiresAt: 1 }, { expireAfterSeconds: 0 }
```

No cron needed — MongoDB deletes the document once the date passes. Three details interviewers probe:

1. ⚠️ **The background task runs roughly every 60 seconds**, so deletion is *eventual* — a document can survive up to a minute past expiry. **Never rely on a TTL index for security-critical expiry.** This code also checks `expiresAt` in application logic.
2. The indexed field **must be a Date**. A number or ISO string is silently ignored — the index exists and never deletes anything.
3. Only the replica-set **primary** runs it; secondaries get deletes via the oplog.

## ⭐ Rotation + reuse detection

**Rotation:** every use of a refresh token revokes it and issues a new one. Each token is therefore **single-use**.

**Reuse detection:** because of that, seeing an **already-revoked** token presented again is proof something is wrong. Either the real user's token was stolen and the thief is using it, or the thief used it first and the real user is replaying. **You cannot tell which** — so the correct response is to revoke the **entire family** for that user and force a fresh login. The attacker loses access; the user re-authenticates once.

This is the OAuth 2.0 Security BCP recommendation for public clients. Implemented in [`authController.refresh`](../controllers/authController.js.md) and [tested explicitly](../tests/integration.auth.test.js.md).

## API

| Member | Purpose |
|---|---|
| `RefreshToken.revokeFamily(userId, reason)` | Revokes every active token for a user |
| `RefreshToken.findActiveByHash(hash)` | Lookup by `sha256(token)` |
| `doc.isActive()` | Checks **both** `revokedAt` and `expiresAt` — belt and braces, because the TTL is eventual |

## Interview questions

- **"How do you log out a stateless JWT?"** → You revoke the refresh token here. The access token stays valid until expiry — say that part out loud, it's the point of the question.
- **"Your sessions table leaks. How bad?"** → With hashes, not bad. With plaintext, total compromise of every session.
- **"Why bcrypt for passwords but SHA-256 for tokens?"** → Entropy. Bcrypt's cost exists to slow dictionary attacks on low-entropy secrets; a random 128-bit token has no dictionary.
- **"How precise is a TTL index?"** → Eventual, ~60s sweep. Check expiry in code too.
- **"How do you handle a stolen refresh token?"** → Rotation makes it single-use; reuse detection revokes the whole family on replay.

## Related

- [`utils/tokens.js`](../utils/tokens.js.md) — signing, `jti` generation, `hashToken`
- [`controllers/authController.js`](../controllers/authController.js.md) — the rotation and reuse-detection logic
- [`tests/integration.auth.test.js`](../tests/integration.auth.test.js.md) — the reuse-detection test
- [`client/src/api/axiosClient.js`](../../client/src/api/axiosClient.js.md) — ⭐ why the client needs **single-flight** refresh, or rotation causes random logouts
- [`jobs/cleanupJob.js`](../jobs/cleanupJob.js.md) — pruning what the TTL doesn't cover
