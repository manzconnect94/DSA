// ============================================================
// 🧠 CONCEPT: Jest configuration for a Node backend
// WHY IT MATTERS (interview angle): a couple of these options exist to fix
//   real, commonly-hit problems — worth knowing why each is here.
// ============================================================

module.exports = {
  testEnvironment: 'node', // not 'jsdom' — there is no DOM on the server

  // Run setup before each test FILE (connects the in-memory MongoDB).
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // ============================================================
  // 🧠 CONCEPT: testTimeout
  // WHY IT MATTERS (interview angle): Jest's 5-second default is too short
  //   for the first test in a suite that must DOWNLOAD and start
  //   mongodb-memory-server. A mysterious "Exceeded timeout of 5000 ms"
  //   on a fresh CI machine is almost always this.
  // ============================================================
  testTimeout: 30_000,

  // ============================================================
  // 🧠 CONCEPT: --runInBand and test isolation
  // WHY IT MATTERS (interview angle): Jest parallelises test FILES across
  //   worker processes by default. That is great for speed and terrible for
  //   integration tests sharing one database — two files truncating
  //   collections simultaneously produce flaky, order-dependent failures.
  //   Options: run serially (--runInBand, what our npm script does), or
  //   give each worker its OWN database (name it with process.env.JEST_WORKER_ID).
  //   The second scales better; the first is simpler and is plenty here.
  // ============================================================
  maxWorkers: 1,

  collectCoverageFrom: [
    'controllers/**/*.js',
    'middleware/**/*.js',
    'models/**/*.js',
    'utils/**/*.js',
    '!utils/*Demo.js', // the standalone demo scripts are docs, not app code
  ],

  // ============================================================
  // 🧠 CONCEPT: Coverage thresholds, and their limits
  // WHY IT MATTERS (interview angle): a threshold fails the build when
  //   coverage drops, which stops slow rot. But be ready for the pushback:
  //   coverage measures which lines EXECUTED, not whether you ASSERTED
  //   anything meaningful. A test that calls a function and asserts nothing
  //   gives 100% coverage and catches zero bugs. Use it as a floor and a
  //   trend, never as a goal.
  // ============================================================
  coverageThreshold: {
    global: { statements: 50, branches: 40, functions: 50, lines: 50 },
  },

  // Surface open handles that keep Jest alive after the tests finish —
  // usually an unclosed DB connection, server or timer.
  detectOpenHandles: true,
  verbose: true,
};
