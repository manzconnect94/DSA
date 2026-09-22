// ============================================================
// 🧠 CONCEPT: Express ERROR-HANDLING middleware — the 4-argument signature
// WHY IT MATTERS (interview angle): a guaranteed Express question. Express
//   distinguishes normal middleware from error middleware SOLELY BY THE
//   NUMBER OF DECLARED PARAMETERS — it literally reads `fn.length`.
//
//     (req, res, next)        -> 3 args -> NORMAL middleware
//     (err, req, res, next)   -> 4 args -> ERROR middleware
//
//   Consequences that catch people out:
//
//   ⚠️ You CANNOT omit `next` even if unused. Writing
//      `(err, req, res)` gives fn.length === 3, so Express registers it as
//      NORMAL middleware. It then never receives errors, `err` is actually
//      the request object, and your error handling silently does nothing.
//      This is why `next` is present-but-unused in the signature below —
//      and why eslint-disable comments for unused args are common here.
//
//   ⚠️ You cannot use default parameters or rest args either:
//      `(err, req, res, next = noop)` has fn.length === 3. Same silent break.
//
//   ⚠️ ORDER MATTERS. Error middleware must be registered LAST, after all
//      routes. Express walks the stack in registration order; a handler
//      registered before your routes will never see errors from them.
//
//   HOW AN ERROR REACHES HERE: calling `next(err)` with ANY truthy argument
//   makes Express skip every remaining normal middleware and jump to the
//   first error handler. Synchronous throws inside a handler are caught by
//   Express automatically. ASYNC rejections are NOT (in Express 4) — which
//   is the entire reason utils/asyncHandler.js exists.
//
// HOW IT WORKS HERE: one central handler that normalises every error type
//   (Mongoose, JWT, Multer, Mongo driver) into a consistent JSON shape.
// ============================================================

const mongoose = require('mongoose');
const multer = require('multer');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const logger = require('../utils/logger');

// ------------------------------------------------------------------
// 404 handler — a NORMAL (3-arg) middleware, mounted after all routes
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: The catch-all 404 is NOT error middleware
// WHY IT MATTERS (interview angle): a request that matches no route is not
//   an "error" as far as Express is concerned — it just falls off the end of
//   the stack, and Express's default handler sends an HTML 404 page. For a
//   JSON API you want a JSON 404, so you add a normal middleware at the very
//   end (it only runs if nothing else matched) and convert it into an error
//   by calling next(err).
// ============================================================
function notFoundHandler(req, _res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, { code: 'ROUTE_NOT_FOUND' }));
}

// ------------------------------------------------------------------
// Translators: third-party error shapes -> our ApiError
// ------------------------------------------------------------------

