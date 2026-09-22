// ============================================================
// 🧠 CONCEPT: Rate limiting — brute-force and abuse protection
// WHY IT MATTERS (interview angle): without it, an attacker can try 10,000
//   passwords per second against /login. bcrypt makes each guess expensive
//   for YOU (CPU) as well as for them, so an unthrottled login endpoint is
//   simultaneously a credential-stuffing target AND a denial-of-service
//   amplifier — each request costs you ~100ms of CPU on a single-threaded
//   runtime.
//
//   THE ALGORITHMS (know at least these three):
//
//   1. FIXED WINDOW — "100 requests per 15 minutes", counter resets at the
//      boundary. Simplest and cheapest.
//      ⚠️ THE EDGE-BURST FLAW: a client can send 100 requests at 14:59 and
//      100 more at 15:01 — 200 requests in two minutes, while technically
//      never breaking the limit.
//
//   2. SLIDING WINDOW — counts requests in the trailing N minutes from
//      *now*, so there is no boundary to exploit. More accurate, more
//      expensive (you track timestamps, not just a counter).
//
//   3. TOKEN BUCKET — a bucket holds N tokens and refills at a fixed rate;
//      each request spends one. Allows short BURSTS (spend the full bucket)
//      while capping the sustained average. This is what most APIs and CDNs
//      actually use, because bursty traffic is normal and legitimate.
//      (Leaky bucket is the sibling: smooths output to a constant rate.)
//
// HOW IT WORKS HERE: express-rate-limit with a fixed window (its default),
//   configured strictly for /login and loosely for everything else.
// ============================================================

const rateLimit = require('express-rate-limit');
const config = require('../config/env');
const logger = require('../utils/logger');

// ============================================================
// 🧠 CONCEPT: In-memory store vs a shared store — THE production gotcha
// WHY IT MATTERS (interview angle): express-rate-limit defaults to an
//   IN-MEMORY store. Run 4 instances behind a load balancer and each keeps
//   its OWN counter, so your "5 attempts" limit is really 20 — and it resets
//   on every deploy. This is the single most common rate-limiting mistake
//   in production, and it is invisible in dev where you run one process.
//   The fix is a shared store (rate-limit-redis) so all instances decrement
//   the same counter. Note this is the SAME argument as the Redis-vs-Map
//   discussion in config/redis.js — per-process state does not survive
//   horizontal scaling.
//   Left in-memory here so the project runs without Redis; the Redis wiring
//   is shown commented below.
// ============================================================
//
//   const RedisStore = require('rate-limit-redis');
//   const { getRedisClient } = require('../config/redis');
//   store: new RedisStore({
//     sendCommand: (...args) => getRedisClient().call(...args),
//   }),

// ============================================================
// 🧠 CONCEPT: What to KEY the limit on
// WHY IT MATTERS (interview angle): the default key is the IP address, and
//   IP alone has two failure modes in opposite directions:
//   • TOO BROAD — an entire office, university or mobile carrier shares one
//     NAT'd IP. Limiting by IP locks out hundreds of innocent users when one
//     misbehaves. Same problem with corporate VPNs.
//   • TOO NARROW — IPv6 hands a single user a whole /64. Rotate addresses
//     within it and the limit is free to bypass. (Key on the /64 prefix.)
//   Better keys where available: the authenticated user id, an API key, or
//   for login specifically, IP + submitted email combined — so an attacker
//   hammering one account can't lock out everyone on their IP, and
//   distributed attacks on one account are still caught.
// HOW IT WORKS HERE: the global limiter keys on user id when authenticated
//   and IP otherwise; the login limiter keys on IP + email.
// ============================================================

// ============================================================
// 🧠 CONCEPT: Rate limiting must be DISABLED in the test environment
// WHY IT MATTERS (interview angle): this is a real lesson learned the hard
//   way while building this project — the test suite failed with 27 errors
//   until this was added, and the cause is worth understanding.
//   Every request from Supertest originates from 127.0.0.1, so the whole
//   suite shares ONE rate-limit bucket. The register limiter allows 10 per
//   hour; the 11th test that registers a user gets a 429, and every
//   assertion after it fails with a confusing "cannot read property of
//   undefined" rather than an obvious "you were rate limited".
//   ⚠️ THE GENERAL PRINCIPLE: middleware keyed on a request attribute that
//   is CONSTANT in tests (IP, user agent) will silently couple your tests
//   together. The same applies to caches. Either disable it in the test
//   env (done here) or make the key include a per-test identifier.
//   And note the counters are in-memory, so they also do not reset between
//   test FILES within one Jest process.
// ============================================================
const skipInTests = () => config.isTest;

