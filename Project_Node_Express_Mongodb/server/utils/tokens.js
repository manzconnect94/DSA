// ============================================================
// 🧠 CONCEPT: JWT internals — header.payload.signature
// WHY IT MATTERS (interview angle): this is the single most-asked auth topic.
//   A JWT is three base64url-encoded segments joined by dots:
//
//     eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiIxMjMifQ . dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
//     └────── header ─────┘  └───── payload ────┘  └──────────── signature ────────────────┘
//
//   • HEADER   — {"alg":"HS256","typ":"JWT"}. Which algorithm signed it.
//   • PAYLOAD  — your claims: {"sub":"userId","role":"admin","iat":...,"exp":...}
//   • SIGNATURE— HMAC_SHA256(base64(header) + "." + base64(payload), secret)
//
//   ⚠️ THE #1 MISCONCEPTION: base64 is ENCODING, not ENCRYPTION. Anyone can
//   paste a JWT into jwt.io and read the payload. So NEVER put a password,
//   a credit card, or a secret in a JWT. What the signature guarantees is
//   INTEGRITY (nobody altered the claims), not CONFIDENTIALITY.
//
//   ⚠️ THE "alg: none" ATTACK: old JWT libraries would trust the header's
//   `alg` field. An attacker sets `alg: "none"`, strips the signature, and
//   the library accepts it. Modern libs require you to pass the expected
//   algorithms — which is why every jwt.verify() call below passes
//   `algorithms: ['HS256']` explicitly. Never omit it.
//
// HOW IT WORKS HERE: pure functions (no DB, no req/res), which makes them
//   the natural target for the UNIT test in tests/unit.tokens.test.js.
// ============================================================

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

const ALGORITHM = 'HS256';

// ============================================================
// 🧠 CONCEPT: Stateless access token vs stateful refresh token
// WHY IT MATTERS (interview angle): the core trade-off of JWT auth.
//   • ACCESS TOKEN is STATELESS: the server verifies the signature with a
//     secret and trusts the claims. No DB lookup -> fast, and any instance
//     can validate it (this is what makes horizontal scaling easy — see the
//     scaling section of the README). The COST: you cannot revoke it. If a
//     user is banned or logs out, their access token stays valid until it
//     expires. That is why it is SHORT-LIVED (15 min) — the expiry window is
//     your maximum exposure.
//   • REFRESH TOKEN is STATEFUL: stored in MongoDB (see models/RefreshToken).
//     Long-lived (7 days), but every use is checked against the DB, so
//     deleting the row revokes it INSTANTLY. That DB round-trip is
//     acceptable because refresh happens once every 15 minutes, not on
//     every request.
//   Net effect: ~99.9% of requests are validated with zero DB hits, and you
//   still keep a revocation lever.
// ============================================================

/**
 * Sign a short-lived access token.
 * Payload is deliberately minimal: id + role. Every byte here is sent on
 * EVERY request in the Authorization header, so a fat payload is real
 * bandwidth. Also, claims are a snapshot — if you embed `role` and then
 * demote the user, the old token still says "admin" until it expires.
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user._id ?? user.id),
      role: user.role,
      // `type` lets verifyAccessToken reject a refresh token that somehow
      // reaches it — defence in depth on top of using separate secrets.
      type: 'access',
    },
    config.jwt.accessSecret,
    {
      algorithm: ALGORITHM,
      expiresIn: config.jwt.accessExpiresIn,
      issuer: 'mern-interview-boilerplate',
    }
  );
}

/**
 * Sign a long-lived refresh token.
 * `jti` (JWT ID) is a random unique id. We store the jti in Mongo so a
 * specific token can be revoked without invalidating the user's other
 * sessions (phone vs laptop).
 */
function signRefreshToken(user, jti = crypto.randomUUID()) {
  const token = jwt.sign(
    {
      sub: String(user._id ?? user.id),
      jti,
      type: 'refresh',
    },
    config.jwt.refreshSecret,
    {
      algorithm: ALGORITHM,
      expiresIn: config.jwt.refreshExpiresIn,
      issuer: 'mern-interview-boilerplate',
    }
  );
  return { token, jti };
}