// ============================================================
// 🧠 CONCEPT: Translating Mongoose/Mongo errors at the boundary
// WHY IT MATTERS (interview angle): raw database errors must never reach the
//   client. Two reasons: they are unreadable ("E11000 duplicate key error
//   collection: app.users index: email_1 dup key"), and they LEAK your
//   internals — collection names, index names, and field structure, all of
//   which help an attacker. Translate at one boundary so every route gets
//   the same clean output.
// ============================================================
function translateError(err) {
  // Already one of ours — pass through.
  if (err instanceof ApiError) return err;

  // --- Mongoose validation (required, minlength, enum, match) ---
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return new ApiError(400, 'Validation failed', { code: 'VALIDATION_ERROR', details });
  }

  // --- Mongoose cast error: bad ObjectId, bad Number, etc. ---
  if (err instanceof mongoose.Error.CastError) {
    // Note we report the FIELD but not the raw value — echoing unsanitised
    // input back can enable reflected XSS if the response is ever rendered.
    return new ApiError(400, `Invalid value for field "${err.path}"`, { code: 'CAST_ERROR' });
  }

  // ============================================================
  // 🧠 CONCEPT: Duplicate key = error code 11000
  // WHY IT MATTERS (interview angle): `unique: true` is an index, not a
  //   validator (see models/User.js), so a duplicate surfaces as a raw
  //   MongoServerError with code 11000 — NOT a ValidationError. If you only
  //   handle ValidationError, every duplicate signup returns a 500. This
  //   translation to 409 Conflict is the fix, and it is a very common
  //   interview follow-up to "how do you enforce unique emails?"
  // ============================================================
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    return new ApiError(409, `A record with that ${field} already exists`, {
      code: 'DUPLICATE_KEY',
      details: [{ field, message: 'must be unique' }],
    });
  }

  // --- JWT errors that escaped the auth middleware ---
  if (err.name === 'TokenExpiredError') {
    return new ApiError(401, 'Token expired', { code: 'TOKEN_EXPIRED' });
  }
  if (err.name === 'JsonWebTokenError') {
    return new ApiError(401, 'Invalid token', { code: 'TOKEN_INVALID' });
  }

  // ============================================================
  // 🧠 CONCEPT: Multer errors are their own class
  // WHY IT MATTERS (interview angle): a file that exceeds your size limit
  //   throws MulterError('LIMIT_FILE_SIZE'), not a generic error. Left
  //   untranslated, uploading a 50MB file returns a 500 — which looks like
  //   your server broke rather than the user breaking a rule. 413 Payload
  //   Too Large is the correct, actionable status.
  // ============================================================
  if (err instanceof multer.MulterError) {
    const statusByCode = { LIMIT_FILE_SIZE: 413, LIMIT_FILE_COUNT: 413, LIMIT_UNEXPECTED_FILE: 400 };
    return new ApiError(statusByCode[err.code] || 400, `Upload failed: ${err.message}`, { code: err.code });
  }

  // ============================================================
  // 🧠 CONCEPT: Malformed JSON body
  // WHY IT MATTERS (interview angle): express.json() throws a SyntaxError
  //   with a `body` property when the payload isn't valid JSON. Without
  //   handling, a typo in a curl command returns a 500 with a stack trace.
  // ============================================================
  if (err instanceof SyntaxError && 'body' in err) {
    return new ApiError(400, 'Malformed JSON in request body', { code: 'MALFORMED_JSON' });
  }

  // --- Anything else is a PROGRAMMER error: unknown, untrusted, 500 ---
  return new ApiError(err.statusCode || 500, err.message || 'Internal server error', {
    code: err.code || 'INTERNAL',
    isOperational: false,
  });
}

// ------------------------------------------------------------------
// The central error handler — NOTE THE FOUR PARAMETERS
// ------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  //                                     ^^^^
  // `next` is unused but MUST be declared. Remove it and fn.length drops to
  // 3, Express treats this as normal middleware, and error handling silently
  // stops working. See the concept block at the top of this file.

  const apiError = translateError(err);

  // ============================================================
  // 🧠 CONCEPT: Log the full error server-side, send a safe one to the client
  // WHY IT MATTERS (interview angle): stack traces in an HTTP response are a
  //   real vulnerability — they expose file paths, library versions, and
  //   sometimes credentials from connection strings. But you still NEED the
  //   full detail to debug. The split: everything to the log, the minimum to
  //   the client.
  // ============================================================
  const logContext = {
    method: req.method,
    url: req.originalUrl,
    status: apiError.statusCode,
    requestId: req.id,
    userId: req.user?.id,
    ip: req.ip,
  };

  if (apiError.statusCode >= 500) {
    logger.error(`[error] ${JSON.stringify(logContext)}`, err.stack || err.message);
  } else {
    // 4xx is usually the client's fault — warn level keeps error-rate alerts
    // meaningful. If every 401 paged you, you'd mute the alert within a day.
    logger.warn(`[error] ${JSON.stringify(logContext)} ${apiError.message}`);
  }

  // ============================================================
  // 🧠 CONCEPT: Never leak internals on a 500
  // WHY IT MATTERS (interview angle): for OPERATIONAL errors (a 400 we
  //   raised deliberately) the message is safe and helpful — we wrote it.
  //   For non-operational 500s the message came from a library or the
  //   runtime and may contain a file path, a query, or a connection string.
  //   Replace it with a generic string in production.
  //   `isOperational` (set in ApiError) is exactly the flag that decides.
  // ============================================================
  const safeToExpose = apiError.isOperational || !config.isProd;
  const message = safeToExpose ? apiError.message : 'Internal server error';

  const body = {
    success: false,
    error: {
      code: apiError.code || 'ERROR',
      message,
      ...(apiError.details ? { details: apiError.details } : {}),
      ...(req.id ? { requestId: req.id } : {}),
    },
  };

  // Stack traces ONLY outside production. The requestId above is how you
  // correlate a user's report with the full server-side log entry.
  if (!config.isProd && apiError.statusCode >= 500) {
    body.error.stack = err.stack;
  }

  // ============================================================
  // 🧠 CONCEPT: Guard against "headers already sent"
  // WHY IT MATTERS (interview angle): if an error occurs AFTER you've begun
  //   streaming a response (our CSV export is a perfect example), the status
  //   and headers are already on the wire. Calling res.status().json() then
  //   throws ERR_HTTP_HEADERS_SENT — turning one error into two. The correct
  //   move is to delegate to Express's default handler, which destroys the
  //   socket so the client sees a truncated response rather than corrupt data.
  // ============================================================
  if (res.headersSent) {
    logger.error('[error] headers already sent — destroying the connection');
    return next(err);
  }

  return res.status(apiError.statusCode).json(body);
}

