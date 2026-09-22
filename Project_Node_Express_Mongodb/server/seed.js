// ============================================================
// 🧠 CONCEPT: Seeding enough data to make performance REAL
// WHY IT MATTERS (interview angle): with 20 documents, a COLLSCAN and an
//   IXSCAN are both sub-millisecond and the slow/fast demo proves nothing.
//   You need 10,000+ documents before the index difference becomes
//   obvious, and 50,000+ before it is dramatic. This is itself a lesson:
//   PERFORMANCE BUGS DO NOT APPEAR IN DEV. They appear in production,
//   because production is where the data is. Seeding realistic volumes
//   locally is how you catch them first.
//
//   Usage:
//     node seed.js                              # 10,000 tasks, 20 users
//     node seed.js --tasks=50000 --users=200    # bigger
//     node seed.js --reset                      # wipe first
//
// HOW IT WORKS HERE: bulk inserts in batches, with the timing printed so
//   you can also see insertMany vs save() in action.
// ============================================================

/* eslint-disable no-console */

const mongoose = require('mongoose');
const config = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const RefreshToken = require('./models/RefreshToken');

// ---- tiny arg parser ----
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value === undefined ? true : value;
  return acc;
}, {});

const TASK_COUNT = Number(args.tasks) || 10_000;
const USER_COUNT = Number(args.users) || 20;
const BATCH_SIZE = 1000;

