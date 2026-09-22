// ============================================================
// 🧠 CONCEPT: The complete JWT access + refresh token flow
// WHY IT MATTERS (interview angle): being able to narrate this end to end is
//   the difference between "I've used JWT" and "I understand JWT".
//
//   THE FULL LIFECYCLE:
//
//   1. REGISTER  -> bcrypt-hash the password, create the user.
//   2. LOGIN     -> verify the password, then issue TWO tokens:
//                     • ACCESS  (15 min) -> response body -> stored in React
//                       memory -> sent as `Authorization: Bearer`.
//                     • REFRESH (7 days) -> httpOnly cookie -> ALSO stored
//                       (hashed) in MongoDB so it can be revoked.
//   3. API CALLS -> the access token is verified by signature alone. No DB
//                   hit for auth. This is what makes the API horizontally
//                   scalable: any instance can validate any token.
//   4. EXPIRY    -> after 15 min the API returns 401 TOKEN_EXPIRED. The
//                   axios interceptor on the client catches it and calls...
//   5. REFRESH   -> the cookie is sent automatically; we verify its
//                   signature AND look it up in Mongo. Valid -> issue a new
//                   access token AND ROTATE the refresh token.
//   6. LOGOUT    -> delete/revoke the DB row. The refresh token is dead
//                   instantly; the access token dies within 15 minutes.
//
//   WHY TWO TOKENS AT ALL — the question behind the question:
//   A single long-lived token would mean a stolen token grants a week of
//   access with no way to stop it. A single short-lived token would force a
//   re-login every 15 minutes. The split gives you both: the frequently-sent
//   credential is short-lived and stateless (fast), and the long-lived one
//   is rarely sent, harder to steal (httpOnly, path-scoped) and revocable
//   (stateful).
//
// HOW IT WORKS HERE: five handlers — register, login, refresh, logout, me.
// ============================================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const Task = require('../models/Task');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const tokenUtils = require('../utils/tokens');
const config = require('../config/env');
const logger = require('../utils/logger');
const { activityLogger, EVENTS } = require('../utils/activityLogger');

/**
 * Issue a fresh token pair and persist the refresh token.
 * Shared by login and refresh so the rotation logic exists in exactly one place.
 */
async function issueTokenPair(user, req, { replacesJti = null } = {}) {
  const accessToken = tokenUtils.signAccessToken(user);
  const { token: refreshToken, jti } = tokenUtils.signRefreshToken(user);

  await RefreshToken.create({
    user: user._id,
    jti,
    // Store only the HASH — see the concept block in models/RefreshToken.js.
    tokenHash: tokenUtils.hashToken(refreshToken),
    expiresAt: new Date(Date.now() + config.jwt.refreshExpiresMs),
    userAgent: req.headers['user-agent']?.slice(0, 300) || null,
    ip: req.ip,
  });

  if (replacesJti) {
    await RefreshToken.updateOne({ jti: replacesJti }, { $set: { replacedByJti: jti } });
  }

  return { accessToken, refreshToken };
}

// ------------------------------------------------------------------
// POST /api/auth/register
// ------------------------------------------------------------------
const register = asyncHandler(async (req, res) => {
  // ============================================================
  // 🧠 CONCEPT: Explicit field allowlist (mass-assignment defence)
  // WHY IT MATTERS (interview angle): note what we DON'T do —
  //   `User.create(req.body)`. We destructure exactly three fields. Even if
  //   the validation layer were removed tomorrow, an attacker sending
  //   `{"role":"admin"}` gets nothing, because `role` is simply never read.
  //   Two independent layers, and neither relies on the other.
  //   This is the ALLOWLIST pattern: enumerate what's allowed in, rather
  //   than trying to remember everything that must be kept out.
  // ============================================================
  const { name, email, password } = req.body;

  // ============================================================
  // 🧠 CONCEPT: The check-then-insert RACE CONDITION
  // WHY IT MATTERS (interview angle): this pre-check is a UX nicety, NOT the
  //   uniqueness guarantee. Two simultaneous requests for the same email can
  //   BOTH pass this findOne (neither has inserted yet) and both proceed to
  //   create. That is a TOCTOU (time-of-check to time-of-use) race.
  //   The ACTUAL guarantee is the UNIQUE INDEX in the database — the only
  //   thing that is atomic. The second insert fails with code 11000, which
  //   errorHandler.js turns into a 409.
  //   The general principle, worth stating plainly: never enforce a
  //   constraint with a read followed by a write. Enforce it with a database
  //   constraint and handle the resulting error.
  // ============================================================
  const existing = await User.findByEmail(email);
  if (existing) {
    throw ApiError.conflict('An account with that email already exists');
  }

  // The pre('save') hook in models/User.js hashes the password. The
  // controller never sees or handles bcrypt — that logic lives in one place.
  const user = await User.create({ name, email, password });

  logger.info(`[auth] registered ${user.email}`);
  activityLogger.emit(EVENTS.USER_REGISTERED, { userId: String(user._id), email: user.email });

  const { accessToken, refreshToken } = await issueTokenPair(user, req);
  tokenUtils.setRefreshCookie(res, refreshToken);

  // 201 Created. The toJSON transform on the model strips the password hash.
  res.status(201).json({
    success: true,
    data: { user, accessToken },
  });
});

