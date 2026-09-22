// ============================================================
// 🧠 CONCEPT: A worker thread in practice
// WHY IT MATTERS (interview angle): this file runs in a SEPARATE V8 ISOLATE
//   with its OWN event loop. Things that follow from that, and which people
//   get wrong:
//   • NO SHARED VARIABLES with the main thread. `global` here is a
//     different object. You cannot read a module-level variable from the
//     parent.
//   • No access to the parent's `require` cache — modules are loaded fresh,
//     which is part of why startup costs ~10-30ms.
//   • Data crosses the boundary via the STRUCTURED CLONE algorithm, which
//     COPIES it. A huge object is expensive to pass (that copy is itself
//     CPU work on the main thread). For large binary payloads use
//     SharedArrayBuffer (genuinely shared, zero copy) or transfer an
//     ArrayBuffer's ownership.
//   • Structured clone cannot carry functions, class instances (they arrive
//     as plain objects), or Mongoose Documents — hence `.lean()` in the
//     caller.
//   • Blocking here is FINE. Blocking this thread does not touch the main
//     event loop. That is the entire point.
// HOW IT WORKS HERE: reads workerData, burns CPU, posts one message back.
// ============================================================

const { parentPort, workerData } = require('worker_threads');

// ============================================================
// 🧠 CONCEPT: workerData vs postMessage
// WHY IT MATTERS (interview angle): `workerData` is the ONE-TIME payload
//   handed over at construction — good for "here is the job". `postMessage`
//   is the ongoing two-way channel — good for progress updates, or for
//   feeding more jobs to a long-lived pooled worker. Knowing both is what
//   lets you build a worker POOL rather than spawning one per request.
// ============================================================
const { iterations = 1_000_000, tasks = [] } = workerData || {};

// Deliberately CPU-heavy. On the main thread this would freeze every
// concurrent request; here it freezes only this thread.
let checksum = 0;
for (let i = 0; i < iterations; i += 1) {
  checksum += Math.sqrt(i) * Math.sin(i);
}

const byStatus = {};
const hoursByPriority = {};
for (const task of tasks) {
  byStatus[task.status] = (byStatus[task.status] || 0) + 1;
  hoursByPriority[task.priority] = (hoursByPriority[task.priority] || 0) + (task.estimatedHours || 0);
}

// ============================================================
// 🧠 CONCEPT: postMessage ends the job, not the thread
// WHY IT MATTERS (interview angle): posting a message does NOT terminate
//   the worker. The thread stays alive as long as its event loop has work
//   (a pending timer, an open handle). For a one-shot worker this is fine —
//   it exits naturally once the script completes. For a pooled worker you
//   keep it alive on purpose and reuse it, which is exactly how piscina
//   avoids paying the 10-30ms startup cost per job.
// ============================================================
parentPort.postMessage({
  checksum: Number(checksum.toFixed(2)),
  byStatus,
  hoursByPriority,
  tasksProcessed: tasks.length,
  computedOn: `worker thread (main event loop stayed FREE)`,
});
