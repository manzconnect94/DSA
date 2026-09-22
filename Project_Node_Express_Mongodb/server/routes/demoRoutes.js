// ============================================================
// 🧠 CONCEPT: The performance demo routes
// WHY IT MATTERS (interview angle): these are the endpoints you run to
//   SHOW the slow-vs-fast difference rather than assert it. Seed data
//   first (`npm run seed:big`), then compare.
// HOW IT WORKS HERE: all behind auth (the fast path filters by owner) and
//   behind a tight rate limit, because the slow path is a deliberate
//   COLLSCAN and you do not want it hammered.
// ============================================================

const express = require('express');
const demo = require('../controllers/queryDemoController');
const { verifyAccessToken } = require('../middleware/auth');
const { expensiveLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(verifyAccessToken);
router.use(expensiveLimiter);

// ❌ Every mistake: COLLSCAN, no projection, no lean, N+1, JS aggregation.
router.get('/tasks-slow', demo.tasksSlow);

// ✅ Every fix: IXSCAN, $project, $lookup, $group — one query.
router.get('/tasks-fast', demo.tasksFast);

// Runs both back to back and reports the speedup ratio.
router.get('/compare', demo.compare);

// Raw .explain('executionStats') for the unindexed, indexed and covered queries.
router.get('/explain', demo.explainQueries);

// Index inventory plus $indexStats usage counts (find your dead indexes).
router.get('/indexes', demo.indexInfo);

// Loop vs populate() vs $lookup, timed.
router.get('/populate', demo.populateDemo);

module.exports = router;
