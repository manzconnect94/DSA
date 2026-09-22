// ============================================================
// 🧠 CONCEPT: Separating app.js from server.js
// WHY IT MATTERS (interview angle): a small structural decision with a big
//   testing payoff. `app.js` builds and exports the Express app but never
//   calls `listen()`. `server.js` owns the process: it connects to the
//   database, binds the port, and handles shutdown.
//   WHY IT MATTERS FOR TESTS: Supertest can take the app object directly
//   (`request(app)`) and drive it WITHOUT opening a real TCP port. That
//   means tests run faster, in parallel, with no port conflicts in CI, and
//   with no leaked handles keeping Jest alive. If app and server were one
//   file, importing it in a test would start a real server.
// HOW IT WORKS HERE: tests import app.js; only this file calls listen().
// ============================================================

const http = require('http');
const app = require('./app');
const config = require('./config/env');
const { connectDB } = require('./config/db');
const { registerProcessHandlers } = require('./middleware/errorHandler');
const { getRedisClient } = require('./config/redis');
const logger = require('./utils/logger');
const { activityLogger, EVENTS } = require('./utils/activityLogger');

async function start() {
  // ============================================================
  // 🧠 CONCEPT: Connect to dependencies BEFORE binding the port
  // WHY IT MATTERS (interview angle): if you listen() first and then
  //   connect to Mongo, there is a window where the process accepts traffic
  //   it cannot serve — the load balancer sees an open port, marks the
  //   instance healthy, and routes real users to a server that will 500.
  //   Awaiting the DB first means the port only opens when the app can
  //   actually work. The mirror image is shutdown: stop listening FIRST,
  //   then close the DB.
  // ============================================================
  await connectDB();

  // Warm the cache client so a Redis outage is logged at boot, not on the
  // first user request.
  getRedisClient();

  // ============================================================
  // 🧠 CONCEPT: http.createServer(app) instead of app.listen()
  // WHY IT MATTERS (interview angle): `app.listen()` is just a shortcut
  //   that does exactly this internally. Creating the server explicitly
  //   gives you the http.Server instance, which you need in order to:
  //   attach Socket.io (it must share the same port and upgrade HTTP
  //   connections to WebSocket), tune keepAliveTimeout, or call
  //   server.close() for a graceful drain.
  // ============================================================
  const server = http.createServer(app);

  // ============================================================
  // 🧠 CONCEPT: keepAliveTimeout behind a load balancer
  // WHY IT MATTERS (interview angle): a genuinely obscure but real
  //   production bug worth knowing. If Node's keepAliveTimeout is SHORTER
  //   than the load balancer's, Node can close a connection at the exact
  //   moment the LB sends a request down it — the LB sees a reset and
  //   returns a sporadic 502 that is almost impossible to reproduce. AWS
  //   ALB defaults to 60s, so Node should be higher. headersTimeout must in
  //   turn exceed keepAliveTimeout.
  // ============================================================
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Process-level safety nets: uncaughtException, unhandledRejection,
  // SIGTERM, SIGINT. See middleware/errorHandler.js for why we exit rather
  // than "keep the server alive".
  registerProcessHandlers(server);

  // ---- Optional: Socket.io real-time layer ----
  if (config.features.socketIo) {
    attachSocketIo(server);
  }

  // ---- Optional: background cron jobs ----
  if (config.features.cronJobs) {
    require('./jobs/cleanupJob').start();
  }

  server.listen(config.port, () => {
    logger.info('');
    logger.info('='.repeat(62));
    logger.info(`  MERN Interview Boilerplate — server ready`);
    logger.info(`  http://localhost:${config.port}/api/health`);
    logger.info(`  env=${config.env}  pid=${process.pid}`);
    logger.info('='.repeat(62));
    logger.info('  Try these:');
    logger.info(`    GET  /api/health`);
    logger.info(`    POST /api/auth/register`);
    logger.info(`    GET  /api/demo/compare      (slow vs fast, needs auth)`);
    logger.info(`    GET  /api/demo/explain      (executionStats)`);
    logger.info(`    GET  /api/tasks/export      (streaming CSV)`);
    logger.info('='.repeat(62));
    logger.info('');
  });

  return server;
}

