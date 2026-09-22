// ============================================================
// 🧠 CONCEPT: Cache-aside (lazy loading) pattern
// WHY IT MATTERS (interview angle): the most common caching strategy, and
//   the one you should be able to draw on a whiteboard:
//
//     1. Request arrives.
//     2. Look in the cache.
//     3. HIT  -> return it. Done. No DB touched.
//     4. MISS -> query the DB, write the result into the cache with a TTL,
//               return it.
//
//   It is called "cache-aside" because the application manages the cache
//   *beside* the database; the cache has no idea the DB exists. Contrast:
//   • READ-THROUGH  — the cache itself loads from the DB on a miss. App code
//                     only ever talks to the cache.
//   • WRITE-THROUGH — writes go to cache AND DB synchronously. Cache is
//                     never stale, but every write pays both latencies.
//   • WRITE-BEHIND  — write to cache, flush to DB asynchronously. Fastest
//                     writes, but you can LOSE data if the cache dies first.
//
//   Cache-aside's weaknesses, worth naming unprompted:
//   • Every miss costs cache-lookup + DB-query (slightly slower than no cache).
//   • Data can be stale for up to the TTL — which is why we also invalidate
//     explicitly on writes (see invalidateTaskCache below).
//   • THUNDERING HERD / cache stampede: a popular key expires and 500
//     concurrent requests all miss and all hit the DB simultaneously. Fixes:
//     a short lock ("only one caller may repopulate"), or staggering TTLs
//     with jitter so keys don't all expire at the same instant.
//
// HOW IT WORKS HERE: getOrSet() implements cache-aside in one function, with
//   TTL jitter applied. Used by the task list endpoint (a read-heavy route)
//   and invalidated on every task create/update/delete.
// ============================================================

const { getRedisClient, isUsingFallback } = require('../config/redis');
const config = require('../config/env');
const logger = require('./logger');

// Simple counters so the /api/health endpoint can show a hit rate — a nice
// thing to be able to talk about ("how do you know your cache is working?").
const stats = { hits: 0, misses: 0, errors: 0 };

/**
 * Build a namespaced cache key.
 * Namespacing (`tasks:list:<userId>:<hash>`) matters because it lets you
 * invalidate a whole family of keys by prefix, and it prevents two features
 * from accidentally colliding on a key like "list".
 */
function buildKey(...parts) {
  return parts.filter((p) => p !== undefined && p !== null).join(':');
}

/**
 * Cache-aside read.
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {Function} loader - async () => data, called ONLY on a miss
 */
async function getOrSet(key, ttlSeconds, loader) {
  const redis = getRedisClient();

  try {
    const cached = await redis.get(key);
    if (cached !== null && cached !== undefined) {
      stats.hits += 1;
      logger.debug(`[cache] HIT  ${key}`);
      // Cached values are JSON strings. Note the cost: serialising and
      // parsing large objects is itself CPU work. For a huge payload the
      // JSON.parse can rival the DB query it replaced — measure, don't assume.
      return { data: JSON.parse(cached), cached: true };
    }
  } catch (err) {
    // ============================================================
    // 🧠 CONCEPT: Fail open on cache errors
    // WHY IT MATTERS (interview angle): a cache outage must degrade
    //   performance, never correctness. Swallowing the error and falling
    //   through to the DB is the right call.
    // ============================================================
    stats.errors += 1;
    logger.warn(`[cache] read error for ${key}: ${err.message} — falling through to DB`);
  }

  stats.misses += 1;
  logger.debug(`[cache] MISS ${key}`);

  const data = await loader();

  try {
    // ============================================================
    // 🧠 CONCEPT: TTL jitter (stampede mitigation)
    // WHY IT MATTERS (interview angle): if 1000 keys are all written at boot
    //   with an identical 60s TTL, they all expire in the same second and
    //   you get a synchronised flood of DB queries. Adding ±10% randomness
    //   spreads the expiries out.
    // HOW IT WORKS HERE: jittered TTL on every write.
    // ============================================================
    const jittered = Math.floor(ttlSeconds * (0.9 + Math.random() * 0.2));
    await redis.set(key, JSON.stringify(data), 'EX', jittered);
  } catch (err) {
    stats.errors += 1;
    logger.warn(`[cache] write error for ${key}: ${err.message}`);
  }

  return { data, cached: false };
}

/**
 * Delete keys by prefix.
 *
 * ⚠️ PRODUCTION NOTE: this uses KEYS, which is O(N) over the ENTIRE keyspace
 * and BLOCKS the Redis server (Redis is single-threaded) for the duration.
 * On a database with millions of keys, one KEYS call can stall every other
 * client for seconds. In production use SCAN (cursor-based, non-blocking) or
 * — better — maintain a Redis SET of the keys belonging to each namespace so
 * invalidation is a precise SREM + DEL instead of a scan.
 * KEYS is used here only because it makes the example readable.
 */
async function invalidateByPrefix(prefix) {
  const redis = getRedisClient();
  try {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) {
      await redis.del(...keys);
      logger.debug(`[cache] invalidated ${keys.length} key(s) under "${prefix}"`);
    }
    return keys.length;
  } catch (err) {
    stats.errors += 1;
    logger.warn(`[cache] invalidate error for ${prefix}: ${err.message}`);
    return 0;
  }
}

// ============================================================
// 🧠 CONCEPT: Write-time invalidation ("the two hard things")
// WHY IT MATTERS (interview angle): Phil Karlton's line — "There are only two
//   hard things in Computer Science: cache invalidation and naming things."
//   TTL alone is not enough: if a user creates a task and the list is cached
//   for 60 seconds, they refresh and DON'T SEE THEIR OWN TASK. That is a bug
//   report, not a performance win. So every mutation must proactively purge
//   the affected keys.
//   The follow-up: "invalidate or update?" — Deleting (invalidate) is safer
//   and simpler; the next read repopulates. Updating the cached value in
//   place ("write-through") is faster but easy to get subtly wrong when the
//   cached shape is a filtered/paginated projection rather than the raw doc.
//   We delete.
// HOW IT WORKS HERE: task controllers call invalidateTaskCache(userId) after
//   every create/update/delete, nuking that user's whole list namespace.
// ============================================================
async function invalidateTaskCache(userId) {
  return invalidateByPrefix(buildKey('tasks', 'list', String(userId)));
}

function getStats() {
  const total = stats.hits + stats.misses;
  return {
    ...stats,
    total,
    hitRate: total === 0 ? 0 : Number(((stats.hits / total) * 100).toFixed(2)),
    backend: isUsingFallback() ? 'in-memory-fallback' : 'redis',
    defaultTtlSeconds: config.redis.ttlSeconds,
  };
}

function resetStats() {
  stats.hits = 0;
  stats.misses = 0;
  stats.errors = 0;
}

module.exports = {
  buildKey,
  getOrSet,
  invalidateByPrefix,
  invalidateTaskCache,
  getStats,
  resetStats,
};
