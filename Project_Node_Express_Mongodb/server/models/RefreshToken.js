// ============================================================
// 🧠 CONCEPT: Server-side refresh token storage = the revocation lever
// WHY IT MATTERS (interview angle): the obvious objection to JWT auth is
//   "you can't log someone out". This collection is the answer.
//
//   Access token  -> stateless, never stored, verified by signature alone.
//                    Cannot be revoked. Mitigated by a 15-minute expiry.
//   Refresh token -> stored HERE. Every refresh checks this collection, so
//                    deleting the row kills the session IMMEDIATELY.
//
//   That asymmetry is the whole design: you pay a DB lookup once every 15
//   minutes (on refresh) instead of on every single API request, and in
//   exchange you get real logout, "log out all devices", and the ability to
//   kill a compromised session.
//
// HOW IT WORKS HERE: one document per issued refresh token, storing a SHA-256
//   hash of the token plus device metadata and a TTL index.
// ============================================================

const mongoose = require('mongoose');
const config = require('../config/env');

const refreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true, // "revoke every session for this user" queries on it
    },

    // ============================================================
    // 🧠 CONCEPT: jti — the JWT ID claim
    // WHY IT MATTERS (interview angle): a unique id embedded in the token
    //   itself. It lets you revoke ONE specific token (log out this phone)
    //   rather than every token for the user. It is also the standard
    //   mechanism for a JWT denylist.
    // ============================================================
    jti: {
      type: String,
      required: true,
      unique: true,
    },

    // ============================================================
    // 🧠 CONCEPT: Store a HASH, never the raw token
    // WHY IT MATTERS (interview angle): if this collection leaks, plaintext
    //   refresh tokens would hand the attacker live sessions for every user
    //   — a total compromise that survives a password reset. Storing
    //   sha256(token) means a leaked dump is useless: the attacker has
    //   hashes and cannot reverse them into valid tokens.
    //   Why SHA-256 and not bcrypt, when we bcrypt passwords? Because the
    //   token is already ~128 bits of cryptographic randomness, so there is
    //   no dictionary to attack — the slow-KDF property bcrypt provides is
    //   pointless here, and it would make every refresh 100ms slower.
    //   Bcrypt is for LOW-ENTROPY human secrets; fast hashes are fine for
    //   HIGH-ENTROPY machine-generated ones.
    // ============================================================
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    // ============================================================
    // 🧠 CONCEPT: Explicit revocation flag vs hard delete
    // WHY IT MATTERS (interview angle): keeping a revoked row (instead of
    //   deleting it) lets you DETECT REPLAY — see the token-reuse comment
    //   below. That audit trail is worth the extra storage, which the TTL
    //   index reclaims anyway.
    // ============================================================
    revokedAt: {
      type: Date,
      default: null,
    },

    revokedReason: {
      type: String,
      enum: ['logout', 'rotated', 'reuse-detected', 'admin-revoked', 'password-changed', null],
      default: null,
    },

    // ============================================================
    // 🧠 CONCEPT: Device metadata for a "sessions" UI
    // WHY IT MATTERS (interview angle): this is what powers the "You're
    //   logged in on: Chrome on Windows, iPhone" screen in real products,
    //   and it gives your security team something to alert on (a refresh
    //   from a new country).
    //   ⚠️ Don't over-trust it: User-Agent is client-controlled and trivially
    //   spoofed, and IP changes legitimately on mobile networks. Binding a
    //   session strictly to an IP looks secure but mostly just logs out
    //   commuters.
    // ============================================================
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },

    // Rotation chain: which token replaced this one.
    replacedByJti: { type: String, default: null },
  },
  { timestamps: true }
);

// ============================================================
// 🧠 CONCEPT: TTL index — MongoDB deleting documents for you
// WHY IT MATTERS (interview angle): `expireAfterSeconds: 0` on a Date field
//   tells MongoDB to delete the document once that date passes. No cron job,
//   no cleanup script. Perfect for sessions, OTP codes, and caches.
//   Three details interviewers probe for:
//   1. A BACKGROUND TASK runs roughly every 60 SECONDS, so deletion is
//      eventual — a document can survive up to a minute past its expiry.
//      Never rely on a TTL index for security-critical expiry; we ALSO check
//      `expiresAt` in application code (see authController.refresh).
//   2. The indexed field must be a Date (or an array of Dates). A number or
//      an ISO string is silently ignored — the index exists and never
//      deletes anything.
//   3. It only works on a replica set PRIMARY; secondaries get the deletes
//      via the oplog.
// HOW IT WORKS HERE: expired refresh tokens clean themselves up, so this
//   collection does not grow without bound.
// ============================================================
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });

// ============================================================
// 🧠 CONCEPT: Refresh token ROTATION + reuse detection
// WHY IT MATTERS (interview angle): a strong, senior-sounding answer to
//   "how do you make refresh tokens safe?"
//
//   ROTATION: every time a refresh token is used, it is revoked and a BRAND
//   NEW one is issued. A given refresh token is therefore single-use.
//
//   REUSE DETECTION: because each token may be used exactly once, seeing an
//   ALREADY-REVOKED token presented again is proof that something went
//   wrong. Either the legitimate user's token was stolen and the thief is
//   now using it, or the thief used it first and the real user is replaying.
//   You cannot tell which — so the correct response is to revoke the ENTIRE
//   token family for that user, forcing a fresh login. The attacker loses
//   access; the user re-authenticates once.
//
//   This is the OAuth 2.0 Security BCP recommendation for public clients.
//
// HOW IT WORKS HERE: revokeFamily() below; called from authController.refresh
//   when a revoked token is presented.
// ============================================================
refreshTokenSchema.statics.revokeFamily = function revokeFamily(userId, reason = 'reuse-detected') {
  return this.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
};

refreshTokenSchema.statics.findActiveByHash = function findActiveByHash(tokenHash) {
  return this.findOne({ tokenHash });
};

refreshTokenSchema.methods.isActive = function isActive() {
  // Belt and braces: check BOTH the revocation flag and the expiry, because
  // the TTL index is eventual (see above) and a "deleted" doc may still exist.
  return !this.revokedAt && this.expiresAt > new Date();
};

if (config.isProd) {
  refreshTokenSchema.set('autoIndex', false);
}

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
