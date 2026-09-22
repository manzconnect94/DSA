// ============================================================
// 🧠 CONCEPT: AUTHENTICATION vs AUTHORIZATION — the distinction interviewers
//             use to separate juniors from mid-levels
// WHY IT MATTERS (interview angle): they are constantly conflated, and the
//   difference is not academic — it maps to two different middleware, two
//   different HTTP status codes, and two different classes of vulnerability.
//
//   AUTHENTICATION (AuthN) — "WHO ARE YOU?"
//     • Proving identity. Password check, JWT signature verification.
//     • Failure -> 401 Unauthorized  (a misnomer; it really means
//       "unauthenticated" — the name is a 1990s HTTP spec mistake).
//     • Implemented below by: verifyAccessToken
//
//   AUTHORIZATION (AuthZ) — "WHAT ARE YOU ALLOWED TO DO?"
//     • Deciding permissions. Happens AFTER authentication succeeds.
//     • Failure -> 403 Forbidden ("I know exactly who you are, and no").
//     • Two flavours, both implemented below:
//         - ROLE-level:     requireRole('admin')   — coarse, static
//         - RESOURCE-level: requireOwnership(Task) — fine, per-object
//
//   THE CRITICAL INSIGHT: authentication alone is NOT access control.
//   "The user has a valid token" says nothing about whether THIS task
//   belongs to THEM. Forgetting the second check is the IDOR vulnerability
//   documented in detail further down this file.
//
// HOW IT WORKS HERE: three composable middleware, chained per route.
// ============================================================

const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const tokenUtils = require('../utils/tokens');
const User = require('../models/User');
const logger = require('../utils/logger');

// ------------------------------------------------------------------
// 1. AUTHENTICATION
// ------------------------------------------------------------------

/**
 * Pull the bearer token out of the Authorization header.
 *
 * ============================================================
 * 🧠 CONCEPT: Why "Authorization: Bearer <token>"
 * WHY IT MATTERS (interview angle): "Bearer" literally means whoever bears
 *   (holds) this token gets access — there is no additional proof of
 *   identity, no binding to a device or key. That is why transport security
 *   (HTTPS) is non-negotiable: on plain HTTP the token is readable by any
 *   intermediary, and a copied token works perfectly for the copier.
 *   Using a header rather than a cookie also means the browser does NOT
 *   attach it automatically, which makes this endpoint immune to CSRF.
 * ============================================================
 */
function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
}

/**
 * AUTHENTICATION middleware.
 * Verifies the JWT signature and attaches `req.user`.
 */
