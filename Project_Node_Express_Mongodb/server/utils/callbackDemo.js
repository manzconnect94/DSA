// ============================================================
// 🧠 CONCEPT: The error-first callback pattern (and why we moved past it)
// WHY IT MATTERS (interview angle): every Node API written before ~2015 uses
//   it, so you WILL meet it in legacy code, and interviewers use it to check
//   you understand what async/await is actually sugar over.
//
//   THE CONVENTION: the callback's FIRST parameter is always the error.
//       fn(args..., (err, result) => { if (err) { ... } ... })
//   It is first so it is impossible to ignore by accident, and it is `null`
//   (not undefined, not false) on success. This is a convention, not a
//   language rule — nothing stops a library from getting it wrong, which is
//   itself part of the problem.
//
//   Run this file:  node utils/callbackDemo.js
//
// HOW IT WORKS HERE: the rest of this codebase is 100% async/await. This one
//   file keeps the callback style alive side by side so the contrast is
//   concrete rather than theoretical.
// ============================================================

/* eslint-disable no-console */

const fs = require('fs');
const util = require('util');

console.log('='.repeat(64));
console.log('CALLBACK vs PROMISE vs ASYNC/AWAIT — node utils/callbackDemo.js');
console.log('='.repeat(64));

// ------------------------------------------------------------------
// 1. A hand-written error-first callback function
// ------------------------------------------------------------------
/**
 * Fake "fetch a user from the DB" in classic callback style.
 * Note the signature: the callback is the LAST argument, and the error is
 * its FIRST parameter.
 */
function findUserCallback(id, callback) {
  // setTimeout stands in for real I/O.
  setTimeout(() => {
    if (!id) {
      // ============================================================
      // 🧠 CONCEPT: NEVER throw inside an async callback
      // WHY IT MATTERS (interview angle): a `throw` here would NOT be caught
      //   by a try/catch wrapped around findUserCallback(). By the time this
      //   setTimeout fires, the original call stack is long gone — we are in
      //   a fresh tick of the event loop. The throw becomes an uncaught
      //   exception and crashes the process. THIS IS THE SINGLE BIGGEST
      //   FOOTGUN of callback code, and it is exactly what promises fixed:
      //   a throw inside a promise chain becomes a rejection you can catch.
      // HOW IT WORKS HERE: we pass the error to the callback instead.
      // ============================================================
      return callback(new Error('id is required'));
    }
    return callback(null, { id, name: `User ${id}` }); // err is null on success
  }, 30);
}

function findTasksCallback(userId, callback) {
  setTimeout(() => {
    if (!userId) return callback(new Error('userId is required'));
    return callback(null, [
      { id: 't1', title: 'Write tests', ownerId: userId },
      { id: 't2', title: 'Review PR', ownerId: userId },
    ]);
  }, 30);
}

// ------------------------------------------------------------------
// 2. CALLBACK HELL — the reason async/await exists
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: "Callback hell" / the pyramid of doom
// WHY IT MATTERS (interview angle): name the four concrete problems, not
//   just "it's ugly":
//   1. NESTING — each dependent step indents one level further; five steps
//      and the code marches off the right edge of the screen.
//   2. ERROR HANDLING IS MANUAL AND REPEATED — `if (err) return cb(err)` in
//      every single callback. Miss one and the error vanishes silently.
//   3. NO COMPOSITION — you cannot easily run two of these in parallel and
//      wait for both; you hand-roll a counter, which is where off-by-one
//      bugs live.
//   4. INVERSION OF CONTROL — you hand your callback to someone else's code
//      and TRUST them to call it exactly once. A buggy library that calls it
//      twice, or never, corrupts your logic and there is nothing you can do.
//      Promises fix this structurally: a promise can only settle ONCE.
// ============================================================
function callbackHell() {
  console.log('\n--- 1. Callback style (watch the indentation grow) ---');
  findUserCallback('u1', (err, user) => {
    if (err) return console.error('   error:', err.message); // repetition #1
    findTasksCallback(user.id, (err2, tasks) => {
      if (err2) return console.error('   error:', err2.message); // repetition #2
      // Imagine three more dependent calls here. This is the pyramid.
      console.log(`   ${user.name} has ${tasks.length} tasks:`, tasks.map((t) => t.title).join(', '));
      return promiseStyle();
    });
  });
}

