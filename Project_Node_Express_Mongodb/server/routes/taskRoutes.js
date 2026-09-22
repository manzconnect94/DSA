const express = require('express');
const taskController = require('../controllers/taskController');
const Task = require('../models/Task');
const { verifyAccessToken, requireOwnership } = require('../middleware/auth');
const { expensiveLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/upload');
const {
  createTaskValidation,
  updateTaskValidation,
  mongoIdParamValidation,
  listTasksValidation,
} = require('../middleware/validate');

const router = express.Router();

// ============================================================
// 🧠 CONCEPT: Router-level auth for an entire resource
// WHY IT MATTERS (interview angle): every task route requires a logged-in
//   user, so the check belongs here once rather than on eight individual
//   routes. Secure by default — see routes/authRoutes.js for the same point.
// ============================================================
router.use(verifyAccessToken);

// ============================================================
// 🧠 CONCEPT: ROUTE ORDER — specific paths BEFORE parameterised ones
// WHY IT MATTERS (interview angle): a classic Express bug. Express matches
//   routes in REGISTRATION ORDER and stops at the first hit. If you declare
//   `/:id` before `/stats`, then GET /api/tasks/stats matches `/:id` with
//   id = "stats", and the controller tries to look up a Task with the id
//   "stats" — producing a CastError 400, or worse a confusing 404, on a
//   route you are certain you defined.
//   RULE: static segments first, dynamic segments last.
// ============================================================
router.get('/stats', taskController.getTaskStats);
router.get('/activity', taskController.getActivity);

// The CSV export gets a tighter rate limit — it is the most expensive
// endpoint in the app. Cost-based limiting, applied at route level.
router.get('/export', expensiveLimiter, taskController.exportTasksCsv);

// ---- Collection routes ----
router.get('/', listTasksValidation, taskController.listTasks);
router.post('/', createTaskValidation, taskController.createTask);

// ---- Single-resource routes ----
// ============================================================
// 🧠 CONCEPT: requireOwnership is the IDOR fix, applied as middleware
// WHY IT MATTERS (interview angle): every route below takes an id from the
//   URL, which is attacker-controlled. requireOwnership(Task) loads the
//   document SCOPED TO THE CALLER and 404s if it isn't theirs. Because it
//   is middleware rather than a line inside each controller, it cannot be
//   forgotten when someone adds the next `/:id` route. See the full IDOR
//   breakdown in middleware/auth.js.
// ============================================================
router.get('/:id', mongoIdParamValidation, requireOwnership(Task), taskController.getTask);
router.patch('/:id', updateTaskValidation, requireOwnership(Task), taskController.updateTask);
router.delete('/:id', mongoIdParamValidation, requireOwnership(Task), taskController.deleteTask);

// ============================================================
// 🧠 CONCEPT: Multer must run BEFORE anything that reads req.body
// WHY IT MATTERS (interview angle): express.json() cannot parse
//   multipart/form-data, so on this route req.body is EMPTY until
//   upload.single() has parsed the request. Any validation middleware
//   placed before it would see nothing. Note the ordering: multer, then
//   the id validation, then ownership, then the controller.
// ============================================================
router.post(
  '/:id/attachment',
  upload.single('file'),
  mongoIdParamValidation,
  requireOwnership(Task),
  taskController.uploadAttachment
);

module.exports = router;