// ============================================================
// 🧠 CONCEPT: WebSockets vs polling (Socket.io)
// WHY IT MATTERS (interview angle): "how would you add real-time updates?"
//   is a common design question. The progression:
//
//   1. SHORT POLLING — the client asks "anything new?" every 5 seconds.
//      ❌ Wasteful: 99% of requests return nothing, yet each pays a full
//         HTTP round-trip with headers, and at 10,000 users that is 2,000
//         requests/second of pure noise.
//      ❌ Up to 5 seconds of latency.
//      ✅ Dead simple, works everywhere, no special infrastructure.
//
//   2. LONG POLLING — the server HOLDS the request open until it has
//      something to say, then the client immediately reconnects.
//      ✅ Near-real-time, works through every proxy.
//      ❌ Each waiting client occupies a connection. (Node handles this far
//         better than thread-per-request servers — a real talking point.)
//
//   3. SERVER-SENT EVENTS (SSE) — one long-lived HTTP response that the
//      server writes to over time.
//      ✅ Plain HTTP, auto-reconnect built in, simple.
//      ❌ ONE-WAY (server -> client) only.
//
//   4. WEBSOCKETS — a persistent, full-duplex TCP connection established
//      by upgrading an HTTP request.
//      ✅ Lowest latency, bidirectional, tiny per-message overhead (no
//         headers on each frame).
//      ❌ Stateful, which is the important trade-off: ⭐ A WEBSOCKET PINS
//         A USER TO ONE SERVER INSTANCE. That breaks the lovely stateless
//         property our JWT auth gave us. Scaling horizontally now needs
//         either sticky sessions or a pub/sub ADAPTER (socket.io-redis) so
//         an event emitted on instance A reaches a client connected to
//         instance B. This is THE scaling question about WebSockets.
//
//   CHOOSE: SSE for notifications/feeds (one-way). WebSockets for chat,
//   collaborative editing, games (two-way, low latency). Polling when
//   simplicity beats efficiency or you're behind hostile infrastructure.
// ============================================================
function attachSocketIo(server) {
  // Required lazily so a missing socket.io dependency cannot stop the
  // whole server from booting when the feature is disabled.
  const { Server } = require('socket.io');

  const io = new Server(server, {
    cors: { origin: config.clientOrigins, credentials: true },
    // Socket.io falls back to long polling automatically if the WebSocket
    // upgrade fails (corporate proxies often block it). That graceful
    // degradation is the main reason to use socket.io over raw `ws`.
    transports: ['websocket', 'polling'],
  });

  // ============================================================
  // 🧠 CONCEPT: Authenticating a WebSocket
  // WHY IT MATTERS (interview angle): a WebSocket handshake cannot carry a
  //   custom Authorization header from the browser API, so the standard
  //   pattern is to pass the token in the handshake `auth` payload and
  //   verify it in a connection middleware — BEFORE any event handler is
  //   wired up. Forgetting this is a common hole: people carefully protect
  //   their REST API and leave the socket layer wide open.
  //   ⚠️ Second gotcha: the token is verified ONCE at connect time. A
  //   connection opened at 10:00 is still open at 11:00 with a token that
  //   expired at 10:15. Long-lived sockets need periodic re-authentication.
  // ============================================================
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const { verifyAccessToken } = require('./utils/tokens');
      const payload = verifyAccessToken(token);
      socket.userId = payload.sub;
      return next();
    } catch (_err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`[socket] user ${socket.userId} connected (${socket.id})`);

    // ============================================================
    // 🧠 CONCEPT: Rooms
    // WHY IT MATTERS (interview angle): a room is a server-side channel
    //   label. Joining a per-user room means you can emit to that user on
    //   whichever socket(s) they have open, without tracking socket ids
    //   yourself — and it handles the multi-tab/multi-device case for free.
    // ============================================================
    socket.join(`user:${socket.userId}`);

    socket.on('disconnect', (reason) => {
      logger.debug(`[socket] ${socket.id} disconnected: ${reason}`);
    });
  });

  // ============================================================
  // 🧠 CONCEPT: Bridging the EventEmitter to the socket layer
  // WHY IT MATTERS (interview angle): a neat demonstration of why the
  //   EventEmitter decoupling was worth it. The task controller emits
  //   `taskCreated` and knows nothing about WebSockets. Here we subscribe
  //   and forward to the right room. Real-time was added without touching a
  //   single controller — that is the pub/sub payoff.
  //   ⚠️ SCALING NOTE: with multiple Node processes, this emitter is
  //   PER-PROCESS. A task created on worker 2 will not notify a client
  //   connected to worker 1. The fix is the Redis adapter
  //   (@socket.io/redis-adapter), which is the same "per-process state
  //   doesn't survive horizontal scaling" lesson as the cache and the rate
  //   limiter.
  // ============================================================
  for (const event of [EVENTS.TASK_CREATED, EVENTS.TASK_UPDATED, EVENTS.TASK_DELETED]) {
    activityLogger.on(event, (payload) => {
      if (payload.userId) {
        io.to(`user:${payload.userId}`).emit(event, payload);
      }
    });
  }

  logger.info('[socket] Socket.io attached');
  return io;
}

// Only auto-start when run directly, so `require('./server')` in a script
// or test does not spin up a listening server as a side effect.
if (require.main === module) {
  start().catch((err) => {
    logger.error('[boot] failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { start, app };
