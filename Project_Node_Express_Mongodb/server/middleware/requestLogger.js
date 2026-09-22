// ============================================================
// 🧠 CONCEPT: Custom middleware & the middleware EXECUTION ORDER
// WHY IT MATTERS (interview angle): Express is, at its core, a linked list
//   of functions. Each one receives (req, res, next) and must do exactly one
//   of three things:
//
//     1. Call next()            -> pass control to the NEXT middleware
//     2. Send a response        -> res.json() / res.send() ENDS the chain
//     3. Call next(err)         -> SKIP to the error middleware
//
//   ⚠️ DOING NEITHER IS THE CLASSIC BUG: forget next() and the request
//   HANGS. No error, no log, no response — the client just waits until it
//   times out. When someone says "my Express route does nothing", a missing
//   next() is the first thing to check.
//
//   ⚠️ CALLING next() *AND* SENDING A RESPONSE is the other one: control
//   continues down the chain, a later handler tries to respond too, and you
//   get ERR_HTTP_HEADERS_SENT. Remember `return next()` / `return res.json()`.
//
//   ORDER IS DEFINED BY REGISTRATION ORDER, top to bottom in app.js. This is
//   why helmet() must be registered before your routes (or the headers are
//   never set on those responses), why express.json() must come before any
//   handler that reads req.body (or it is undefined), and why the error
//   handler must be registered LAST.
//
// HOW IT WORKS HERE: this middleware demonstrates the "wrap the response"
//   pattern — do work before next(), then more work once the response
//   finishes.
// ============================================================

const crypto = require('crypto');
const logger = require('../utils/logger');

// ============================================================
// 🧠 CONCEPT: Request ID / correlation ID
// WHY IT MATTERS (interview angle): in a distributed system one user action
//   can touch five services and produce fifty log lines across five files.
//   Without a shared id you cannot reconstruct what happened. Generate an id
//   at the edge, attach it to every log line, return it in a response
//   header, and PROPAGATE it to downstream services (this is what W3C
//   `traceparent` and OpenTelemetry standardise). When a user reports "it
//   broke at 14:32", you ask for the request id from the error response and
//   find every related line instantly.
// HOW IT WORKS HERE: accept an inbound X-Request-Id if a proxy already set
//   one (don't break an existing trace), otherwise generate one.
// ============================================================
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * Log every request with its status and duration.
 */