// ------------------------------------------------------------------
// POST /api/auth/login
// ------------------------------------------------------------------
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // `.select('+password')` opts back into the select:false field.
  const user = await User.findByEmail(email, { withPassword: true });

  // ============================================================
  // 🧠 CONCEPT: USER ENUMERATION and the timing side channel
  // WHY IT MATTERS (interview angle): a subtle but genuinely exploited flaw.
  //
  //   ❌ THE NAIVE VERSION:
  //     if (!user)  return res.status(404).json({ msg: 'No user with that email' });
  //     if (!match) return res.status(401).json({ msg: 'Wrong password' });
  //
  //   The attacker now has an ORACLE. They feed in a leaked email list and
  //   the different responses tell them exactly which addresses have
  //   accounts on your service. For a dating site, a medical service or a
  //   political org, merely confirming someone HAS an account is the breach.
  //   It also focuses a subsequent credential-stuffing attack onto only the
  //   addresses that will work.
  //
  //   ✅ FIX 1 — one identical error for both cases. Same status, same
  //   message, same response shape. Done below.
  //
  //   ⚠️ FIX 2 — THE TIMING LEAK, which most people miss. Even with
  //   identical messages, the two paths take different amounts of time:
  //     • Unknown email -> we return immediately.          (~5ms)
  //     • Known email   -> we run bcrypt.compare first.    (~100ms)
  //   A 95ms difference is trivially measurable over a network and rebuilds
  //   the oracle. The fix is to ALWAYS perform a bcrypt comparison — against
  //   a dummy hash when the user doesn't exist — so both paths cost the same.
  //
  //   Related: the same reasoning applies to "forgot password". Always
  //   respond "if that account exists, we've sent an email", regardless.
  // ============================================================

  // A real bcrypt hash of a random string, computed once at module load.
  // Comparing against it burns the same CPU as a genuine check.
  const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWu';

  let passwordMatches = false;
  if (user) {
    passwordMatches = await user.comparePassword(password);
  } else {
    // Constant-time-ish: do the work even though we already know we'll fail.
    await bcrypt.compare(password, DUMMY_HASH);
  }

  if (!user || !passwordMatches) {
    // Identical error for "no such user" and "wrong password".
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated');
  }

  // ============================================================
  // 🧠 CONCEPT: Capping concurrent sessions
  // WHY IT MATTERS (interview angle): without a cap, every login creates a
  //   new refresh-token row forever. A user who logs in daily for a year has
  //   365 live sessions, each a standing credential that could be stolen.
  //   Bounding the count limits blast radius and keeps the collection small.
  // ============================================================
  const activeCount = await RefreshToken.countDocuments({ user: user._id, revokedAt: null });
  if (activeCount >= 5) {
    const oldest = await RefreshToken.findOne({ user: user._id, revokedAt: null }).sort({ createdAt: 1 });
    if (oldest) {
      oldest.revokedAt = new Date();
      oldest.revokedReason = 'admin-revoked';
      await oldest.save();
      logger.debug(`[auth] evicted oldest session for ${user.email} (5-session cap)`);
    }
  }

  const { accessToken, refreshToken } = await issueTokenPair(user, req);

  // Fire and forget — this must not block or fail the login response.
  User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch((err) =>
    logger.warn(`[auth] failed to record lastLoginAt: ${err.message}`)
  );

  activityLogger.emit(EVENTS.USER_LOGGED_IN, { userId: String(user._id), email: user.email, ip: req.ip });

  tokenUtils.setRefreshCookie(res, refreshToken);

  // ============================================================
  // 🧠 CONCEPT: Why the ACCESS token goes in the BODY, not a cookie
  // WHY IT MATTERS (interview angle): deliberate asymmetry.
  //   • In the BODY, the client must read it and attach it manually to each
  //     request as an Authorization header. Because the browser never sends
  //     it automatically, those requests are structurally IMMUNE TO CSRF.
  //   • In a COOKIE, the browser attaches it to every request to your
  //     domain — including one triggered by evil.com — which is CSRF.
  //   So: the token sent on every request (access) uses the CSRF-immune
  //   transport, and the token that must survive a page refresh (refresh)
  //   uses the XSS-immune transport (httpOnly). Each token gets the
  //   protection that matches its threat.
  // ============================================================
  res.json({
    success: true,
    data: {
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      accessToken,
      expiresIn: config.jwt.accessExpiresIn,
    },
  });
});

