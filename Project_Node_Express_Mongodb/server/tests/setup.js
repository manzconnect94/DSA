// ============================================================
// 🧠 CONCEPT: Test database strategy — mongodb-memory-server
// WHY IT MATTERS (interview angle): "how do you test database code?" has
//   three answers, and the trade-offs matter:
//
//   1. MOCK THE DATABASE ENTIRELY (jest.mock on the model)
//      ✅ Fast, no external dependency.
//      ❌ You are testing your mock, not MongoDB. It cannot catch a bad
//         query, a missing index, a failing validator, or a schema typo.
//         Your mock will happily accept a query that the real database
//         rejects. Use this for UNIT tests of logic AROUND the DB.
//
//   2. A REAL SHARED TEST DATABASE
//      ✅ Completely realistic.
//      ❌ Requires infrastructure in CI, tests interfere with each other,
//         and state leaks between runs. Slow and flaky.
//
//   3. ⭐ AN IN-MEMORY MONGODB (mongodb-memory-server) — what we use.
//      It downloads a REAL mongod binary and runs it against a RAM-backed
//      storage engine.
//      ✅ Genuine MongoDB semantics: real indexes, real validators, real
//         aggregation, real error codes (including 11000). It catches the
//         bugs a mock cannot.
//      ✅ Each test run is a fresh, isolated database. No cleanup leakage.
//      ✅ No external service needed in CI.
//      ❌ The first run downloads ~100MB, and startup costs a few seconds.
//
//   THE TESTING PYRAMID, since it usually follows: many fast UNIT tests
//   (pure functions), fewer INTEGRATION tests (route + DB, what most of
//   this suite is), very few E2E tests (slow, brittle, but they are the
//   only ones that prove the whole thing actually works).
//
// HOW IT WORKS HERE: one in-memory server per test file, wiped between
//   tests so no test can depend on another's leftovers.
// ============================================================

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

// ============================================================
// 🧠 CONCEPT: beforeAll / afterEach / afterAll
// WHY IT MATTERS (interview angle): the lifecycle hooks map to a cost
//   decision. Expensive setup (starting a database) goes in beforeAll so it
//   happens ONCE. Cheap isolation (clearing collections) goes in afterEach
//   so every test starts clean. Putting the DB startup in beforeEach would
//   make the suite unusably slow; putting the cleanup in afterAll would let
//   tests contaminate each other.
// ============================================================
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  await mongoose.connect(uri, { maxPoolSize: 5 });
});

afterEach(async () => {
  // ============================================================
  // 🧠 CONCEPT: Test isolation — clear state between tests
  // WHY IT MATTERS (interview angle): without this, tests pass in one order
  //   and fail in another, and a test that creates a user makes the next
  //   test's "no users exist" assertion fail. Order-dependent tests are the
  //   #1 source of flaky suites, and they are miserable to debug because
  //   running the failing test alone makes it pass.
  //   Note we delete DOCUMENTS rather than dropping collections — dropping
  //   would also destroy the indexes Mongoose built at connect time, and
  //   then a test asserting on a unique-constraint error would silently
  //   stop testing anything.
  // ============================================================
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  // ============================================================
  // 🧠 CONCEPT: Closing handles so Jest can exit
  // WHY IT MATTERS (interview angle): "Jest did not exit one second after
  //   the test run completed" means something is still holding the event
  //   loop open — an unclosed DB connection, a live HTTP server, or an
  //   un-unref'd setInterval. --forceExit papers over it; closing your
  //   handles properly is the fix. The same discipline is what makes
  //   graceful shutdown work in production.
  // ============================================================
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});