function requestLogger(req, res, next) {
  // ============================================================
  // 🧠 CONCEPT: process.hrtime.bigint() vs Date.now()
  // WHY IT MATTERS (interview angle): Date.now() reads the WALL CLOCK, which
  //   can jump backwards (NTP correction, DST, a manual clock change) and
  //   has millisecond resolution. That can yield a negative duration.
  //   process.hrtime is a MONOTONIC clock — it only ever increases and has
  //   nanosecond resolution. Always use a monotonic clock to measure
  //   elapsed time; use the wall clock only for timestamps.
  // ============================================================
  const start = process.hrtime.bigint();

  // ============================================================
  // 🧠 CONCEPT: Hooking the 'finish' event instead of wrapping res.end
  // WHY IT MATTERS (interview angle): you want to log the status code, but
  //   it is not known when the middleware runs — it is set later, by a
  //   handler further down the chain. The old approach was monkey-patching
  //   res.end; the clean one is listening for the response's 'finish' event,
  //   which fires once the last byte is handed to the OS.
  //   Note the sibling event: 'close' fires if the CLIENT DISCONNECTS before
  //   the response completes ("user hit stop"). Logging both lets you tell
  //   "we were slow" apart from "they gave up" — which matters, because
  //   abandoned requests still consume a DB connection until they finish.
  // ============================================================
  let logged = false;

  const finalize = (event) => {
    if (logged) return; // 'finish' and 'close' can both fire
    logged = true;

    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const { statusCode } = res;

    const line = [
      `[${req.id?.slice(0, 8)}]`,
      req.method,
      req.originalUrl,
      statusCode,
      `${durationMs.toFixed(1)}ms`,
      req.user ? `user=${req.user.id}` : 'anon',
      event === 'close' ? '(client disconnected)' : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Route the log to a level that matches the outcome, so an alert on
    // "error rate" means something.
    if (statusCode >= 500) logger.error(line);
    else if (statusCode >= 400) logger.warn(line);
    else logger.info(line);

    // ============================================================
    // 🧠 CONCEPT: Slow-request logging as a poor man's APM
    // WHY IT MATTERS (interview angle): a threshold log is the cheapest
    //   possible performance monitoring and it costs nothing when things are
    //   healthy. It is how you discover the N+1 query nobody noticed.
    //   The grown-up version is percentile latency (p50/p95/p99) — and you
    //   should know WHY percentiles beat averages: one 10-second request
    //   among a thousand 10ms ones barely moves the mean, but it is exactly
    //   the request a real user is staring at.
    // ============================================================
    if (durationMs > 500) {
      logger.warn(`[slow] ${req.method} ${req.originalUrl} took ${durationMs.toFixed(0)}ms`);
    }
  };

  res.on('finish', () => finalize('finish'));
  res.on('close', () => finalize('close'));

  // ============================================================
  // 🧠 CONCEPT: next() passes control — and this line is why
  // WHY IT MATTERS (interview angle): everything above runs BEFORE the route
  //   handler; the 'finish' listener runs AFTER the response is sent. That
  //   before/after split — with next() as the hinge — is the whole
  //   middleware model. Remove this line and every request in the app hangs
  //   forever.
  // ============================================================
  next();
}

// ============================================================
// 🧠 CONCEPT: ROUTE-LEVEL vs APP-LEVEL middleware
// WHY IT MATTERS (interview angle): three scopes, and knowing which to use
//   is a design question interviewers probe:
//
//   1. APP-LEVEL      app.use(helmet())
//      Runs on EVERY request. Use for cross-cutting concerns: security
//      headers, body parsing, CORS, logging, compression.
//
//   2. ROUTER-LEVEL   router.use(verifyAccessToken)
//      Runs on every route in that router. Use when a whole resource shares
//      a requirement — e.g. all /api/tasks routes need auth.
//      ⚠️ SECURITY NOTE: prefer this over per-route auth. If you protect
//      routes individually, the day someone adds a new endpoint and forgets
//      the middleware, it ships publicly. Router-level auth is secure BY
//      DEFAULT — you have to opt OUT, not remember to opt in.
//
//   3. ROUTE-LEVEL    router.delete('/:id', requireRole('admin'), handler)
//      Runs on one route. Use for anything genuinely specific: a stricter
//      rate limit on login, an admin gate on one destructive action, a
//      multer upload parser on the one route that takes a file.
//
//   PERFORMANCE ANGLE: app-level middleware runs on every request including
//   static assets and health checks. Mounting an expensive middleware
//   app-level when only three routes need it is real wasted CPU at scale —
//   this is why we mount multer per-route and not globally.
//
// HOW IT WORKS HERE: requestLogger/requestId are app-level (every request
//   should be traceable); verifyAccessToken is router-level on /api/tasks;
//   requireRole and the upload parser are route-level.
// ============================================================

/**
 * A tiny demo middleware that makes the execution ORDER visible in the logs.
 * Mounted in app.js only in development. Hit any endpoint and watch the
 * before/after lines bracket the handler's own output.
 */
function orderDemo(label) {
  return (req, _res, next) => {
    logger.debug(`  [order] -> entering "${label}"`);
    next(); // control passes DOWN the chain here...
    // ⚠️ ...and this line runs the moment next() RETURNS, which for an async
    // handler is LONG BEFORE the response is sent. This is the subtle part:
    // next() is not "await the rest of the chain". If you want to act after
    // the response, you must use the res 'finish' event (as above), not code
    // placed after next().
    logger.debug(`  [order] <- next() returned in "${label}" (response NOT necessarily sent yet)`);
  };
}

module.exports = { requestLogger, requestId, orderDemo };