const verifyAccessToken = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    throw ApiError.unauthorized('No access token provided');
  }

  let payload;
  try {
    // ============================================================
    // 🧠 CONCEPT: verify() — signature check, NOT just decoding
    // WHY IT MATTERS (interview angle): worth restating at the call site
    //   because it is the single most consequential line in the file.
    //   jwt.decode() would parse the payload with ZERO verification —
    //   anyone could forge {"role":"admin"} and walk straight in.
    //   jwt.verify() recomputes HMAC-SHA256 over header+payload with the
    //   server's secret and compares it to the signature. Only the holder
    //   of the secret (this server) can produce a valid signature, so a
    //   tampered payload fails. verify() ALSO enforces `exp`, `nbf` and
    //   `iss` — decode() checks none of those either.
    // ============================================================
    payload = tokenUtils.verifyAccessToken(token);
  } catch (err) {
    // ============================================================
    // 🧠 CONCEPT: Distinguish "expired" from "invalid" for the CLIENT
    // WHY IT MATTERS (interview angle): the frontend needs to tell these
    //   apart. TokenExpiredError -> "silently refresh and retry" (the axios
    //   interceptor does exactly this). JsonWebTokenError -> the token is
    //   malformed or forged, so refreshing is pointless: log the user out.
    //   Returning an undifferentiated 401 for both forces the client into a
    //   refresh loop on a forged token.
    // HOW IT WORKS HERE: a distinct error code the interceptor branches on.
    // ============================================================
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'Access token expired', { code: 'TOKEN_EXPIRED' });
    }
    if (err instanceof jwt.JsonWebTokenError) {
      // Do NOT echo err.message to the client — it can reveal whether the
      // failure was a bad signature vs malformed structure, which is a
      // small information leak to someone probing your auth.
      logger.warn(`[auth] invalid token: ${err.message}`);
      throw new ApiError(401, 'Invalid access token', { code: 'TOKEN_INVALID' });
    }
    throw err;
  }

  // ============================================================
  // 🧠 CONCEPT: To hit the DB or not to hit the DB
  // WHY IT MATTERS (interview angle): the real trade-off of stateless auth.
  //   • TRUST THE CLAIMS ONLY (no DB read): maximum speed, truly stateless,
  //     scales horizontally with zero shared state. But the claims are a
  //     SNAPSHOT from up to 15 minutes ago — a user you just deleted, banned
  //     or demoted still has a token that says otherwise.
  //   • LOAD THE USER (one indexed _id lookup, ~1ms): now you can honour
  //     deactivation and password changes immediately, at the cost of a
  //     query per request. You are no longer *fully* stateless, though you
  //     are still sessionless (any instance can do this lookup).
  //   The honest answer: it depends on your threat model. High-security
  //   (banking, admin panels) -> load the user. High-throughput public read
  //   APIs -> trust the claims and keep expiry short. A common middle ground
  //   is to trust claims on reads and load the user on writes.
  // HOW IT WORKS HERE: we load the user, because a study project should show
  //   the checks that this enables (isActive, passwordChangedAt).
  // ============================================================
  const user = await User.findById(payload.sub).select('name email role isActive passwordChangedAt');

  if (!user) {
    // The token is cryptographically valid but the user is gone.
    throw new ApiError(401, 'User no longer exists', { code: 'USER_DELETED' });
  }

  if (!user.isActive) {
    // 403, not 401: we know who you are; you are banned. Refreshing the
    // token would not help, and the client should not try.
    throw ApiError.forbidden('This account has been deactivated');
  }

  // ============================================================
  // 🧠 CONCEPT: Invalidating tokens issued before a password change
  // WHY IT MATTERS (interview angle): closes the "I changed my password,
  //   why is the attacker still logged in?" hole. Any access token whose
  //   `iat` (issued-at) predates passwordChangedAt is rejected. This gives
  //   you targeted revocation of stateless tokens — the standard workaround
  //   for JWT's biggest weakness.
  // ============================================================
  if (user.passwordChangedAfter(payload.iat)) {
    throw new ApiError(401, 'Password was changed — please log in again', { code: 'PASSWORD_CHANGED' });
  }

  // ============================================================
  // 🧠 CONCEPT: Attaching to req — how middleware passes data downstream
  // WHY IT MATTERS (interview angle): `req` is a plain object that lives for
  //   one request and is shared by every middleware in the chain. Mutating
  //   it is the idiomatic Express way to hand data to later handlers.
  //   ⚠️ Two cautions: (1) don't collide with Express's own properties
  //   (req.query, req.params, req.body); (2) don't hang large objects off
  //   req in a long-lived context — everything attached stays alive until
  //   the response finishes.
  // ============================================================
  req.user = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
  };
  req.tokenPayload = payload;

  return next();
});

/**
 * Optional authentication: attach req.user IF a valid token is present, but
 * never reject. Useful for endpoints that return richer data to logged-in
 * users (e.g. a public task board that also shows "yours").
 */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const payload = tokenUtils.verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('name email role isActive');
    if (user && user.isActive) {
      req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
    }
  } catch (_err) {
    // Deliberately swallowed: an invalid token on an optional-auth route
    // simply means "treat this as anonymous".
  }
  return next();
});

// ------------------------------------------------------------------
// 2. AUTHORIZATION — role level (RBAC)
// ------------------------------------------------------------------