function onLimitReached(req, _res, _next, options) {
  logger.warn(`[ratelimit] ${req.ip} exceeded limit on ${req.method} ${req.originalUrl}`);
  // ============================================================
  // 🧠 CONCEPT: 429 Too Many Requests + Retry-After
  // WHY IT MATTERS (interview angle): 429 is the correct status, and a
  //   well-behaved API also sends `Retry-After` (seconds) and the
  //   RateLimit-* headers so clients can back off intelligently instead of
  //   retrying in a tight loop and making things worse. A client that
  //   retries immediately on 429 turns a throttle into an outage.
  // ============================================================
  return _res.status(options.statusCode).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: options.message,
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    },
  });
}

/**
 * Global limiter — a blunt backstop applied to the whole /api surface.
 * Deliberately generous: this catches runaway scripts, not targeted attacks.
 */
const globalLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs, // 15 min
  max: config.security.rateLimitMax, // 100 per window
  // Send RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset headers.
  standardHeaders: true,
  // Suppress the deprecated X-RateLimit-* headers.
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: onLimitReached,
  message: 'Too many requests from this client. Please slow down.',
  // Don't count successful preflight requests against the user, and never
  // rate limit the test suite (see the concept block above).
  skip: (req) => req.method === 'OPTIONS' || config.isTest,
});

/**
 * Login limiter — strict, because this endpoint guards credentials.
 */
const loginLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.loginRateLimitMax, // 5 attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,

  // ============================================================
  // 🧠 CONCEPT: skipSuccessfulRequests
  // WHY IT MATTERS (interview angle): only FAILED logins should count. A
  //   user who logs in successfully five times (across tabs or devices)
  //   should not be locked out — they have clearly proven they know the
  //   password. Counting only failures targets the limiter precisely at
  //   guessing behaviour.
  // ============================================================
  skipSuccessfulRequests: true,

  // Key on IP + email so one attacker cannot lock out every user behind a
  // shared NAT, and a distributed attack on one account is still throttled.
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,

  handler: onLimitReached,
  message: 'Too many failed login attempts. Try again in 15 minutes.',
  skip: skipInTests,
});

/**
 * Registration limiter — stops automated account farming.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: onLimitReached,
  message: 'Too many accounts created from this IP. Try again later.',
  skip: skipInTests,
});

/**
 * Expensive-endpoint limiter for the query demos and the CSV export.
 *
 * ============================================================
 * 🧠 CONCEPT: Cost-based limiting
 * WHY IT MATTERS (interview angle): not all requests cost the same. A cached
 *   GET is microseconds; the deliberately-slow demo query scans 50,000
 *   documents and the CSV export streams the whole collection. A flat
 *   "100 requests per window" is simultaneously too strict for the cheap
 *   endpoints and far too lax for the expensive ones. Mature APIs assign a
 *   cost/weight per endpoint and deduct from a shared budget — GitHub's
 *   GraphQL API is the canonical public example.
 * ============================================================
 */
const expensiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: onLimitReached,
  message: 'This endpoint is expensive — limited to 10 requests per minute.',
  skip: skipInTests,
});

// ============================================================
// 🧠 CONCEPT: What rate limiting does NOT protect you from
// WHY IT MATTERS (interview angle): naming the limits of your own defence is
//   a strong signal. Application-level rate limiting runs INSIDE your Node
//   process, which means a volumetric DDoS has already consumed a socket, a
//   TLS handshake and event-loop time before the limiter says no. Real
//   DDoS protection lives upstream: Cloudflare, AWS WAF/Shield, or the load
//   balancer. App-level limiting is for API abuse, brute force and runaway
//   clients — layer 7 fairness, not layer 3/4 volume.
//   Also note: `req.ip` is only trustworthy if `trust proxy` is configured
//   correctly (see app.js). Behind a misconfigured proxy every request
//   appears to come from the load balancer's IP, and your per-IP limit
//   becomes one global limit for all users.
// ============================================================

module.exports = { globalLimiter, loginLimiter, registerLimiter, expensiveLimiter };
