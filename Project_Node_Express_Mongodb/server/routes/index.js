// ============================================================
// 🧠 CONCEPT: A single router barrel / API versioning seam
// WHY IT MATTERS (interview angle): mounting every router in one place
//   keeps app.js readable and gives you ONE place to introduce versioning.
//   The follow-up question is usually "how do you version an API?":
//   • URL PATH (/api/v1/tasks) — most common, unambiguous, easy to route
//     and cache. Purists object that the URL should identify a resource,
//     not a representation.
//   • HEADER (Accept: application/vnd.app.v2+json) — "cleaner" REST, but
//     harder to test by hand and CDN caching needs Vary configured.
//   • QUERY PARAM (?version=2) — simplest, but easy to forget and messy to
//     cache.
//   The practical answer: path versioning, and only version when you make a
//   BREAKING change. Adding a field is not breaking; removing or renaming
//   one is.
// HOW IT WORKS HERE: one mount point per resource, ready to nest under
//   /v1 when needed.
// ============================================================

const express = require('express');
const mongoose = require('mongoose');

const authRoutes = require('./authRoutes');
const taskRoutes = require('./taskRoutes');
const demoRoutes = require('./demoRoutes');
const adminRoutes = require('./adminRoutes');
const cache = require('../utils/cache');
const { isUsingFallback } = require('../config/redis');

const router = express.Router();

// ============================================================
// 🧠 CONCEPT: Health checks — liveness vs readiness
// WHY IT MATTERS (interview angle): Kubernetes and most load balancers
//   distinguish two probes, and conflating them causes real outages:
//   • LIVENESS  — "is the process alive?" If this fails, the orchestrator
//     KILLS AND RESTARTS the container. It must be trivial and must NOT
//     check dependencies. If your liveness probe pings the database and the
//     database blips, every pod gets restarted simultaneously — you have
//     converted a brief DB hiccup into a full outage.
//   • READINESS — "can this instance serve traffic RIGHT NOW?" If this
//     fails, the load balancer stops routing to it but leaves it running.
//     THIS is where you check the DB, the cache, and any critical
//     dependency. The pod gets a chance to recover and rejoin.
// HOW IT WORKS HERE: /health is liveness (always 200 if the process runs),
//   /health/ready is readiness (503 if MongoDB is not connected).
// ============================================================
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid, // differs per worker under cluster.js — useful to see load spreading
    memory: {
      rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
      // Buffers live here, not in the heap — see utils/bufferDemo.js.
      externalMb: Number((process.memoryUsage().external / 1024 / 1024).toFixed(1)),
    },
  });
});

router.get('/health/ready', (_req, res) => {
  // 1 = connected. 0 = disconnected, 2 = connecting, 3 = disconnecting.
  const dbReady = mongoose.connection.readyState === 1;

  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? 'ready' : 'not-ready',
    dependencies: {
      mongodb: dbReady ? 'connected' : 'disconnected',
      // The cache is NOT a readiness blocker: it fails open, so the app is
      // still correct (just slower) without it. Only hard dependencies
      // belong in a readiness check.
      cache: isUsingFallback() ? 'in-memory-fallback' : 'redis',
    },
    cacheStats: cache.getStats(),
  });
});

router.use('/auth', authRoutes);
router.use('/tasks', taskRoutes);
router.use('/demo', demoRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
