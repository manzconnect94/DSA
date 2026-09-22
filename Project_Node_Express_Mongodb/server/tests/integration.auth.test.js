// ============================================================
// 🧠 CONCEPT: INTEGRATION TESTS with Supertest
// WHY IT MATTERS (interview angle): a unit test proves one function works.
//   An integration test proves the PIECES WORK TOGETHER — routing,
//   middleware order, validation, the controller, the model, and the real
//   database. It catches an entire class of bug a unit test cannot: a
//   middleware registered in the wrong order, a route path typo, a
//   validation rule that rejects valid input, a Mongoose hook that doesn't
//   fire.
//
//   ⭐ WHY SUPERTEST AND NOT A REAL HTTP CLIENT: `request(app)` takes the
//   Express app OBJECT. Supertest binds it to an ephemeral port
//   automatically, makes the request, and tears it down. No fixed port
//   means no conflicts in CI and no leaked servers. This is exactly why
//   app.js and server.js are separate files — see the concept block in
//   server.js.
//
// HOW IT WORKS HERE: the full register -> login -> refresh -> logout cycle
//   against a real in-memory MongoDB.
// ============================================================

const request = require('supertest');
const app = require('../app');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

const validUser = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'Password123',
};

describe('POST /api/auth/register', () => {
  test('creates a user and returns an access token', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe('test@example.com');
  });

  // ============================================================
  // 🧠 CONCEPT: Assert that the password hash NEVER leaves the server
  // WHY IT MATTERS (interview angle): the `select: false` on the model and
  //   the toJSON transform are both meant to prevent this. A test that
  //   asserts on the actual HTTP response verifies the whole chain end to
  //   end — including any new endpoint someone adds later.
  // ============================================================
  test('never returns the password hash', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser).expect(201);

    expect(res.body.data.user.password).toBeUndefined();
    // Belt and braces: check the raw serialised body, in case it leaked
    // through some nested field.
    expect(JSON.stringify(res.body)).not.toContain('$2a$');
  });

  test('stores the password HASHED, not in plaintext', async () => {
    await request(app).post('/api/auth/register').send(validUser).expect(201);

    // Go around the API and look directly at the database.
    const stored = await User.findOne({ email: validUser.email }).select('+password');

    expect(stored.password).not.toBe(validUser.password);
    expect(stored.password).toMatch(/^\$2[aby]\$/); // a bcrypt hash prefix
  });

  test('sets an httpOnly refresh cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser).expect(201);

    const cookies = res.headers['set-cookie'] || [];
    const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i); // XSS cannot read it
    expect(refreshCookie).toMatch(/SameSite/i); // CSRF defence
  });

  // ============================================================
  // 🧠 CONCEPT: Testing the MASS ASSIGNMENT defence
  // WHY IT MATTERS (interview angle): this is the test that proves an
  //   attacker cannot make themselves an admin by adding one field to the
  //   request body. It is short, and it guards a critical vulnerability.
  // ============================================================
  test('REJECTS an attempt to self-assign the admin role', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, role: 'admin' })
      .expect(400);

    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(await User.countDocuments()).toBe(0); // nothing was created
  });

  test('rejects a duplicate email with 409 (the unique index, via code 11000)', async () => {
    await request(app).post('/api/auth/register').send(validUser).expect(201);

    const res = await request(app).post('/api/auth/register').send(validUser).expect(409);
    expect(res.body.error.code).toBeDefined();
  });

  test.each([
    ['missing name', { email: 'a@b.co', password: 'Password123' }],
    ['invalid email', { name: 'X', email: 'not-an-email', password: 'Password123' }],
    ['short password', { name: 'Xy', email: 'a@b.co', password: 'short' }],
    ['password with no digit', { name: 'Xy', email: 'a@b.co', password: 'onlyletters' }],
  ])('rejects %s with 400', async (_label, payload) => {
    const res = await request(app).post('/api/auth/register').send(payload).expect(400);
    expect(res.body.error.details).toEqual(expect.any(Array));
  });

  // ============================================================
  // 🧠 CONCEPT: Testing the NoSQL INJECTION defence
  // WHY IT MATTERS (interview angle): proves that sending an OBJECT where a
  //   string is expected is rejected rather than reaching the query. This
  //   is the concrete test for the `{"$ne": null}` attack described in
  //   middleware/validate.js.
  // ============================================================
  test('rejects a NoSQL operator object in the email field', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Attacker', email: { $ne: null }, password: 'Password123' })
      .expect(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser);
  });

  test('returns an access token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password })
      .expect(200);

    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.role).toBe('user');
  });

  // ============================================================
  // 🧠 CONCEPT: Testing the USER-ENUMERATION defence
  // WHY IT MATTERS (interview angle): the two failure modes must be
  //   INDISTINGUISHABLE — same status, same message. If a refactor ever
  //   splits them into "no such user" and "wrong password", this test
  //   fails and stops the information leak from shipping.
  // ============================================================
  test('gives an IDENTICAL error for unknown-email and wrong-password', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: 'WrongPassword123' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Password123' })
      .expect(401);

    // Same status code AND same message — no oracle for an attacker.
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  test('rejects a NoSQL operator in the password field', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: { $ne: null } })
      .expect(400);
  });

  test('persists a HASHED refresh token in the database', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password })
      .expect(200);

    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('refreshToken='));
    const rawToken = decodeURIComponent(cookie.split(';')[0].split('=')[1]);

    const stored = await RefreshToken.findOne({});
    expect(stored).toBeTruthy();
    // The raw token must NOT be what we stored.
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(stored.tokenHash).toHaveLength(64); // sha256 hex
  });
});

