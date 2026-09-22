// ============================================================
// 🧠 CONCEPT: CommonJS (CJS) vs ES Modules (ESM) — we picked CJS
// WHY IT MATTERS (interview angle): a guaranteed Node question. The
//   differences that actually matter:
//
//   ┌──────────────────┬───────────────────────┬──────────────────────────┐
//   │                  │ CommonJS (this app)   │ ESM (the client folder)  │
//   ├──────────────────┼───────────────────────┼──────────────────────────┤
//   │ Syntax           │ require / module.exports │ import / export       │
//   │ Loading          │ SYNCHRONOUS, at runtime  │ ASYNCHRONOUS, parsed  │
//   │                  │                          │ before execution      │
//   │ Resolution       │ Dynamic — you can        │ STATIC — import paths │
//   │                  │ require(variable)        │ must be literals*     │
//   │ Tree-shaking     │ ❌ Not possible          │ ✅ Bundlers can drop  │
//   │                  │ (exports resolved at run)│ unused exports        │
//   │ Top-level await  │ ❌ No                    │ ✅ Yes                │
//   │ __dirname        │ ✅ Built in              │ ❌ Use import.meta.url│
//   │ Circular imports │ Partial object returned  │ Hoisted bindings —    │
//   │                  │ (silent undefined bugs)  │ throws on TDZ access  │
//   │ File extension   │ .js (or .cjs)            │ .mjs, or .js with     │
//   │                  │                          │ "type":"module"       │
//   └──────────────────┴───────────────────────┴──────────────────────────┘
//   * ESM has dynamic import() for the runtime case — that is exactly what
//     React.lazy uses for code splitting on the client.
//
//   ⭐ THE KEY INSIGHT: ESM's static structure is what enables TREE-SHAKING.
//   Because imports are resolved before execution, a bundler can PROVE a
//   given export is never used and delete it. CommonJS's `require()` can
//   take a computed path, so nothing can be proven and nothing can be
//   dropped. That is why the frontend uses ESM and why bundle size is an
//   ESM conversation.
//
//   ⚠️ INTEROP: ESM can `import` a CJS module (it gets the module.exports
//   as the default). CJS canNOT `require()` an ESM module — it must use
//   dynamic `await import()`. This one-way street is why migrations are
//   painful and why many Node backends are still CJS.
//
//   WHY CJS HERE: it is still what you meet in most existing Node
//   codebases and most interview questions, there is no bundler on the
//   server so tree-shaking is irrelevant, and `require` inside a function
//   (lazy loading) is occasionally useful. The client uses ESM via Vite,
//   so this repo shows both.
// ============================================================

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const config = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { requestLogger, requestId } = require('./middleware/requestLogger');
const { globalLimiter } = require('./middleware/rateLimiter');
const { sanitizeMongo } = require('./middleware/validate');
const logger = require('./utils/logger');

const app = express();

// ============================================================
// 🧠 CONCEPT: MIDDLEWARE ORDER — the whole file is one ordered list
// WHY IT MATTERS (interview angle): Express executes middleware in
//   REGISTRATION ORDER, so this file IS the request lifecycle. Reordering
//   two lines here can silently disable a security control. The ordering
//   principle: identity/observability -> security -> parsing -> throttling
//   -> routes -> 404 -> errors.
//
//   THE CLASSIC ORDERING BUGS:
//   • express.json() AFTER the routes -> req.body is undefined everywhere.
//   • helmet() AFTER the routes -> no security headers on any API response.
//   • The error handler BEFORE the routes -> it never sees a single error.
//   • cors() after a route -> that route's preflight fails while others work.
// ============================================================

