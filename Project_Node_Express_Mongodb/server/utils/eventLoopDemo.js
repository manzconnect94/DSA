// ============================================================
// 🧠 CONCEPT: The Node.js event loop — phases and ordering
// WHY IT MATTERS (interview angle): "Explain the event loop" is asked in
//   virtually every Node interview, and the discriminating follow-up is
//   always the ordering puzzle: setTimeout vs setImmediate vs
//   process.nextTick. Run this file to SEE the answer:
//       node utils/eventLoopDemo.js
//
//   Node is single-threaded for YOUR JavaScript, but libuv underneath uses a
//   thread pool (default 4 threads, tunable via UV_THREADPOOL_SIZE) for
//   filesystem and some crypto/DNS work. The event loop is what lets one
//   thread juggle thousands of concurrent I/O operations: it never waits on
//   I/O, it registers a callback and moves on.
//
//   THE SIX PHASES, in the order the loop visits them each iteration:
//
//   ┌─────────────────────────────┐
//   │  1. TIMERS                  │  setTimeout / setInterval callbacks
//   ├─────────────────────────────┤     whose threshold has elapsed
//   │  2. PENDING CALLBACKS       │  deferred system-level callbacks
//   ├─────────────────────────────┤     (e.g. some TCP ECONNREFUSED errors)
//   │  3. IDLE / PREPARE          │  internal to libuv — ignore it
//   ├─────────────────────────────┤
//   │  4. POLL                    │  ⭐ the important one. Retrieves new I/O
//   │                             │     events and runs their callbacks.
//   │                             │     If nothing is pending, the loop
//   │                             │     BLOCKS HERE waiting for work —
//   │                             │     that is why an idle Node server
//   │                             │     uses ~0% CPU.
//   ├─────────────────────────────┤
//   │  5. CHECK                   │  setImmediate callbacks
//   ├─────────────────────────────┤
//   │  6. CLOSE CALLBACKS         │  socket.on('close'), etc.
//   └─────────────────────────────┘
//               ↓ loop back to 1
//
//   ⭐ THE MICROTASK QUEUES run BETWEEN every phase (and between each
//     individual callback), not as a phase of their own:
//       • process.nextTick queue  — drained FIRST, highest priority
//       • Promise microtask queue — drained immediately after
//     This is why an await resolves before a setTimeout(…, 0) that was
//     scheduled earlier.
//
// HOW IT WORKS HERE: five numbered experiments printing real output.
// ============================================================

/* eslint-disable no-console */

const fs = require('fs');

console.log('='.repeat(64));
console.log('EVENT LOOP DEMO — run with: node utils/eventLoopDemo.js');
console.log('='.repeat(64));

// ------------------------------------------------------------------
// EXPERIMENT 1 — ordering in the MAIN MODULE (the non-deterministic one)
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: setTimeout(0) vs setImmediate at the top level is
//             NON-DETERMINISTIC — and knowing WHY is the real test
// WHY IT MATTERS (interview angle): most candidates confidently say
//   "setImmediate always runs first". That is WRONG at the top level.
//   setTimeout(fn, 0) is clamped by Node to 1ms. When the loop starts, it
//   enters the TIMERS phase and asks "has 1ms elapsed?" If process startup
//   happened to take >= 1ms, yes -> the timer fires first. If startup was
//   faster than 1ms, no -> the loop moves on to CHECK and setImmediate
//   fires first, and the timer waits for the next iteration.
//   So the output flips between runs depending on machine load.
//   Run this file 5 times and you may well see both orderings.
// ============================================================
console.log('\n--- Experiment 1: top-level ordering (NON-deterministic) ---');
console.log('1. synchronous — runs immediately, before the loop even starts');

setTimeout(() => {
  console.log('4. setTimeout(0)   [TIMERS phase]  <- order vs #5 varies per run');
}, 0);

setImmediate(() => {
  console.log('5. setImmediate    [CHECK phase]   <- order vs #4 varies per run');
});

// ============================================================
// 🧠 CONCEPT: process.nextTick jumps the entire queue
// WHY IT MATTERS (interview angle): nextTick is NOT part of the event loop.
//   Its queue is drained after the current operation completes and BEFORE
//   the loop continues to the next phase — and before promise microtasks.
//   ⚠️ The danger: a recursive process.nextTick() STARVES the event loop
//   completely. The loop can never reach the poll phase, so I/O never
//   happens and your server stops responding while burning 100% CPU. A
//   recursive setImmediate() does NOT do this, because it yields to the
//   loop each iteration. "When would you use nextTick?" — almost never in
//   app code; it exists so libraries can guarantee a callback fires
//   asynchronously but before any I/O.
// ============================================================
process.nextTick(() => {
  console.log('2. process.nextTick  [microtask, HIGHEST priority — before promises]');
});

Promise.resolve().then(() => {
  console.log('3. Promise.then      [microtask, after the nextTick queue]');
});

