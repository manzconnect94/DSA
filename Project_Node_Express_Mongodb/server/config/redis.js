// ============================================================
// 🧠 CONCEPT: Redis cache client with an in-memory fallback
// WHY IT MATTERS (interview angle): caching is the single most-asked
//   "how would you make this faster?" answer. Be ready for the follow-up:
//   "why Redis and not just a JS Map?" — because a Map lives inside ONE Node
//   process. Run 4 processes behind a load balancer (see cluster.js) and you
//   get 4 divergent caches, 4x the memory, and an invalidation on one
//   process that leaves the other 3 serving stale data. Redis is a single
//   shared store outside the process, so it survives restarts and deploys.
// HOW IT WORKS HERE: we try to connect to Redis. If it is unreachable we
//   degrade to an in-memory Map so the project runs with zero setup — but
//   that fallback is a DEV CONVENIENCE and a PRODUCTION ANTI-PATTERN, for
//   exactly the reasons above. The log line says so loudly.
// ============================================================

const Redis = require('ioredis');
const config = require('./env');
const logger = require('../utils/logger');

let client = null;
let usingFallback = false;

// ------------------------------------------------------------
// In-memory fallback. Deliberately implements the same tiny surface
// (get / set / del / delByPrefix) that our cache utility needs.
// ------------------------------------------------------------
const memoryStore = new Map(); // key -> { value: string, expiresAt: number }

const memoryClient = {
  async get(key) {
    const entry = memoryStore.get(key);
    if (!entry) return null;
    // Lazy expiry: we only evict when the key is read. Redis does both lazy
    // and active expiry; a Map does neither, which is another reason this is
    // not production-grade (cold keys leak memory forever).
    if (entry.expiresAt < Date.now()) {
      memoryStore.delete(key);
      return null;
    }
    return entry.value;
  },
  async set(key, value, _mode, ttlSeconds) {
    memoryStore.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds || config.redis.ttlSeconds) * 1000,
    });
    return 'OK';
  },
  async del(...keys) {
    let n = 0;
    for (const k of keys.flat()) if (memoryStore.delete(k)) n += 1;
    return n;
  },
  async keys(pattern) {
    // Only supports the trailing-* pattern we actually use.
    const prefix = pattern.replace(/\*$/, '');
    return [...memoryStore.keys()].filter((k) => k.startsWith(prefix));
  },
  async flushall() {
    memoryStore.clear();
    return 'OK';
  },
  async quit() {
    memoryStore.clear();
    return 'OK';
  },
  status: 'memory-fallback',
};

function getRedisClient() {
  if (client) return client;

  if (config.isTest) {
    // Tests must never depend on an external service being up.
    usingFallback = true;
    client = memoryClient;
    return client;
  }

  try {
    const real = new Redis(config.redis.url, {
      // ============================================================
      // 🧠 CONCEPT: Fail-open caching
      // WHY IT MATTERS (interview angle): a cache is an optimisation, not a
      //   source of truth. If Redis dies, the correct behaviour is to serve
      //   every request from the database (slower but correct), NOT to
      //   return 500s. Interviewers like hearing "the cache must fail open".
      // HOW IT WORKS HERE: limited retries, then we swap in the memory
      //   client instead of letting connection errors bubble into requests.
      // ============================================================
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
      lazyConnect: false,
    });

    real.on('ready', () => logger.info('[redis] connected'));
    real.on('error', (err) => {
      if (!usingFallback) {
        usingFallback = true;
        logger.warn(
          `[redis] unavailable (${err.message}) — FALLING BACK TO IN-MEMORY CACHE. ` +
            'This is fine for local study, NOT for production: per-process caches ' +
            'diverge across instances and invalidation only affects one process.'
        );
        try {
          real.disconnect();
        } catch (_) {
          /* already down */
        }
        client = memoryClient;
      }
    });

    client = real;
  } catch (err) {
    usingFallback = true;
    logger.warn(`[redis] init failed (${err.message}) — using in-memory cache`);
    client = memoryClient;
  }

  return client;
}

function isUsingFallback() {
  return usingFallback;
}

async function closeRedis() {
  if (client && typeof client.quit === 'function') {
    try {
      await client.quit();
    } catch (_) {
      /* noop */
    }
  }
  client = null;
}

module.exports = { getRedisClient, isUsingFallback, closeRedis };