// ------------------------------------------------------------------
// POST /api/auth/refresh
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Refresh with ROTATION and REUSE DETECTION
// WHY IT MATTERS (interview angle): the senior-level part of the answer.
//   Every refresh does three things:
//     1. Verify the token's SIGNATURE (is it ours? not expired?)
//     2. Verify it against the DATABASE (is it still valid? revoked?)
//     3. ROTATE — revoke the old one, issue a new one.
//
//   Step 3 is what makes a stolen refresh token time-limited: the thief's
//   copy stops working the moment the real user refreshes.
//
//   And then REUSE DETECTION closes the loop. Because each token is
//   single-use, a request presenting an ALREADY-REVOKED token means one of
//   two things: the attacker used a stolen token (and the real user is now
//   replaying their dead copy), or the real user refreshed and the attacker
//   is replaying. You cannot distinguish them — so you revoke the WHOLE
//   FAMILY and force a login. The attacker is locked out; the user logs in
//   again once. This is the OAuth 2.0 Security BCP recommendation.
// ============================================================
const refresh = asyncHandler(async (req, res) => {
  // The cookie is sent automatically by the browser because the client uses
  // `withCredentials: true` and the cookie's path matches /api/auth.
  const presented = req.cookies?.[tokenUtils.REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (!presented) {
    throw ApiError.unauthorized('No refresh token provided');
  }

  // STEP 1: cryptographic validity. Cheap, no DB.
  let payload;
  try {
    payload = tokenUtils.verifyRefreshToken(presented);
  } catch (err) {
    tokenUtils.clearRefreshCookie(res);
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  // STEP 2: database validity. This is the revocation check — the entire
  // reason refresh tokens are stateful.
  const stored = await RefreshToken.findActiveByHash(tokenUtils.hashToken(presented));

  if (!stored) {
    // Signature is valid but we have no record: the row was hard-deleted, or
    // the TTL reaped it. Either way, not usable.
    tokenUtils.clearRefreshCookie(res);
    throw ApiError.unauthorized('Refresh token is no longer valid');
  }

  // ⚠️ REUSE DETECTED — the security-critical branch.
  if (stored.revokedAt) {
    logger.error(
      `[auth] 🚨 REFRESH TOKEN REUSE DETECTED for user ${stored.user} (jti=${stored.jti}). ` +
        'Revoking the entire token family. Either the token was stolen, or a stale client replayed it.'
    );
    await RefreshToken.revokeFamily(stored.user, 'reuse-detected');
    tokenUtils.clearRefreshCookie(res);
    throw ApiError.unauthorized('Session invalidated for security reasons — please log in again');
  }

  // Belt and braces: the TTL index is eventual (runs ~every 60s), so an
  // expired document can still be present. Check explicitly.
  if (stored.expiresAt <= new Date()) {
    tokenUtils.clearRefreshCookie(res);
    throw ApiError.unauthorized('Refresh token expired');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    await RefreshToken.revokeFamily(payload.sub, 'admin-revoked');
    tokenUtils.clearRefreshCookie(res);
    throw ApiError.unauthorized('Account is no longer active');
  }

  // STEP 3: ROTATE. Revoke the presented token before issuing the new one.
  stored.revokedAt = new Date();
  stored.revokedReason = 'rotated';
  await stored.save();

  const { accessToken, refreshToken: newRefresh } = await issueTokenPair(user, req, { replacesJti: stored.jti });
  tokenUtils.setRefreshCookie(res, newRefresh);

  logger.debug(`[auth] rotated refresh token for ${user.email}`);

  res.json({
    success: true,
    data: {
      accessToken,
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
    },
  });
});

// ------------------------------------------------------------------
// POST /api/auth/logout
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: What "logout" actually means under JWT
// WHY IT MATTERS (interview angle): a favourite trick question — "how do you
//   log out a stateless JWT?" The precise answer has three parts:
//
//   1. REFRESH TOKEN -> revoked in the DB. Genuinely dead, immediately.
//   2. COOKIE -> cleared so the browser stops sending it.
//   3. ACCESS TOKEN -> ⚠️ STILL CRYPTOGRAPHICALLY VALID until it expires.
//      Nothing you do server-side can un-sign it. If someone copied it
//      before logout, it works for up to 15 more minutes. The client
//      discards its copy, which handles the normal case, but that is a
//      client-side courtesy, not a server-side guarantee.
//
//   IF YOU NEED INSTANT ACCESS-TOKEN REVOCATION, the options are:
//   • A DENYLIST in Redis keyed by `jti`, with a TTL equal to the token's
//     remaining life. Checked on every request — which means you have
//     reintroduced a per-request lookup and given up pure statelessness.
//     (The TTL keeps it small: entries self-delete when the token would have
//     expired anyway.)
//   • A per-user `tokenVersion` counter in the DB, bumped on logout and
//     compared against a claim — same trade-off, one lookup per request.
//   • Just use a very short expiry (5 min) and accept the window.
//   The interviewer is checking whether you know the limitation EXISTS.
//   Saying "logout invalidates the JWT" without qualification is the wrong
//   answer.
// ============================================================
const logout = asyncHandler(async (req, res) => {
  const presented = req.cookies?.[tokenUtils.REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (presented) {
    await RefreshToken.updateOne(
      { tokenHash: tokenUtils.hashToken(presented), revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } }
    );
  }

  tokenUtils.clearRefreshCookie(res);

  if (req.user) {
    activityLogger.emit(EVENTS.USER_LOGGED_OUT, { userId: req.user.id });
  }

  // ============================================================
  // 🧠 CONCEPT: Logout is IDEMPOTENT — always return success
  // WHY IT MATTERS (interview angle): if the token is already gone, the
  //   user's desired end state ("I am logged out") is satisfied. Returning
  //   a 401 from logout is a real UX bug: the client's error handler may
  //   try to refresh, fail, and trap the user on a broken screen. Logout
  //   should succeed unconditionally.
  // ============================================================
  res.json({ success: true, message: 'Logged out' });
});

// ------------------------------------------------------------------
// POST /api/auth/logout-all
// ------------------------------------------------------------------
const logoutAll = asyncHandler(async (req, res) => {
  const result = await RefreshToken.revokeFamily(req.user.id, 'logout');
  tokenUtils.clearRefreshCookie(res);
  res.json({
    success: true,
    message: `Revoked ${result.modifiedCount} session(s)`,
  });
});

// ------------------------------------------------------------------
// GET /api/auth/me
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Promise.all for INDEPENDENT queries
// WHY IT MATTERS (interview angle): a concrete instance of the sequential
//   vs parallel point from utils/callbackDemo.js, in real application code.
//
//   ❌ SEQUENTIAL — 3 round-trips, latencies add up:
//       const user     = await User.findById(id);        // 20ms
//       const taskCount= await Task.countDocuments(...);  // 20ms
//       const sessions = await RefreshToken.count(...);   // 20ms
//       // total ~60ms, and the DB was idle two-thirds of the time
//
//   ✅ PARALLEL — all three dispatched at once:
//       // total ~20ms (the slowest one)
//
//   The three queries do not depend on each other, so there is no reason to
//   serialise them. At 3 queries you save 40ms; inside a loop over 50 items
//   the same mistake costs seconds.
//
//   ⚠️ The caveat to state unprompted: Promise.all is NOT free at scale. It
//   dispatches everything simultaneously, so `Promise.all(tenThousand.map(...))`
//   opens 10,000 concurrent queries and will exhaust the Mongoose connection
//   pool (maxPoolSize 10 — see config/db.js), queueing them anyway while
//   consuming memory. Bound the concurrency for large batches.
// ============================================================
const me = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [user, taskCount, activeSessions, tasksByStatus] = await Promise.all([
    User.findById(userId),
    Task.countDocuments({ owner: userId }),
    RefreshToken.countDocuments({ user: userId, revokedAt: null }),
    // A small aggregation, run in parallel with the rest.
    Task.aggregate([
      // ============================================================
      // 🧠 CONCEPT: Aggregation does NOT auto-cast strings to ObjectId
      // WHY IT MATTERS (interview angle): a genuinely nasty bug. In a normal
      //   `find({ owner: "6512ab..." })`, Mongoose consults the SCHEMA and
      //   casts that string to an ObjectId for you. An AGGREGATION PIPELINE
      //   bypasses the schema entirely — it is handed almost straight to the
      //   driver. So `$match: { owner: "6512ab..." }` compares a STRING
      //   against an OBJECTID field, matches nothing, and returns an empty
      //   array. No error, no warning: your stats page just silently shows
      //   zero. You must cast manually, as below.
      // ============================================================
      { $match: { owner: new mongoose.Types.ObjectId(String(userId)) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  if (!user) throw ApiError.notFound('User');

  res.json({
    success: true,
    data: {
      user,
      stats: {
        taskCount,
        activeSessions,
        byStatus: tasksByStatus.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
      },
    },
  });
});

// ------------------------------------------------------------------
// GET /api/auth/sessions
// ------------------------------------------------------------------
const listSessions = asyncHandler(async (req, res) => {
  const sessions = await RefreshToken.find({ user: req.user.id })
    // tokenHash is selected so we can flag the CURRENT session below, but it
    // is never included in the response — see the mapping.
    .select('jti userAgent ip createdAt expiresAt revokedAt revokedReason tokenHash')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const currentHash = req.cookies?.[tokenUtils.REFRESH_COOKIE_NAME]
    ? tokenUtils.hashToken(req.cookies[tokenUtils.REFRESH_COOKIE_NAME])
    : null;

  res.json({
    success: true,
    data: sessions.map((s) => ({
      id: s.jti,
      device: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      active: !s.revokedAt && s.expiresAt > new Date(),
      revokedReason: s.revokedReason,
      // Never send the hash itself; just flag which row is this session.
      isCurrent: Boolean(currentHash && s.tokenHash === currentHash),
    })),
  });
});

// ------------------------------------------------------------------
// PATCH /api/auth/password
// ------------------------------------------------------------------
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || String(newPassword).length < 8) {
    throw ApiError.badRequest('New password must be at least 8 characters');
  }

  // ============================================================
  // 🧠 CONCEPT: Re-authenticate before a sensitive action
  // WHY IT MATTERS (interview angle): even with a valid access token, you
  //   should demand the CURRENT password before changing it. Reason: if an
  //   attacker briefly obtains a token (a borrowed laptop, an XSS payload),
  //   without this check they can change the password and take permanent
  //   ownership of the account. With it, the 15-minute token window expires
  //   and the real user keeps control. The same applies to changing the
  //   email or disabling MFA.
  // ============================================================
  const user = await User.findById(req.user.id).select('+password');
  if (!user) throw ApiError.notFound('User');

  const matches = await user.comparePassword(String(currentPassword || ''));
  if (!matches) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  // ⚠️ We load the document and call .save() rather than findByIdAndUpdate,
  // because the pre('save') hashing hook does NOT run on query-based
  // updates. findByIdAndUpdate here would store the password IN PLAINTEXT.
  // See the hook comment in models/User.js.
  user.password = newPassword;
  await user.save();

  // A password change must kill every existing session — that is the whole
  // point of changing it after a suspected compromise.
  await RefreshToken.revokeFamily(user._id, 'password-changed');
  tokenUtils.clearRefreshCookie(res);

  res.json({
    success: true,
    message: 'Password updated. All sessions have been logged out — please log in again.',
  });
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  listSessions,
  changePassword,
};