// ============================================================
// 🧠 CONCEPT: RBAC — Role-Based Access Control
// WHY IT MATTERS (interview angle): permissions attach to ROLES, and users
//   are assigned roles. You manage a handful of roles instead of per-user
//   permission lists. Know where it breaks down and what comes next:
//
//   • RBAC — "admins can delete tasks". Simple, auditable, and the right
//     default. Fails when rules depend on the specific object or context.
//   • ABAC (Attribute-Based) — "you can delete a task IF you own it AND it
//     is not archived AND it is before the deadline". Decisions are computed
//     from attributes of the user, the resource and the environment.
//   • ReBAC (Relationship-Based) — Google Zanzibar / OpenFGA style: "you can
//     edit this doc because you're an editor of the folder that contains
//     it". Needed once permissions are inherited through a graph.
//
//   ⚠️ THE ROLE-EXPLOSION SMELL: if you find yourself creating
//   'admin-who-can-also-export-but-not-delete', RBAC has stopped fitting
//   and you want permissions/scopes, not more roles.
//
// HOW IT WORKS HERE: a middleware FACTORY. requireRole('admin') returns a
//   configured middleware — this is the closure pattern that lets one
//   implementation serve every role check in the app.
// ============================================================
function requireRole(...allowedRoles) {
  const allowed = allowedRoles.flat();

  return (req, _res, next) => {
    // ============================================================
    // 🧠 CONCEPT: Ordering — AuthN must run before AuthZ
    // WHY IT MATTERS (interview angle): if requireRole is mounted WITHOUT
    //   verifyAccessToken in front of it, req.user is undefined. A naive
    //   implementation (`if (req.user.role !== 'admin')`) then throws a
    //   TypeError -> a 500, not a 401 — and on some hand-rolled error
    //   handlers a thrown TypeError has even been known to be swallowed and
    //   the request allowed through. Always fail CLOSED (deny) when the
    //   precondition is missing.
    // ============================================================
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required before authorization'));
    }

    if (!allowed.includes(req.user.role)) {
      logger.warn(
        `[authz] DENIED: user ${req.user.id} (role=${req.user.role}) tried to access a route requiring [${allowed.join(', ')}]`
      );
      // 403 not 401 — the distinction matters. 401 tells the client "try
      // authenticating"; 403 tells it "don't bother, you'll never be allowed".
      return next(ApiError.forbidden(`Requires one of these roles: ${allowed.join(', ')}`));
    }

    return next();
  };
}

// ------------------------------------------------------------------
// 3. AUTHORIZATION — resource level (ownership)
// ------------------------------------------------------------------