// ------------------------------------------------------------------
// 3. PROMISIFY — turning a callback API into a promise API
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: util.promisify
// WHY IT MATTERS (interview angle): a great practical answer to "how do you
//   modernise legacy callback code?" util.promisify wraps any function that
//   follows the error-first convention EXACTLY (callback last, error first)
//   and returns a promise-returning version. If a library deviates from the
//   convention, promisify breaks and you must wrap it by hand with
//   `new Promise((resolve, reject) => ...)`.
//   Also worth knowing: Node ships promise variants natively now —
//   `require('fs').promises` / `require('fs/promises')` — so you rarely need
//   to promisify fs yourself.
// ============================================================
const findUserAsync = util.promisify(findUserCallback);
const findTasksAsync = util.promisify(findTasksCallback);

function promiseStyle() {
  console.log('\n--- 2. Promise chain (flat, single error handler) ---');
  let capturedUser;
  return findUserAsync('u2')
    .then((user) => {
      capturedUser = user;
      return findTasksAsync(user.id);
    })
    .then((tasks) => {
      console.log(`   ${capturedUser.name} has ${tasks.length} tasks`);
      // ⚠️ Note the awkward `capturedUser` variable: in a .then chain each
      // step only receives the PREVIOUS step's value, so carrying context
      // forward means an outer variable or nested .then (back to the
      // pyramid). async/await has no such problem — both are just locals.
    })
    .catch((err) => {
      // ONE catch for the whole chain. This is improvement #1 over callbacks.
      console.error('   error:', err.message);
    })
    .then(asyncAwaitStyle);
}

// ------------------------------------------------------------------
// 4. ASYNC / AWAIT — what the rest of this codebase uses
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: async/await is syntax over promises
// WHY IT MATTERS (interview angle): be precise about what it does and does
//   not change:
//   • An `async` function ALWAYS returns a promise, even if you return 5.
//   • `await` pauses the function and resumes it via the MICROTASK queue.
//     It does not block the thread — other requests run meanwhile.
//   • try/catch now works on async errors, because a rejection is thrown
//     back into the function. This is the big ergonomic win.
//   • It does NOT make anything parallel. Sequential awaits are sequential.
// ============================================================
async function asyncAwaitStyle() {
  console.log('\n--- 3. async/await (reads like sync code, real try/catch) ---');
  try {
    const user = await findUserAsync('u3');
    const tasks = await findTasksAsync(user.id); // both are plain locals — no juggling
    console.log(`   ${user.name} has ${tasks.length} tasks`);
  } catch (err) {
    // Catches rejections from EITHER await. One block, like sync code.
    console.error('   error:', err.message);
  }
  await parallelDemo();
}

