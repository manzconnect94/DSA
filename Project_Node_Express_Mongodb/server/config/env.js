// ============================================================
// 🧠 CONCEPT: Centralised, validated environment config
// WHY IT MATTERS (interview angle): A very common follow-up to "how do you
//   use dotenv?" is "what happens if a required env var is missing?".
//   Weak answer: the app boots and crashes later on the first request.
//   Strong answer: fail fast at boot ("crash early, crash loud"), because a
//   misconfigured process that *looks* healthy will happily pass a load
//   balancer health check and serve broken traffic.
// HOW IT WORKS HERE: every process.env read in the whole codebase happens
//   in THIS file. The rest of the app imports a typed-ish plain object.
//   That means one place to audit, and no `process.env.TYPO` returning
//   undefined silently in some far-away module.
// ============================================================

const path = require('path');
const dotenv = require('dotenv');

// ============================================================
// 🧠 CONCEPT: dotenv load order
// WHY IT MATTERS (interview angle): dotenv does NOT overwrite variables
//   that already exist in the real environment. That is deliberate: in
//   production (Docker/Kubernetes/Heroku) the platform injects real env
//   vars and there is no .env file at all. So the same code works in both
//   places, with the real environment always winning.
// HOW IT WORKS HERE: we load .env from the server folder explicitly rather
//   than relying on process.cwd(), so `node server/server.js` from the repo
//   root still finds the file.
// ============================================================
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isTest = NODE_ENV === 'test';
const isProd = NODE_ENV === 'production';

/**
 * Read a variable, falling back to a default.
 * Error-first style is not used here on purpose — this is a synchronous
 * pure function, so throwing is the correct signalling mechanism.
 */
function required(key, fallback) {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `[config] Missing required environment variable: ${key}. ` +
        `Copy server/.env.example to server/.env and fill it in.`
    );
  }
  return value;
}

function optional(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

// ============================================================
// 🧠 CONCEPT: Separate secrets for access vs refresh tokens
// WHY IT MATTERS (interview angle): if both token types are signed with the
//   same secret, an attacker who steals a long-lived refresh token can send
//   it as an access token — the signature verifies, and your
//   `verifyAccessToken` middleware happily trusts it. Different secrets make
//   the two token families cryptographically non-interchangeable.
// HOW IT WORKS HERE: two distinct env vars, and in non-production we allow
//   dev defaults so the project runs out of the box; in production the
//   `required()` call throws if they are absent.
// ============================================================
const devAccessSecret = 'dev-only-access-secret-do-not-use-in-production';
const devRefreshSecret = 'dev-only-refresh-secret-do-not-use-in-production';

const config = {
  env: NODE_ENV,
  isTest,
  isProd,
  isDev: NODE_ENV === 'development',

  port: toInt(optional('PORT', '5000'), 5000),

  mongoUri: isTest
    ? optional('MONGO_URI_TEST', 'mongodb://127.0.0.1:27017/mern_interview_boilerplate_test')
    : optional('MONGO_URI', 'mongodb://127.0.0.1:27017/mern_interview_boilerplate'),

  jwt: {
    accessSecret: isProd ? required('JWT_ACCESS_SECRET') : optional('JWT_ACCESS_SECRET', devAccessSecret),
    refreshSecret: isProd ? required('JWT_REFRESH_SECRET') : optional('JWT_REFRESH_SECRET', devRefreshSecret),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
    // Used to set the httpOnly cookie maxAge. Keep in sync with refreshExpiresIn.
    refreshExpiresMs: 7 * 24 * 60 * 60 * 1000,
  },

  redis: {
    url: optional('REDIS_URL', 'redis://127.0.0.1:6379'),
    ttlSeconds: toInt(optional('CACHE_TTL_SECONDS', '60'), 60),
  },

  // ============================================================
  // 🧠 CONCEPT: CORS allowlist, not wildcard
  // WHY IT MATTERS (interview angle): `origin: '*'` combined with
  //   `credentials: true` is silently rejected by browsers. Also, a wildcard
  //   means any site can read your JSON responses using the visitor's
  //   browser (though not their cookies, unless credentials are allowed).
  // HOW IT WORKS HERE: a comma-separated allowlist parsed into an array,
  //   consumed by the cors() middleware in app.js.
  // ============================================================
  clientOrigins: optional('CLIENT_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  security: {
    // ============================================================
    // 🧠 CONCEPT: bcrypt salt rounds trade-off
    // WHY IT MATTERS (interview angle): salt rounds are a *cost factor*, and
    //   it is exponential — rounds=12 is ~4x slower than rounds=10. Higher
    //   = slower for an offline attacker brute-forcing a leaked dump, but
    //   also slower for your own login endpoint, and bcrypt is CPU-bound so
    //   it blocks a worker. 10–12 is the usual production answer. In tests
    //   we drop to 4 so the suite is not dominated by hashing time.
    // HOW IT WORKS HERE: configurable, defaulted to 10, forced low in tests.
    // ============================================================
    bcryptSaltRounds: isTest ? 4 : toInt(optional('BCRYPT_SALT_ROUNDS', '10'), 10),
    rateLimitWindowMs: toInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 900000),
    rateLimitMax: toInt(optional('RATE_LIMIT_MAX', '100'), 100),
    loginRateLimitMax: toInt(optional('LOGIN_RATE_LIMIT_MAX', '5'), 5),
  },

  features: {
    socketIo: toBool(optional('ENABLE_SOCKET_IO', 'true'), true) && !isTest,
    cronJobs: toBool(optional('ENABLE_CRON_JOBS', 'false'), false) && !isTest,
  },

  logLevel: optional('LOG_LEVEL', isTest ? 'error' : 'debug'),
};

// ============================================================
// 🧠 CONCEPT: Fail fast on insecure production config
// WHY IT MATTERS (interview angle): shipping dev defaults to production is
//   one of the most common real incidents. A boot-time guard costs nothing.
// HOW IT WORKS HERE: if we are in production and the secrets still look like
//   the dev placeholders, we refuse to start.
// ============================================================
if (isProd) {
  const weak = [config.jwt.accessSecret, config.jwt.refreshSecret].some(
    (s) => s.startsWith('dev-only-') || s.startsWith('replace_me') || s.length < 32
  );
  if (weak) {
    throw new Error('[config] Refusing to boot in production with weak/default JWT secrets.');
  }
}

module.exports = config;
