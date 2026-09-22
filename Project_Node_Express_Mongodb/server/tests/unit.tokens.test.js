// ============================================================
// 🧠 CONCEPT: UNIT TESTS — testing a pure function in isolation
// WHY IT MATTERS (interview angle): utils/tokens.js is the ideal unit-test
//   target because it is PURE: same input -> same output, no database, no
//   network, no req/res. That means these tests are milliseconds fast, 100%
//   deterministic, and when one fails you know EXACTLY which function is
//   broken — no "is it the route, the middleware, or the DB?" bisecting.
//   This is why "extract the logic into a pure function" is such common
//   testability advice: it is the difference between a 2ms test and a 2s one.
// ============================================================

const jwt = require('jsonwebtoken');
const tokenUtils = require('../utils/tokens');
const config = require('../config/env');

// A plain object standing in for a Mongoose user document. No DB needed —
// the functions only read _id and role.
const fakeUser = { _id: '507f1f77bcf86cd799439011', role: 'user' };
const fakeAdmin = { _id: '507f1f77bcf86cd799439012', role: 'admin' };

describe('utils/tokens — signing', () => {
  test('signAccessToken produces a three-part JWT', () => {
    const token = tokenUtils.signAccessToken(fakeUser);

    // header.payload.signature — see the JWT anatomy block in utils/tokens.js
    expect(token.split('.')).toHaveLength(3);
    expect(typeof token).toBe('string');
  });

  test('the payload is READABLE by anyone (base64 is not encryption)', () => {
    // ⚠️ This test exists to make the point concrete: we decode WITHOUT the
    // secret and still get the claims. Never put anything sensitive in a JWT.
    const token = tokenUtils.signAccessToken(fakeAdmin);
    const [, payloadSegment] = token.split('.');

    const decoded = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));

    expect(decoded.sub).toBe(String(fakeAdmin._id));
    expect(decoded.role).toBe('admin'); // ← plainly visible to anybody
    expect(decoded.type).toBe('access');
  });

  test('includes standard claims: iat, exp, iss', () => {
    const token = tokenUtils.signAccessToken(fakeUser);
    const decoded = jwt.decode(token);

    expect(decoded.iat).toEqual(expect.any(Number)); // issued at
    expect(decoded.exp).toEqual(expect.any(Number)); // expires at
    expect(decoded.iss).toBe('mern-interview-boilerplate');
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  test('signRefreshToken returns a token AND a unique jti', () => {
    const a = tokenUtils.signRefreshToken(fakeUser);
    const b = tokenUtils.signRefreshToken(fakeUser);

    expect(a.jti).toEqual(expect.any(String));
    // Distinct jti per token is what allows revoking ONE session rather
    // than all of a user's sessions.
    expect(a.jti).not.toBe(b.jti);
  });
});