// ---------------------------------------------------------------- 1
// ============================================================
// 🧠 CONCEPT: trust proxy
// WHY IT MATTERS (interview angle): behind a load balancer, nginx or
//   Cloudflare, every request arrives from the PROXY's IP. `req.ip` shows
//   the proxy, `req.protocol` says "http" even though the user is on HTTPS,
//   and `req.secure` is false. `trust proxy` tells Express to read the
//   X-Forwarded-For / X-Forwarded-Proto headers instead.
//
//   ⚠️ THE SECURITY CATCH, which is the real question: X-Forwarded-For is
//   just a header, and a CLIENT CAN SET IT. If you `trust proxy: true`
//   (trust everything) while directly exposed, any attacker can spoof their
//   IP and completely bypass your per-IP rate limiting — and poison your
//   audit logs. Set it to the specific number of proxy hops, or to your
//   proxy's subnet, never a blanket `true` in production.
// ============================================================
if (config.isProd) {
  app.set('trust proxy', 1); // exactly one proxy in front of us
} else {
  app.set('trust proxy', false);
}

// Don't advertise the framework. Minor, but free.
app.disable('x-powered-by');

// ---------------------------------------------------------------- 2
// Correlation id + request logging. FIRST, so every subsequent middleware
// (including a 429 from the rate limiter) is traceable.
app.use(requestId);
app.use(requestLogger);

// ---------------------------------------------------------------- 3
// ============================================================
// 🧠 CONCEPT: helmet — secure HTTP headers
// WHY IT MATTERS (interview angle): helmet is ~15 small middleware in one
//   package. Know what the important ones actually DO, because "I use
//   helmet" alone is a shallow answer:
//
//   • Content-Security-Policy — ⭐ THE BIG ONE. An allowlist of where
//     scripts, styles and images may load from. It is the last line of
//     defence against XSS: even if an attacker injects a <script> tag, the
//     browser refuses to execute it because the source is not allowlisted.
//   • Strict-Transport-Security (HSTS) — "only ever talk to me over HTTPS,
//     for the next N seconds". Kills SSL-stripping downgrade attacks. Be
//     careful: a long max-age is hard to undo if your certificate breaks.
//   • X-Content-Type-Options: nosniff — stops the browser from guessing a
//     response's type. Without it, a .txt upload containing HTML can be
//     sniffed as HTML and executed.
//   • X-Frame-Options / frame-ancestors — prevents CLICKJACKING: your site
//     being loaded in an invisible iframe over an attacker's page so users
//     click your buttons without knowing.
//   • Referrer-Policy — stops URLs (which may contain tokens or ids)
//     leaking to third parties via the Referer header.
//   • X-DNS-Prefetch-Control, Origin-Agent-Cluster, and others.
//
//   ⚠️ Note what helmet does NOT do: it sets response headers. It cannot
//   stop SQL/NoSQL injection, broken access control, or IDOR. It is one
//   layer, and the shallowest one.
// ============================================================
app.use(
  helmet({
    contentSecurityPolicy: config.isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // ⚠️ 'unsafe-inline' for styles is a common pragmatic
            // compromise (CSS-in-JS needs it) — it meaningfully weakens the
            // policy, and the correct fix is nonces or hashes.
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", ...config.clientOrigins],
            objectSrc: ["'none'"], // blocks Flash/legacy plugin vectors
            frameAncestors: ["'none'"], // anti-clickjacking
            upgradeInsecureRequests: [],
          },
        }
      : false, // CSP off in dev — Vite's HMR uses inline scripts and eval
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  })
);