// ============================================================
// 🧠 CONCEPT: Process-level safety nets
// WHY IT MATTERS (interview angle): the error middleware only catches errors
//   that happen INSIDE a request. Errors in a timer, an event listener, or a
//   background job have no req/res and bypass it entirely. Those hit
//   'uncaughtException' / 'unhandledRejection'.
//
//   THE CONTROVERSIAL PART, and the answer they want: after an
//   uncaughtException you should LOG AND EXIT, not "keep the server alive".
//   The exception unwound the stack from an arbitrary point, so locks may be
//   held, transactions half-applied, and module state inconsistent. The
//   process is in an UNKNOWN state, and continuing means serving corrupt
//   data. Crash, and let your supervisor (pm2, systemd, Kubernetes) restart
//   a clean process. Graceful shutdown means: stop accepting new
//   connections, let in-flight requests finish, then exit.
//
//   Note Node 15+ made unhandled promise rejections fatal BY DEFAULT — they
//   used to be a warning. Code written pre-2020 that relied on that warning
//   now crashes.
//
// HOW IT WORKS HERE: registerProcessHandlers() is called from server.js,
//   which owns the HTTP server and can therefore drain it properly.
// ============================================================
function registerProcessHandlers(server) {
  const shutdown = (reason, err, exitCode = 1) => {
    logger.error(`[fatal] ${reason}:`, err?.stack || err?.message || err);

    if (!server) process.exit(exitCode);

    // Stop accepting new connections; the callback fires once all existing
    // ones have completed.
    server.close(() => {
      logger.info('[fatal] server drained, exiting');
      process.exit(exitCode);
    });

    // Hard deadline: if a connection hangs (a long poll, a stuck stream),
    // don't wait forever. 10s is a common default.
    setTimeout(() => {
      logger.error('[fatal] drain timed out — forcing exit');
      process.exit(exitCode);
    }, 10_000).unref(); // unref so this timer alone can't keep the process alive
  };

  process.on('uncaughtException', (err) => shutdown('uncaughtException', err));
  process.on('unhandledRejection', (reason) => shutdown('unhandledRejection', reason));

  // ============================================================
  // 🧠 CONCEPT: SIGTERM and graceful shutdown in containers
  // WHY IT MATTERS (interview angle): when Kubernetes or Docker stops your
  //   container it sends SIGTERM and waits (default 30s) before SIGKILL.
  //   If you ignore SIGTERM, every in-flight request is killed mid-response
  //   — users see errors on every single deploy. Handling it is what makes
  //   zero-downtime deploys possible. SIGINT is Ctrl-C locally.
  // ============================================================
  process.on('SIGTERM', () => {
    logger.info('[shutdown] SIGTERM received — draining connections');
    shutdown('SIGTERM', new Error('terminated'), 0);
  });
  process.on('SIGINT', () => {
    logger.info('[shutdown] SIGINT received (Ctrl-C)');
    shutdown('SIGINT', new Error('interrupted'), 0);
  });
}

module.exports = { errorHandler, notFoundHandler, registerProcessHandlers, translateError };
