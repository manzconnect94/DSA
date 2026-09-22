// ============================================================
// 🧠 CONCEPT: MongoDB connection + connection pooling
// WHY IT MATTERS (interview angle): "Does Mongoose open a new connection
//   per query?" — No. The driver keeps a *pool* of TCP sockets and hands one
//   to each operation, returning it when done. Opening a TCP connection +
//   TLS handshake + auth per query would dominate latency. Default
//   maxPoolSize is 100 (it was 5 in very old driver versions — a classic
//   trick question).
// HOW IT WORKS HERE: we connect once at boot and reuse `mongoose.connection`
//   everywhere. Pool size is set explicitly so the number is visible.
// ============================================================

const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

// ============================================================
// 🧠 CONCEPT: Tuning the pool — bigger is not better
// WHY IT MATTERS (interview angle): the pool is a concurrency limit on your
//   database, not a performance dial. Each pooled socket consumes memory and
//   a connection slot on the Mongo server. If you run 8 Node processes
//   (see cluster.js) with maxPoolSize=100, that is 800 potential connections
//   from ONE machine — enough to exhaust a small Atlas tier. Tune it to
//   roughly: expected concurrent in-flight queries per process.
//   minPoolSize keeps warm sockets so the first request after an idle period
//   doesn't pay the handshake cost.
// HOW IT WORKS HERE: modest pool of 10 (dev-friendly), 2 kept warm.
// ============================================================
const MONGOOSE_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 2,
  // Fail fast rather than hanging forever if Mongo is down.
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

// ============================================================
// 🧠 CONCEPT: Strict query mode
// WHY IT MATTERS (interview angle): Mongoose 7+ defaults `strictQuery` to
//   false, meaning a filter on a field that is NOT in the schema is passed
//   straight to MongoDB instead of being stripped. That is usually what you
//   want (it lets you query fields added outside the schema) but it is worth
//   knowing, because a typo'd filter key then silently matches nothing
//   instead of being ignored.
// HOW IT WORKS HERE: set explicitly so the behaviour is not a surprise.
// ============================================================
mongoose.set('strictQuery', true);

// In development, log every Mongoose operation. Extremely useful for
// spotting the N+1 query problem: you literally watch 101 queries scroll by.
if (config.isDev) {
  mongoose.set('debug', (collection, method, query) => {
    logger.debug(`[mongoose] ${collection}.${method}`, JSON.stringify(query));
  });
}

let connectionPromise = null;

/**
 * Connect to MongoDB. Idempotent: calling it twice reuses the same promise,
 * which matters because tests and server.js may both call it.
 */
async function connectDB(uri = config.mongoUri) {
  if (connectionPromise) return connectionPromise;

  // ============================================================
  // 🧠 CONCEPT: Connection lifecycle events
  // WHY IT MATTERS (interview angle): "What happens if the DB goes away at
  //   runtime?" The driver buffers commands and retries reconnection. If you
  //   never listen for 'error'/'disconnected', you get silent 10-second
  //   hangs instead of actionable logs.
  // HOW IT WORKS HERE: we attach listeners BEFORE connecting so we don't miss
  //   the very first failure event.
  // ============================================================
  mongoose.connection.on('connected', () => logger.info('[mongo] connected'));
  mongoose.connection.on('error', (err) => logger.error('[mongo] error', err.message));
  mongoose.connection.on('disconnected', () => logger.warn('[mongo] disconnected'));

  connectionPromise = mongoose
    .connect(uri, MONGOOSE_OPTIONS)
    .then((m) => {
      logger.info(`[mongo] ready at ${m.connection.host}/${m.connection.name}`);
      return m;
    })
    .catch((err) => {
      // Reset so a later retry can attempt a fresh connection.
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}

async function disconnectDB() {
  connectionPromise = null;
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB, mongoose };