// ------------------------------------------------------------------
// EXPERIMENT 2 — ordering INSIDE an I/O callback (the deterministic one)
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Inside an I/O callback, setImmediate ALWAYS beats setTimeout
// WHY IT MATTERS (interview angle): this is the deterministic half of the
//   puzzle, and being able to state both halves is what separates
//   "memorised a blog post" from "understands the loop".
//   Reason: an I/O callback runs in the POLL phase. The very next phase is
//   CHECK, where setImmediate lives — so it fires on this same iteration.
//   TIMERS is phase 1, already passed, so the timer must wait for the whole
//   loop to come around again. Guaranteed ordering, every time.
// HOW IT WORKS HERE: we schedule both from inside an fs.readFile callback.
// ============================================================
fs.readFile(__filename, () => {
  console.log('\n--- Experiment 2: inside an I/O callback (DETERMINISTIC) ---');
  setTimeout(() => console.log('   B. setTimeout(0)  — always SECOND here (next loop iteration)'), 0);
  setImmediate(() => console.log('   A. setImmediate   — always FIRST here (CHECK follows POLL)'));
});

// ------------------------------------------------------------------
// EXPERIMENT 3 — async/await is just promises, so it is a microtask
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: await resumes on the microtask queue
// WHY IT MATTERS (interview angle): "Does await block?" — It blocks the
//   *function*, never the *thread*. Everything after an await is effectively
//   a .then() callback, so it resumes via the microtask queue: before any
//   timer, before any I/O callback, after the nextTick queue.
// ============================================================
(async function experiment3() {
  console.log('\n--- Experiment 3: async/await is promise sugar ---');
  console.log('   i.   before await (synchronous — runs now)');
  await null; // awaiting a non-promise STILL yields to the microtask queue
  console.log('   iii. after await (microtask — runs after all sync code)');
})();
console.log('   ii.  this sync line runs BEFORE "after await", despite appearing later');

// ------------------------------------------------------------------
// EXPERIMENT 4 — blocking the loop (why you must not do CPU work inline)
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Blocking the event loop
// WHY IT MATTERS (interview angle): the #1 practical Node failure mode. One
//   synchronous CPU-heavy operation freezes EVERY concurrent request, because
//   they all share the single thread. A 2-second JSON.parse of a huge payload
//   is 2 seconds during which your server answers nobody — health checks
//   included, so the orchestrator may kill the pod.
//   Common culprits: big JSON.parse/stringify, synchronous fs methods
//   (readFileSync), bcrypt with high rounds, huge regexes (ReDoS), sorting
//   enormous arrays, crypto.pbkdf2Sync.
//   Fixes: worker threads (see workers/reportWorker.js), a child process,
//   chunking the work with setImmediate to yield between chunks, or moving
//   it out to a queue/service entirely.
// HOW IT WORKS HERE: a deliberate ~50ms busy-wait, timed and reported.
// ============================================================
setTimeout(() => {
  console.log('\n--- Experiment 4: blocking the loop ---');
  const start = Date.now();
  let x = 0;
  while (Date.now() - start < 50) {
    x += Math.sqrt(x + 1); // pure CPU, no I/O, nothing can interleave
  }
  console.log(`   Busy-waited ${Date.now() - start}ms. During this time the server`);
  console.log('   could not accept a single connection or run any callback.');
}, 10);

// ------------------------------------------------------------------
// EXPERIMENT 5 — the libuv thread pool is real, and it is only 4 wide
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: libuv thread pool (UV_THREADPOOL_SIZE)
// WHY IT MATTERS (interview angle): "Node is single-threaded" is a
//   half-truth worth correcting in an interview. Your JS runs on one thread,
//   but fs operations, dns.lookup, zlib and several crypto functions are
//   dispatched to a libuv thread pool of DEFAULT SIZE 4. Network I/O
//   (TCP/HTTP) does NOT use the pool — it uses the OS's epoll/kqueue/IOCP
//   directly, which is why Node scales to thousands of sockets.
//   The practical consequence: fire 5 concurrent crypto.pbkdf2 calls and the
//   5th waits for a free thread. Bump UV_THREADPOOL_SIZE (max 1024) if you
//   are genuinely fs/crypto-bound.
// HOW IT WORKS HERE: four parallel readFile calls; note they complete in
//   roughly the same wall-clock time, i.e. they really are parallel.
// ============================================================
setTimeout(() => {
  console.log('\n--- Experiment 5: libuv thread pool ---');
  console.log(`   UV_THREADPOOL_SIZE = ${process.env.UV_THREADPOOL_SIZE || '4 (default)'}`);
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < 4; i += 1) {
    fs.readFile(__filename, () => {
      done += 1;
      if (done === 4) {
        console.log(`   4 parallel fs reads finished in ${Date.now() - t0}ms (thread pool at work)`);
        console.log('\n' + '='.repeat(64));
        console.log('Done. Re-run a few times — Experiment 1 ordering may change.');
        console.log('='.repeat(64));
      }
    });
  }
}, 100);