describe('utils/tokens — verification', () => {
  test('verifyAccessToken accepts a token we signed', () => {
    const token = tokenUtils.signAccessToken(fakeUser);
    const payload = tokenUtils.verifyAccessToken(token);

    expect(payload.sub).toBe(String(fakeUser._id));
    expect(payload.role).toBe('user');
  });

  // ============================================================
  // 🧠 CONCEPT: Testing that TAMPERING is rejected
  // WHY IT MATTERS (interview angle): this is the test that proves the
  //   signature actually does something. We forge an admin payload, glue on
  //   the original signature, and assert that verify() rejects it. Without
  //   a test like this, a refactor that accidentally swapped verify() for
  //   decode() would pass every other test in the suite while completely
  //   opening the door.
  // ============================================================
  test('REJECTS a token whose payload was tampered with', () => {
    const token = tokenUtils.signAccessToken(fakeUser);
    const [header, , signature] = token.split('.');

    // The attacker rewrites the payload to claim admin.
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: String(fakeUser._id), role: 'admin', type: 'access' })
    ).toString('base64url');

    const forged = `${header}.${forgedPayload}.${signature}`;

    // decode() would happily hand back role: 'admin' ...
    expect(jwt.decode(forged).role).toBe('admin');

    // ... but verify() recomputes the HMAC and the signature no longer matches.
    expect(() => tokenUtils.verifyAccessToken(forged)).toThrow(jwt.JsonWebTokenError);
  });

  test('REJECTS a token signed with the wrong secret', () => {
    const rogue = jwt.sign({ sub: 'x', type: 'access' }, 'a-different-secret', {
      algorithm: 'HS256',
      issuer: 'mern-interview-boilerplate',
    });

    expect(() => tokenUtils.verifyAccessToken(rogue)).toThrow(jwt.JsonWebTokenError);
  });

  // ============================================================
  // 🧠 CONCEPT: Access and refresh tokens must NOT be interchangeable
  // WHY IT MATTERS (interview angle): proves the separate-secrets design
  //   from config/env.js. A stolen 7-day refresh token must not work as a
  //   15-minute access token.
  // ============================================================
  test('a refresh token is NOT accepted as an access token', () => {
    const { token: refreshToken } = tokenUtils.signRefreshToken(fakeUser);
    expect(() => tokenUtils.verifyAccessToken(refreshToken)).toThrow();
  });

  test('an access token is NOT accepted as a refresh token', () => {
    const accessToken = tokenUtils.signAccessToken(fakeUser);
    expect(() => tokenUtils.verifyRefreshToken(accessToken)).toThrow();
  });

  test('REJECTS an expired token', () => {
    // Sign one that expired an hour ago.
    const expired = jwt.sign({ sub: 'x', type: 'access' }, config.jwt.accessSecret, {
      algorithm: 'HS256',
      issuer: 'mern-interview-boilerplate',
      expiresIn: '-1h',
    });

    expect(() => tokenUtils.verifyAccessToken(expired)).toThrow(jwt.TokenExpiredError);
  });

  // ============================================================
  // 🧠 CONCEPT: Testing the "alg: none" attack is blocked
  // WHY IT MATTERS (interview angle): a famous JWT vulnerability. The
  //   attacker sets the header algorithm to "none" and strips the
  //   signature. Libraries that trust the header accept it. Passing
  //   `algorithms: ['HS256']` to verify() is what blocks it — and this test
  //   is what stops someone removing that option in a future refactor.
  // ============================================================
  test('REJECTS an unsigned "alg: none" token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'attacker', role: 'admin', type: 'access' })).toString('base64url');
    const noneToken = `${header}.${payload}.`; // empty signature

    expect(() => tokenUtils.verifyAccessToken(noneToken)).toThrow();
  });
});

describe('utils/tokens — hashing', () => {
  test('hashToken is deterministic and one-way', () => {
    const token = 'some-refresh-token-value';

    // Same input -> same hash (so we can look it up in Mongo).
    expect(tokenUtils.hashToken(token)).toBe(tokenUtils.hashToken(token));

    // SHA-256 hex is always 64 characters.
    expect(tokenUtils.hashToken(token)).toHaveLength(64);

    // The original is not recoverable from, or present in, the hash.
    expect(tokenUtils.hashToken(token)).not.toContain(token);
  });

  test('different tokens hash differently', () => {
    expect(tokenUtils.hashToken('a')).not.toBe(tokenUtils.hashToken('b'));
  });
});

describe('utils/tokens — cookie options', () => {
  // ============================================================
  // 🧠 CONCEPT: Asserting on security-critical config
  // WHY IT MATTERS (interview angle): httpOnly and sameSite are one-line
  //   settings that are easy to delete while debugging and easy to forget
  //   to restore. A test that asserts on them turns a silent security
  //   regression into a failing build.
  // ============================================================
  test('the refresh cookie is httpOnly (XSS cannot read it)', () => {
    expect(tokenUtils.refreshCookieOptions().httpOnly).toBe(true);
  });

  test('the refresh cookie sets sameSite (CSRF defence)', () => {
    expect(['strict', 'lax']).toContain(tokenUtils.refreshCookieOptions().sameSite);
  });

  test('the refresh cookie is scoped to /api/auth, not the whole site', () => {
    // Narrow scoping means it is not attached to every API request —
    // smaller attack surface and less bandwidth.
    expect(tokenUtils.refreshCookieOptions().path).toBe('/api/auth');
  });
});
