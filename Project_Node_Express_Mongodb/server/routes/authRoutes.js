// ============================================================
// 🧠 CONCEPT: Routes define WIRING ONLY — no business logic
// WHY IT MATTERS (interview angle): a route file should read like a table
//   of contents: method, path, middleware chain, controller. Putting logic
//   here makes it untestable (you can only reach it through HTTP) and
//   unreusable. The separation is routes -> middleware -> controller ->
//   model, and each layer should be swappable.
// HOW IT WORKS HERE: every line below is "path + middleware + handler".
// ============================================================

const express = require('express');
const authController = require('../controllers/authController');
const { verifyAccessToken } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter');
const { registerValidation, loginValidation } = require('../middleware/validate');

const router = express.Router();

// ============================================================
// 🧠 CONCEPT: The middleware chain, read left to right
// WHY IT MATTERS (interview angle): the order below IS the execution order,
//   and each step can short-circuit the rest:
//
//     registerLimiter  -> too many requests?      -> 429, chain stops
//     registerValidation -> body malformed?       -> 400, chain stops
//     authController.register -> the actual work
//
//   Putting the rate limiter FIRST is deliberate: it is the cheapest check,
//   and you want to reject abuse before spending CPU on validation or a DB
//   query. Ordering middleware cheapest-first is a real performance
//   consideration under attack.
// ============================================================

// ---- PUBLIC ROUTES (no token required) ----
router.post('/register', registerLimiter, registerValidation, authController.register);
router.post('/login', loginLimiter, loginValidation, authController.login);

// ============================================================
// 🧠 CONCEPT: /refresh is public, but not unauthenticated
// WHY IT MATTERS (interview angle): it deliberately does NOT use
//   verifyAccessToken — by the time you need to refresh, your access token
//   has expired, so requiring one would be a deadlock. The refresh token in
//   the httpOnly cookie IS the credential for this endpoint, and the
//   controller verifies it against both the signature and the database.
// ============================================================
router.post('/refresh', authController.refresh);

// Logout accepts either state (with or without a valid access token) so it
// is always usable — see the idempotency note in the controller.
router.post('/logout', authController.logout);

// ---- PROTECTED ROUTES ----
// ============================================================
// 🧠 CONCEPT: Router-level middleware via router.use()
// WHY IT MATTERS (interview angle): everything registered BELOW this line
//   inherits verifyAccessToken. This is secure-by-default: a new endpoint
//   added at the bottom is protected automatically, whereas per-route
//   middleware relies on the next developer remembering. Note it must come
//   after the public routes — router.use() only affects what follows it.
// ============================================================
router.use(verifyAccessToken);

router.get('/me', authController.me);
router.get('/sessions', authController.listSessions);
router.post('/logout-all', authController.logoutAll);
router.patch('/password', authController.changePassword);

module.exports = router;