// ============================================================
// 🧠 CONCEPT: IDOR — Insecure Direct Object Reference
// WHY IT MATTERS (interview angle): OWASP ranks Broken Access Control as the
//   #1 web application risk, and IDOR is its most common form. It is also
//   one of the most frequently reported bug-bounty findings, because it is
//   so easy to introduce and invisible in normal testing.
//
//   ❌ ===================== THE BUG =====================
//
//     router.delete('/tasks/:id', verifyAccessToken, async (req, res) => {
//       // "The user is authenticated, so this is safe."  <-- WRONG
//       await Task.findByIdAndDelete(req.params.id);
//       res.json({ success: true });
//     });
//
//   WHY IT LOOKS FINE: there IS an auth check. verifyAccessToken rejects
//   anonymous callers. Every test passes. The feature works perfectly in QA,
//   because testers only ever delete their own tasks.
//
//   WHY IT IS CATASTROPHIC: the route verified AUTHENTICATION but never
//   AUTHORIZATION. `req.params.id` is entirely attacker-controlled. Any
//   logged-in user — a legitimate one who signed up thirty seconds ago —
//   can enumerate or guess IDs and delete EVERY task belonging to EVERY
//   other user. The "direct object reference" (the raw database id in the
//   URL) is "insecure" because nothing validates that the caller may touch
//   that particular object.
//
//   HOW IT IS FOUND: open DevTools, watch a request go to
//   /api/tasks/6512ab..., change one hex digit, replay it. That is the
//   entire exploit. No special tools required.
//
//   ✅ ===================== THE FIX =====================
//
//   Scope the query by owner so a non-matching document is simply not found:
//
//     const task = await Task.findOne({ _id: req.params.id, owner: req.user.id });
//     if (!task) throw ApiError.notFound('Task');
//
//   Note the shape: the ownership condition is IN THE QUERY, not a separate
//   `if` after the fetch. That is deliberate — it is impossible to fetch the
//   document and then forget the check, and it is a single round-trip.
//
//   WHY RETURN 404 AND NOT 403: returning 403 ("forbidden") confirms that a
//   task with that id EXISTS and belongs to someone else. That is an
//   information leak — an attacker can enumerate valid ids and map your data
//   volume. 404 is indistinguishable from "no such task", so they learn
//   nothing. (Counter-argument: 403 is more honest for internal tools where
//   enumeration isn't a concern. Know both sides.)
//
//   OTHER DEFENCES WORTH NAMING:
//   • Use UUIDs/ULIDs instead of sequential ids so they can't be enumerated
//     — but treat that as defence in depth, NOT a substitute for the check.
//     "Unguessable id" is security through obscurity; ids leak via logs,
//     referrers and shared links.
//   • Centralise the check in middleware (exactly what we do below) so it
//     cannot be forgotten on the next endpoint someone adds.
//   • Write an automated test that asserts user B gets 404 for user A's
//     resource. We do — see tests/integration.tasks.test.js.
//
// HOW IT WORKS HERE: requireOwnership is a factory that loads the document
//   scoped to the caller and attaches it as req.resource. Admins bypass,
//   which is itself a deliberate (and auditable) policy decision.
// ============================================================
function requireOwnership(Model, { paramName = 'id', ownerField = 'owner', allowAdmin = true } = {}) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const resourceId = req.params[paramName];

    // ============================================================
    // 🧠 CONCEPT: Validate the ObjectId BEFORE querying
    // WHY IT MATTERS (interview angle): passing a malformed id to
    //   findById() throws a Mongoose CastError, which without handling
    //   becomes an ugly 500. A 500 on attacker-supplied input is both a bad
    //   experience and a signal to an attacker that they've found an
    //   unhandled path worth probing further. Validate -> clean 400.
    // ============================================================
    if (!/^[0-9a-fA-F]{24}$/.test(String(resourceId))) {
      throw ApiError.badRequest('Invalid resource id format');
    }

    // ============================================================
    // 🧠 CONCEPT: Scope the query, don't post-filter
    // WHY IT MATTERS (interview angle): `findOne({ _id, owner })` in one
    //   query beats `findById()` then `if (doc.owner !== user.id)`, for
    //   three reasons: you cannot forget the second half; there's no window
    //   where the unauthorized document is sitting in memory ready to be
    //   accidentally returned; and it lets MongoDB use the compound
    //   { owner, ... } index.
    // ============================================================
    const filter = { _id: resourceId };

    const isAdmin = allowAdmin && req.user.role === 'admin';
    if (!isAdmin) {
      filter[ownerField] = req.user.id;
    }

    const resource = await Model.findOne(filter);

    if (!resource) {
      // 404, not 403 — see the enumeration note above.
      throw ApiError.notFound(Model.modelName);
    }

    if (isAdmin && String(resource[ownerField]) !== req.user.id) {
      // ============================================================
      // 🧠 CONCEPT: Audit-log privileged access
      // WHY IT MATTERS (interview angle): an admin override is a legitimate
      //   feature and an insider-threat vector. If an admin can read any
      //   user's data, the compensating control is that every such access is
      //   logged and reviewable. "We log privileged access" is what turns a
      //   backdoor into a documented capability.
      // ============================================================
      logger.warn(
        `[authz] ADMIN OVERRIDE: admin ${req.user.id} accessed ${Model.modelName} ${resourceId} owned by ${resource[ownerField]}`
      );
    }

    // Hand the already-loaded document to the controller so it does not
    // re-query. Saves a round-trip and guarantees the controller operates on
    // the exact document that passed the check (no TOCTOU gap).
    req.resource = resource;
    return next();
  });
}

module.exports = {
  verifyAccessToken,
  optionalAuth,
  requireRole,
  requireOwnership,
  extractBearerToken,
};