describe('POST /api/auth/refresh — rotation and reuse detection', () => {
  let agent;

  beforeEach(async () => {
    // ============================================================
    // 🧠 CONCEPT: supertest.agent() persists cookies across requests
    // WHY IT MATTERS (interview angle): `request(app)` is stateless — each
    //   call is a fresh client with no cookie jar, so the refresh cookie
    //   set by login would not be sent on the subsequent refresh call.
    //   `agent()` keeps a cookie jar, which is what lets us test a real
    //   multi-request session flow.
    // ============================================================
    agent = request.agent(app);
    await agent.post('/api/auth/register').send(validUser);
  });

  test('issues a NEW access token', async () => {
    const res = await agent.post('/api/auth/refresh').expect(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  test('ROTATES the refresh token (the old one is revoked)', async () => {
    const before = await RefreshToken.findOne({ revokedAt: null });

    await agent.post('/api/auth/refresh').expect(200);

    const rotated = await RefreshToken.findById(before._id);
    expect(rotated.revokedAt).not.toBeNull();
    expect(rotated.revokedReason).toBe('rotated');

    // And a brand-new active token now exists.
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(1);
  });

  // ============================================================
  // 🧠 CONCEPT: Testing REUSE DETECTION — the security centrepiece
  // WHY IT MATTERS (interview angle): this test simulates a stolen refresh
  //   token. The attacker (or a stale client) replays an already-rotated
  //   token. The system must recognise it, revoke the ENTIRE family, and
  //   force a fresh login. Being able to demonstrate this is a strong
  //   signal that you understand the OAuth 2.0 Security BCP, not just
  //   "JWTs".
  // ============================================================
  test('DETECTS REUSE of a rotated token and revokes the whole family', async () => {
    // Capture the original token before rotating it.
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password })
      .expect(200);

    const cookie = (loginRes.headers['set-cookie'] || []).find((c) => c.startsWith('refreshToken='));
    const stolenToken = decodeURIComponent(cookie.split(';')[0].split('=')[1]);

    // Legitimate use #1 — this rotates the token.
    await request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${stolenToken}`).expect(200);

    // The "attacker" replays the same (now revoked) token.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refreshToken=${stolenToken}`)
      .expect(401);

    expect(replay.body.error.message).toMatch(/security/i);

    // ⭐ The crucial assertion: EVERY token for this user is now revoked,
    // including the new one the legitimate user was holding. Both parties
    // are logged out; only the real user can log back in.
    const stillActive = await RefreshToken.countDocuments({ revokedAt: null });
    expect(stillActive).toBe(0);
  });

  test('rejects a refresh with no cookie at all', async () => {
    await request(app).post('/api/auth/refresh').expect(401);
  });
});

describe('POST /api/auth/logout', () => {
  test('revokes the refresh token in the database', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(validUser);

    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(1);

    await agent.post('/api/auth/logout').expect(200);

    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  // Logout is idempotent — see the concept block in authController.
  test('succeeds even with no session', async () => {
    await request(app).post('/api/auth/logout').expect(200);
  });
});

describe('GET /api/auth/me — authentication middleware', () => {
  let accessToken;

  beforeEach(async () => {
    const res = await request(app).post('/api/auth/register').send(validUser);
    accessToken = res.body.data.accessToken;
  });

  test('returns the profile with a valid Bearer token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);

    expect(res.body.data.user.email).toBe(validUser.email);
    expect(res.body.data.stats).toBeDefined();
  });

  test('401 with no token', async () => {
    await request(app).get('/api/auth/me').expect(401);
  });

  test('401 with a malformed token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  test('401 when the scheme is missing (raw token, no "Bearer")', async () => {
    await request(app).get('/api/auth/me').set('Authorization', accessToken).expect(401);
  });

  // ============================================================
  // 🧠 CONCEPT: Testing that a deleted user's token stops working
  // WHY IT MATTERS (interview angle): this is the test that justifies the
  //   per-request DB lookup in verifyAccessToken. Without that lookup, a
  //   deleted user's token would keep working until expiry. With it, the
  //   token is rejected immediately — and this test proves it.
  // ============================================================
  test('401 after the user is deleted, even though the token is still valid', async () => {
    await User.deleteMany({});

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
    expect(res.body.error.code).toBe('USER_DELETED');
  });

  test('403 after the account is deactivated', async () => {
    await User.updateOne({ email: validUser.email }, { $set: { isActive: false } });

    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(403);
  });
});