// ---------------------------------------------------------------- 4
// ============================================================
// 🧠 CONCEPT: CORS — what it actually protects, and what it does NOT
// WHY IT MATTERS (interview angle): the most widely misunderstood web
//   security mechanism, and interviewers know it.
//
//   THE STARTING POINT IS THE SAME-ORIGIN POLICY (SOP), a browser rule:
//   JavaScript on origin A may not READ responses from origin B. An origin
//   is the triple (scheme, host, port) — https://app.com and
//   http://app.com are different origins, as are app.com:80 and app.com:3000.
//
//   CORS RELAXES the SOP. It is a way for a server to say "these specific
//   other origins are allowed to read my responses". So:
//
//   ⭐ CORS IS NOT A SERVER-SIDE SECURITY CONTROL. It does not protect your
//   API. Read that again, because the common belief is the opposite.
//
//   WHAT IT ACTUALLY DOES: it protects YOUR USERS FROM OTHER SITES. Without
//   the SOP, evil.com could run fetch('https://yourbank.com/api/balance')
//   in a visitor's browser, WITH their cookies attached, and read the
//   response. CORS/SOP is what stops that.
//
//   WHAT IT DOES NOT DO:
//   ❌ It does not stop curl, Postman, a Python script, or any non-browser
//      client. Those ignore CORS entirely — it is enforced BY THE BROWSER,
//      not by your server. A restrictive CORS policy provides exactly zero
//      protection against a determined attacker with a terminal.
//   ❌ It does not stop the REQUEST from reaching your server. For a
//      "simple" request the browser SENDS it and only blocks the CLIENT
//      from READING the response — so a cross-origin POST that deletes a
//      record STILL DELETES IT. That is why CSRF is a separate problem
//      needing SameSite cookies or CSRF tokens.
//   ❌ It is not authentication or authorization. Those are your JWT and
//      your ownership checks.
//
//   ⚠️ TWO CONFIGURATION TRAPS:
//   1. `origin: '*'` with `credentials: true` is ILLEGAL per spec and the
//      browser will reject it. If you need cookies, you must echo a
//      specific origin.
//   2. Reflecting the request's Origin header unconditionally
//      (`origin: (o, cb) => cb(null, true)`) is functionally a wildcard
//      that ALSO works with credentials — the worst of both. Always use an
//      explicit allowlist, as below.
//
//   PREFLIGHT: for anything beyond a "simple" request (custom headers like
//   Authorization, or methods like PATCH/DELETE), the browser first sends
//   an OPTIONS request asking permission. `maxAge` caches that answer so
//   you are not paying a double round-trip on every single API call.
// ============================================================
app.use(
  cors({
    origin: (origin, callback) => {
      // No origin = a same-origin request, curl, or a mobile app. Allowed:
      // blocking it would break your own health checks, and as established
      // above, CORS was never protecting you from those clients anyway.
      if (!origin) return callback(null, true);

      if (config.clientOrigins.includes(origin)) return callback(null, true);

      logger.warn(`[cors] blocked origin: ${origin}`);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    // Required for the httpOnly refresh cookie to be sent and set
    // cross-origin. This is what forces the explicit allowlist above.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    // Response headers the browser will let client JS read. By default the
    // client can only see a tiny safelist — anything custom must be listed.
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining'],
    maxAge: 86400, // cache the preflight answer for 24h
  })
);

// ---------------------------------------------------------------- 5
// ============================================================
// 🧠 CONCEPT: compression — and when it is a NET LOSS
// WHY IT MATTERS (interview angle): gzip/brotli typically shrinks JSON by
//   70-90%, which is a large win over the network. But it is a CPU/bandwidth
//   TRADE, not free, and knowing when NOT to use it is the better answer:
//
//   ❌ DON'T COMPRESS:
//   • Small responses. Below roughly 1KB the gzip header and CPU cost
//     exceed the saving, and you may even make the payload LARGER. Hence
//     the `threshold` below.
//   • Already-compressed data: JPEG, PNG, MP4, ZIP. Recompressing burns CPU
//     for ~0% gain.
//   • When a CDN or reverse proxy (nginx, Cloudflare) already does it —
//     doing it twice just spends your Node CPU, and Node is single-threaded
//     so that CPU is your request capacity. In production, compression
//     usually belongs at the edge, NOT in the app.
//
//   ⚠️ THE SECURITY ANGLE — BREACH/CRIME: compressing a response that
//   contains BOTH a secret (a CSRF token) AND attacker-influenced content
//   can leak the secret via response SIZE. Compression makes repeated
//   strings smaller, so an attacker who can inject guesses watches the
//   length change to confirm a correct guess, character by character. This
//   is why you should not gzip responses that mix secrets with reflected
//   input.
// ============================================================
app.use(
  compression({
    threshold: 1024, // don't bother below 1KB
    filter: (req, res) => {
      // Let a client opt out with `x-no-compression`.
      if (req.headers['x-no-compression']) return false;
      // Never compress an SSE stream — buffering breaks the live feed.
      if (res.getHeader('Content-Type') === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  })
);

// ---------------------------------------------------------------- 6
// ============================================================
// 🧠 CONCEPT: Body parsing with a SIZE LIMIT
// WHY IT MATTERS (interview angle): `express.json()` defaults to a 100kb
//   limit — which is good, because without one an attacker POSTs a 2GB JSON
//   body and your process buffers it all into memory before your code ever
//   runs. Set it explicitly so the value is a decision, not an accident.
//   Note this runs BEFORE the routes — that is what makes req.body exist.
//   And `verify` gives you the RAW bytes, which you need for webhook
//   signature verification (Stripe, GitHub): you must hash exactly what was
//   sent, and re-serialising the parsed object would produce different bytes.
// ============================================================
app.use(
  express.json({
    limit: '100kb',
    verify: (req, _res, buf) => {
      // Keep the raw body only where a webhook needs it — holding it for
      // every request would double body memory for no reason.
      if (req.originalUrl.startsWith('/api/webhooks')) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ============================================================
// 🧠 CONCEPT: cookie-parser
// WHY IT MATTERS (interview angle): without it, `req.cookies` does not
//   exist — you would be parsing the raw `Cookie` header string yourself.
//   Our refresh-token flow reads req.cookies.refreshToken, so this must be
//   registered before the auth routes.
// ============================================================
app.use(cookieParser());

// ---------------------------------------------------------------- 7
// NoSQL-operator + prototype-pollution stripping, applied app-wide AFTER
// parsing (there is nothing to sanitise before the body exists) and BEFORE
// any route can use the data. See middleware/validate.js for the full
// injection breakdown.
app.use(sanitizeMongo);

// ---------------------------------------------------------------- 8
// Global rate limit on the API surface only — we don't want it counting
// static asset requests.
app.use('/api', globalLimiter);

// ---------------------------------------------------------------- 9
// ============================================================
// 🧠 CONCEPT: Serving static files, and why uploads are a special case
// WHY IT MATTERS (interview angle): express.static is fine for
//   development. In production you serve static assets from a CDN or nginx,
//   because Node's single thread should be answering API calls, not
//   shipping bytes off disk.
//   ⚠️ For USER UPLOADS specifically, note the headers below.
//   `Content-Disposition: attachment` forces a download instead of
//   rendering — critical because an uploaded .html or .svg served from your
//   origin can run JavaScript in YOUR origin's context and steal sessions.
//   The properly paranoid answer is to serve uploads from an entirely
//   separate domain or an S3 bucket.
// ============================================================
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  },
  express.static(require('path').join(__dirname, 'uploads'), {
    maxAge: '1d',
    index: false, // no directory listing
    dotfiles: 'deny',
  })
);

// ---------------------------------------------------------------- 10
// THE ROUTES. Everything above is plumbing that runs first.
app.use('/api', routes);

// ---------------------------------------------------------------- 11
// ============================================================
// 🧠 CONCEPT: 404 then error handler, in that order, LAST
// WHY IT MATTERS (interview angle): notFoundHandler is a NORMAL 3-arg
//   middleware — it only executes if no route above matched. It converts
//   "nothing matched" into an error via next(err), which then reaches
//   errorHandler, the 4-arg one. Register these before your routes and
//   every request 404s; register the error handler first and it never
//   fires. See middleware/errorHandler.js for the full signature
//   explanation.
// ============================================================
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
