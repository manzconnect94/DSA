const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyAccessToken, requireRole } = require('../middleware/auth');
const { mongoIdParamValidation } = require('../middleware/validate');

const router = express.Router();

// ============================================================
// 🧠 CONCEPT: Stacking AuthN then AuthZ at router level
// WHY IT MATTERS (interview angle): the order is not optional.
//   verifyAccessToken must run FIRST to populate req.user; requireRole
//   then reads it. Swap them and req.user is undefined — requireRole fails
//   closed (returning 401, by design) but the intent is broken.
//   Applying both with router.use() means EVERY admin route is gated, and
//   a new one added below inherits the gate automatically. This is the
//   single most important place to be secure-by-default: forgetting an
//   auth check on an admin endpoint is a critical vulnerability.
// ============================================================
router.use(verifyAccessToken);
router.use(requireRole('admin'));

router.get('/users', adminController.listUsers);
router.get('/overview', adminController.overview);
router.patch('/users/:id/role', mongoIdParamValidation, adminController.changeUserRole);
router.post('/users/:id/revoke-sessions', mongoIdParamValidation, adminController.revokeUserSessions);
router.post('/cache/flush', adminController.flushCache);

// Worker-thread demo: ?mode=worker (default) vs ?mode=blocking
router.get('/report', adminController.generateReport);

module.exports = router;