// ------------------------------------------------------------------
// 5. Sequential vs parallel — the awaiting-in-a-loop mistake
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Promise.all — do not await independent work sequentially
// WHY IT MATTERS (interview angle): a very common real-world performance bug.
//
//     const user  = await getUser();     // 30ms
//     const tasks = await getTasks();    // 30ms   -> total 60ms
//
//   These two calls do not depend on each other, so waiting for the first
//   before starting the second wastes 30ms. Promise.all starts both
//   immediately and waits for the slower one -> ~30ms total. At scale (a
//   loop over 100 items) this is the difference between 3 seconds and 30ms.
//
//   Know the four combinators and when each applies:
//   • Promise.all         — all must succeed; rejects FAST on the first
//                           failure (the others keep running, their results
//                           are simply discarded). Use when you need everything.
//   • Promise.allSettled  — never rejects; returns {status,value|reason} for
//                           each. Use for independent best-effort work, e.g.
//                           a dashboard where one failed widget shouldn't
//                           blank the page.
//   • Promise.race        — settles with the first to settle, success OR
//                           failure. The classic timeout pattern.
//   • Promise.any         — first SUCCESS; rejects only if all fail.
//
//   ⚠️ Unbounded Promise.all over a big array is its own trap: `await
//   Promise.all(tenThousandIds.map(fetchOne))` opens 10,000 simultaneous
//   connections and will exhaust the DB pool or get you rate-limited. Use a
//   concurrency limiter (p-limit) or batch it.
//
// HOW IT WORKS HERE: timed side-by-side comparison. This same pattern is
//   used for real in controllers/taskController.js (getDashboard).
// ============================================================
async function parallelDemo() {
  console.log('\n--- 4. Sequential vs parallel ---');

  const t1 = Date.now();
  await findUserAsync('u4');
  await findTasksAsync('u4');
  console.log(`   SEQUENTIAL (await, await): ~${Date.now() - t1}ms  <- 30 + 30`);

  const t2 = Date.now();
  // Both promises are created BEFORE either is awaited — that is the whole
  // trick. Promise.all doesn't start them; calling the functions does.
  const [user, tasks] = await Promise.all([findUserAsync('u4'), findTasksAsync('u4')]);
  console.log(`   PARALLEL  (Promise.all) : ~${Date.now() - t2}ms  <- max(30, 30)`);
  console.log(`   got ${user.name} + ${tasks.length} tasks either way`);

  // allSettled: one failure does not sink the batch.
  const results = await Promise.allSettled([findUserAsync('u5'), findUserAsync(null)]);
  console.log(
    '   allSettled statuses:',
    results.map((r) => r.status).join(', '),
    '<- the rejection is reported, not thrown'
  );

  // race: the timeout pattern.
  const withTimeout = Promise.race([
    findUserAsync('u6'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5)),
  ]);
  try {
    await withTimeout;
    console.log('   race: the query won');
  } catch (err) {
    console.log(`   race: ${err.message} won (the query kept running — race does NOT cancel it)`);
  }

  await nodeStyleFsComparison();
}

// ------------------------------------------------------------------
// 6. The same fs read, three ways
// ------------------------------------------------------------------
async function nodeStyleFsComparison() {
  console.log('\n--- 5. Reading a file three ways ---');

  // (a) callback — the original API
  fs.readFile(__filename, 'utf8', (err, data) => {
    if (err) return console.error('   (a) callback error:', err.message);
    console.log(`   (a) callback : ${data.length} chars`);

    // (b) sync — ⚠️ BLOCKS THE EVENT LOOP.
    // ============================================================
    // 🧠 CONCEPT: Why *Sync methods are banned in request handlers
    // WHY IT MATTERS (interview angle): readFileSync halts the single thread
    //   until the disk responds. Every other in-flight request waits. It is
    //   acceptable ONLY at boot time (loading a config file or a TLS cert
    //   before the server starts listening), never per-request.
    // ============================================================
    const syncData = fs.readFileSync(__filename, 'utf8');
    console.log(`   (b) sync     : ${syncData.length} chars  ⚠️ blocked the loop to get this`);

    // (c) promise API — what modern code uses
    fs.promises.readFile(__filename, 'utf8').then((p) => {
      console.log(`   (c) promises : ${p.length} chars  ✅ non-blocking + awaitable`);
      console.log('\n' + '='.repeat(64));
      console.log('Takeaway: async/await gives you callbacks\' non-blocking behaviour');
      console.log('with sync code\'s readability and error handling.');
      console.log('='.repeat(64));
    });
    return undefined;
  });
}

// Kick off the chain.
callbackHell();