const STATUSES = ['todo', 'in-progress', 'done', 'archived'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TAG_POOL = ['backend', 'frontend', 'bug', 'feature', 'urgent', 'tech-debt', 'docs', 'testing', 'infra', 'design'];

// ============================================================
// 🧠 CONCEPT: legacyTag cardinality is what makes the demo work
// WHY IT MATTERS (interview angle): 'batch-import' is given to ~10% of
//   tasks. That is a realistic selectivity — selective enough that an index
//   WOULD help a lot, so its absence is a genuine, measurable loss. If it
//   were 90% of rows, an index would be useless anyway (low cardinality,
//   see the "when an index hurts" block in models/Task.js) and the demo
//   would teach the wrong lesson.
// ============================================================
const LEGACY_TAGS = ['none', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'batch-import', 'migrated-2019'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function randomTitle(i) {
  const verbs = ['Implement', 'Fix', 'Refactor', 'Review', 'Document', 'Deploy', 'Investigate', 'Optimise'];
  const nouns = ['login flow', 'cache layer', 'pagination', 'rate limiter', 'CSV export', 'index strategy', 'error handler', 'auth middleware'];
  return `${pick(verbs)} ${pick(nouns)} #${i}`;
}

// A long-ish description exists specifically so the "no projection" mistake
// has a real cost to demonstrate.
const FILLER = 'This description exists to make documents large enough that fetching them without a projection has a measurable cost. '.repeat(8);

async function seed() {
  console.log('='.repeat(62));
  console.log(`  SEEDING — ${USER_COUNT} users, ${TASK_COUNT.toLocaleString()} tasks`);
  console.log(`  target: ${config.mongoUri}`);
  console.log('='.repeat(62));

  await connectDB();

  if (args.reset) {
    console.log('\n[reset] dropping existing collections...');
    await Promise.all([User.deleteMany({}), Task.deleteMany({}), RefreshToken.deleteMany({})]);
  }

  // ---------------- USERS ----------------
  // ============================================================
  // 🧠 CONCEPT: Why users are created with .save(), not insertMany()
  // WHY IT MATTERS (interview angle): a direct, practical consequence of
  //   the hook rules in models/User.js. `insertMany()` does NOT fire
  //   document middleware, so the pre('save') password-hashing hook would
  //   be SKIPPED and every seeded password stored IN PLAINTEXT. For a seed
  //   script that is merely embarrassing; the identical mistake in a
  //   "bulk import users" admin feature is a breach.
  //   So: bulk methods for data with no hooks (tasks), .save() for data
  //   that depends on middleware (users).
  // ============================================================
  console.log('\n[users] creating (one .save() each, so the bcrypt hook runs)...');
  const usersStart = Date.now();

  const users = [];

  // A known admin and a known regular user, so you can actually log in.
  const admin = new User({
    name: 'Ada Admin',
    email: 'admin@example.com',
    password: 'Password123',
    role: 'admin',
  });
  await admin.save();
  users.push(admin);

  const demoUser = new User({
    name: 'Dev Demo',
    email: 'demo@example.com',
    password: 'Password123',
    role: 'user',
  });
  await demoUser.save();
  users.push(demoUser);

  for (let i = 0; i < USER_COUNT - 2; i += 1) {
    const u = new User({
      name: `Test User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      password: 'Password123',
      role: 'user',
    });
    await u.save();
    users.push(u);
  }
  console.log(`[users] ${users.length} created in ${Date.now() - usersStart}ms`);
  console.log('        login as  admin@example.com / Password123  (admin)');
  console.log('        login as  demo@example.com  / Password123  (user)');

  // ---------------- TASKS ----------------
  // ============================================================
  // 🧠 CONCEPT: insertMany + batching for bulk writes
  // WHY IT MATTERS (interview angle): inserting 50,000 documents one at a
  //   time is 50,000 network round-trips. insertMany sends them in a single
  //   command — routinely 50-100x faster.
  //   WHY BATCH AT ALL, then? Three reasons:
  //   1. A single MongoDB command cannot exceed 16MB (and the driver caps
  //      at 100,000 ops per batch anyway).
  //   2. Building one giant array holds every document in memory at once.
  //   3. `ordered: false` lets the server apply the batch in PARALLEL and
  //      continue past individual failures, rather than stopping at the
  //      first error. Much faster, but you must be willing to accept
  //      partial success.
  // ============================================================
  console.log(`\n[tasks] inserting ${TASK_COUNT.toLocaleString()} in batches of ${BATCH_SIZE}...`);
  const tasksStart = Date.now();

  // Weight most tasks toward the demo user so /api/demo/* has plenty to
  // chew on when you log in as demo@example.com.
  const ownerFor = () => (Math.random() < 0.6 ? demoUser._id : pick(users)._id);

  let inserted = 0;
  for (let batchStart = 0; batchStart < TASK_COUNT; batchStart += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, TASK_COUNT - batchStart);
    const batch = [];

    for (let i = 0; i < size; i += 1) {
      const n = batchStart + i;
      const createdAt = new Date(Date.now() - randInt(0, 365) * 24 * 60 * 60 * 1000);

      batch.push({
        title: randomTitle(n),
        description: FILLER,
        status: pick(STATUSES),
        priority: pick(PRIORITIES),
        owner: ownerFor(),
        dueDate: Math.random() < 0.7 ? new Date(Date.now() + randInt(-30, 90) * 24 * 60 * 60 * 1000) : null,
        tags: Array.from({ length: randInt(0, 3) }, () => pick(TAG_POOL)),
        legacyTag: pick(LEGACY_TAGS),
        estimatedHours: randInt(1, 40),
        createdAt,
        updatedAt: createdAt,
      });
    }

    await Task.insertMany(batch, { ordered: false });
    inserted += size;

    // \r overwrites the same terminal line instead of scrolling.
    process.stdout.write(`\r[tasks] ${inserted.toLocaleString()} / ${TASK_COUNT.toLocaleString()}`);
  }

  const tasksMs = Date.now() - tasksStart;
  console.log(`\n[tasks] done in ${(tasksMs / 1000).toFixed(1)}s (${Math.round(inserted / (tasksMs / 1000)).toLocaleString()} docs/sec)`);

  // ---------------- INDEXES ----------------
  // ============================================================
  // 🧠 CONCEPT: Build indexes AFTER a bulk load, not before
  // WHY IT MATTERS (interview angle): a real data-loading optimisation. If
  //   the indexes exist during the insert, every single document must also
  //   update every index — that is the write amplification discussed in
  //   models/Task.js, paid 50,000 times. Loading first and building
  //   indexes once at the end is significantly faster, because the index
  //   build is a single efficient sort rather than 50,000 B-tree inserts.
  //   (Mongoose's autoIndex will have created them at connect time here, so
  //   we just ensure and report.)
  // ============================================================
  console.log('\n[indexes] ensuring indexes...');
  const indexStart = Date.now();
  await Task.syncIndexes();
  await User.syncIndexes();
  console.log(`[indexes] built in ${Date.now() - indexStart}ms`);

  const indexes = await Task.collection.indexes();
  console.log('\n[indexes] on `tasks`:');
  for (const idx of indexes) {
    console.log(`   • ${idx.name.padEnd(28)} ${JSON.stringify(idx.key)}`);
  }
  console.log('   ⚠️  note: `legacyTag` is deliberately NOT indexed — that is what');
  console.log('       makes GET /api/demo/tasks-slow produce a real COLLSCAN.');

  // ---------------- QUICK SANITY CHECK ----------------
  const [taskTotal, demoTaskTotal, legacyCount] = await Promise.all([
    Task.estimatedDocumentCount(),
    Task.countDocuments({ owner: demoUser._id }),
    Task.countDocuments({ legacyTag: 'batch-import' }),
  ]);

  console.log('\n' + '='.repeat(62));
  console.log('  SEED COMPLETE');
  console.log('='.repeat(62));
  console.log(`  tasks total                 : ${taskTotal.toLocaleString()}`);
  console.log(`  tasks owned by demo@        : ${demoTaskTotal.toLocaleString()}`);
  console.log(`  tasks with legacyTag=batch-import : ${legacyCount.toLocaleString()} (the COLLSCAN target)`);
  console.log('');
  console.log('  Next:');
  console.log('    1. npm run dev');
  console.log('    2. POST /api/auth/login  { "email":"demo@example.com", "password":"Password123" }');
  console.log('    3. GET  /api/demo/compare   <- the headline slow-vs-fast number');
  console.log('    4. GET  /api/demo/explain   <- COLLSCAN vs IXSCAN, with real counts');
  console.log('    5. GET  /api/demo/populate  <- loop vs populate() vs $lookup');
  console.log('='.repeat(62));

  await disconnectDB();
}

seed()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\n[seed] FAILED:', err.message);
    console.error(err.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });
