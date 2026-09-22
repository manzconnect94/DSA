// ============================================================
// 🧠 CONCEPT: Structured logging (a hand-rolled Winston substitute)
// WHY IT MATTERS (interview angle): "Why not just console.log?" Because
//   (1) you cannot filter by level in production, (2) console.log is
//   synchronous when writing to a file or pipe on some platforms, which
//   BLOCKS the event loop, and (3) log aggregators (Datadog, ELK, CloudWatch)
//   want machine-parsable JSON, not free-form strings.
// HOW IT WORKS HERE: a ~60-line level-filtered logger with the same shape as
//   Winston (error/warn/info/debug). Zero dependencies so the concept is
//   readable rather than hidden behind a library. Swap in Winston or Pino by
//   replacing this one file — that decoupling is itself the point.
// ============================================================

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// Read LOG_LEVEL directly (not via config/env.js) to avoid a circular
// require: env.js requires logger, logger must not require env.js.
const currentLevelName = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'debug')).toLowerCase();
const currentLevel = LEVELS[currentLevelName] ?? LEVELS.debug;

const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m',
};

const useJson = process.env.NODE_ENV === 'production';

function emit(level, args) {
  if (LEVELS[level] > currentLevel) return;

  const timestamp = new Date().toISOString();
  const message = args
    .map((a) => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');

  if (useJson) {
    // ============================================================
    // 🧠 CONCEPT: JSON logs in production
    // WHY IT MATTERS (interview angle): a log line is only useful if you can
    //   query it. `{"level":"error","reqId":"abc"}` can be indexed and
    //   filtered; `ERROR something broke` cannot.
    // HOW IT WORKS HERE: one JSON object per line ("ndjson"), which every
    //   log shipper understands out of the box.
    // ============================================================
    process.stdout.write(`${JSON.stringify({ timestamp, level, message })}\n`);
    return;
  }

  const color = COLORS[level] || '';
  // eslint-disable-next-line no-console
  console.log(`${color}[${timestamp}] ${level.toUpperCase().padEnd(5)}${COLORS.reset} ${message}`);
}

const logger = {
  error: (...args) => emit('error', args),
  warn: (...args) => emit('warn', args),
  info: (...args) => emit('info', args),
  debug: (...args) => emit('debug', args),
  level: currentLevelName,
};

module.exports = logger;