// ============================================================
// 🧠 CONCEPT: verify() vs decode() — the difference that gets people rejected
// WHY IT MATTERS (interview angle): `jwt.decode(token)` just base64-decodes
//   the payload. It performs ZERO cryptographic checks. An attacker can
//   hand-craft {"sub":"<admin id>","role":"admin"}, base64 it, and decode()
//   will happily return it. Using decode() for auth is a total bypass.
//   `jwt.verify(token, secret)` recomputes the HMAC over header+payload and
//   compares it to the signature, AND checks `exp`/`nbf`/`iss`. Only verify()
//   is an authentication check.
// HOW IT WORKS HERE: nothing in this codebase calls decode() for auth.
//   Both functions below use verify() with an explicit algorithm allowlist.
// ============================================================

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.accessSecret, {
    algorithms: [ALGORITHM], // blocks the "alg: none" / algorithm-confusion attack
    issuer: 'mern-interview-boilerplate',
  });
  if (payload.type !== 'access') {
    throw new jwt.JsonWebTokenError('Expected an access token');
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwt.refreshSecret, {
    algorithms: [ALGORITHM],
    issuer: 'mern-interview-boilerplate',
  });
  if (payload.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Expected a refresh token');
  }
  return payload;
}

// ============================================================
// 🧠 CONCEPT: Hashing the refresh token before storing it
// WHY IT MATTERS (interview angle): "You store refresh tokens in the DB —
//   what if the DB leaks?" If you stored them in plaintext, the attacker
//   now has working sessions for every user. Treat a refresh token like a
//   password: store only a hash. SHA-256 (not bcrypt) is correct here
//   because the token is already 100+ bits of cryptographic randomness, so
//   it is not brute-forceable and does not need a slow KDF.
// HOW IT WORKS HERE: we persist sha256(token) and compare hashes on refresh.
// ============================================================
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ============================================================
// 🧠 CONCEPT: Where to store tokens on the FRONTEND (XSS vs CSRF)
// WHY IT MATTERS (interview angle): there is no option with zero risk; the
//   interviewer wants to hear you reason about the trade-off.
//
//   1) localStorage
//      ✅ survives refresh, trivially readable by your JS, no CSRF risk
//         (the browser never attaches it automatically).
//      ❌ ANY XSS — including one in a third-party npm package — can do
//         `localStorage.getItem('token')` and exfiltrate it. Worst option
//         for a long-lived token.
//
//   2) In-memory (a JS variable / React state)
//      ✅ not reachable by a stored XSS payload on another page; gone the
//         moment the tab closes, so a stolen device yields nothing.
//      ❌ lost on every page refresh — which is exactly why you need a
//         refresh token to silently re-issue it on app boot.
//
//   3) httpOnly cookie
//      ✅ JavaScript literally cannot read it (document.cookie skips
//         httpOnly), so XSS cannot steal it.
//      ❌ the browser attaches it to every matching request AUTOMATICALLY,
//         which is precisely what CSRF exploits. Mitigate with
//         SameSite=Strict/Lax + a CSRF token for state-changing requests.
//
//   THIS APP USES THE STANDARD HYBRID: access token in memory (option 2,
//   React state — see client/src/context/AuthContext.jsx), refresh token in
//   an httpOnly + SameSite cookie (option 3 — see setRefreshCookie below).
//   XSS cannot read the refresh token; SameSite blunts CSRF; and the access
//   token's 15-minute life caps the damage if it is somehow captured.
// ============================================================
function refreshCookieOptions() {
  return {
    httpOnly: true, // document.cookie cannot see it -> XSS-resistant
    secure: config.isProd, // HTTPS only in prod; must be false on localhost http
    sameSite: config.isProd ? 'strict' : 'lax', // primary CSRF defence
    // Scoping the cookie to the refresh path means it is NOT sent on every
    // API call — smaller attack surface and less bandwidth.
    path: '/api/auth',
    maxAge: config.jwt.refreshExpiresMs,
  };
}

const REFRESH_COOKIE_NAME = 'refreshToken';

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  // Must pass the SAME path/sameSite options or the browser will not match
  // and clear the cookie — a subtle, very common logout bug.
  const { maxAge, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, opts);
}

module.exports = {
  ALGORITHM,
  REFRESH_COOKIE_NAME,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  setRefreshCookie,
  clearRefreshCookie,
  refreshCookieOptions,
};
