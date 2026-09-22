// ============================================================
// 🧠 CONCEPT: EventEmitter — Node's built-in pub/sub
// WHY IT MATTERS (interview angle): EventEmitter is the backbone of Node.
//   Streams, HTTP servers, sockets and process signals are all emitters.
//   Knowing it is not trivia — it is how you decouple "something happened"
//   from "here is everything that should happen next".
//
//   Without it, createTask() would have to call sendEmail(), writeAuditLog(),
//   updateSearchIndex() and bumpMetrics() inline: the controller now depends
//   on four subsystems, and a failure in the email service breaks task
//   creation. With it, the controller emits `taskCreated` and moves on;
//   listeners subscribe independently.
//
// ⚠️ THE FOLLOW-UP THAT CATCHES PEOPLE OUT: "so this is a message queue?"
//   NO. This is the key distinction:
//
//   EventEmitter                      | Message queue (RabbitMQ / SQS / Kafka)
//   ----------------------------------|----------------------------------------
//   IN-PROCESS only                   | Crosses process & machine boundaries
//   Listeners are SYNCHRONOUS by       | Consumers are asynchronous and
//     default — emit() runs each       |   decoupled in time
//     listener to completion inline    |
//   No persistence — process dies,     | Durable — messages survive a crash
//     pending work is gone forever     |   and are redelivered
//   No retry, no dead-letter queue     | Built-in retry + DLQ
//   No backpressure                    | Consumers pull at their own rate
//   Fan-out limited to this process    | Fan-out across many services
//
//   So: EventEmitter is for in-process decoupling. The moment you need the
//   work to survive a crash, be retried, or be handled by another service,
//   you need a real queue. Saying "I'd start with an emitter and move to
//   BullMQ/SQS when durability matters" is the answer that lands.
//
// HOW IT WORKS HERE: one shared emitter instance. Controllers emit
//   taskCreated / taskDeleted / userLoggedIn; the listeners below log them
//   and (optionally) broadcast over Socket.io.
// ============================================================

const { EventEmitter } = require('events');
const logger = require('./logger');

// Named event constants: string literals scattered across a codebase are a
// typo waiting to happen, and a typo'd emit() fails SILENTLY (emitting an
// event nobody listens to is perfectly legal and does nothing).
const EVENTS = {
  TASK_CREATED: 'taskCreated',
  TASK_UPDATED: 'taskUpdated',
  TASK_DELETED: 'taskDeleted',
  USER_REGISTERED: 'userRegistered',
  USER_LOGGED_IN: 'userLoggedIn',
  USER_LOGGED_OUT: 'userLoggedOut',
};

class ActivityLogger extends EventEmitter {
  constructor() {
    super();

    // ============================================================
    // 🧠 CONCEPT: The maxListeners warning
    // WHY IT MATTERS (interview angle): Node prints
    //   "MaxListenersExceededWarning: Possible EventEmitter memory leak"
    //   once you attach more than 10 listeners to one event. It is a WARNING,
    //   not an error, and it exists because the usual cause is a real leak:
    //   attaching a listener inside a request handler and never removing it,
    //   so the array grows unboundedly with traffic. Raising the limit to
    //   silence the warning without checking WHY is how leaks ship.
    // HOW IT WORKS HERE: we set 20 because we knowingly attach a handful at
    //   boot (and Socket.io may add more) — a bounded, boot-time count.
    // ============================================================
    this.setMaxListeners(20);

    this.recentActivity = []; // tiny in-memory ring buffer for the /api/activity endpoint
  }

  record(entry) {
    this.recentActivity.unshift({ ...entry, at: new Date().toISOString() });
    // Bound the buffer, or this IS a memory leak.
    if (this.recentActivity.length > 50) this.recentActivity.length = 50;
  }

  getRecent() {
    return this.recentActivity;
  }
}

const activityLogger = new ActivityLogger();

// ============================================================
// 🧠 CONCEPT: emit() is SYNCHRONOUS — the most misunderstood part
// WHY IT MATTERS (interview angle): people assume emit() schedules work for
//   "later". It does not. emit() calls every registered listener IN ORDER,
//   ON THE CURRENT TICK, and only returns once they have all finished.
//   Consequences:
//   • A slow, CPU-heavy listener BLOCKS the request that emitted the event.
//   • A listener that THROWS propagates the exception back into the emitter's
//     call stack, breaking the emit() caller.
//   • If a listener is `async`, emit() does NOT await it — it gets a floating
//     promise, and an unhandled rejection in it can crash the process
//     (Node 15+ makes unhandled rejections fatal by default).
//   Rule of thumb: keep listeners fast and synchronous, or have the listener
//   itself hand the work to a queue.
// HOW IT WORKS HERE: every listener below is cheap and wrapped in try/catch
//   so a listener bug can never take down the request that emitted.
// ============================================================
function safeListener(name, fn) {
  return (payload) => {
    try {
      fn(payload);
    } catch (err) {
      logger.error(`[activity] listener for "${name}" threw:`, err.message);
    }
  };
}

activityLogger.on(
  EVENTS.TASK_CREATED,
  safeListener(EVENTS.TASK_CREATED, (payload) => {
    logger.info(`[activity] task created "${payload.title}" by user ${payload.userId}`);
    activityLogger.record({ type: EVENTS.TASK_CREATED, ...payload });
  })
);

activityLogger.on(
  EVENTS.TASK_UPDATED,
  safeListener(EVENTS.TASK_UPDATED, (payload) => {
    logger.debug(`[activity] task ${payload.taskId} updated by ${payload.userId}`);
    activityLogger.record({ type: EVENTS.TASK_UPDATED, ...payload });
  })
);

activityLogger.on(
  EVENTS.TASK_DELETED,
  safeListener(EVENTS.TASK_DELETED, (payload) => {
    logger.info(`[activity] task ${payload.taskId} deleted by user ${payload.userId}`);
    activityLogger.record({ type: EVENTS.TASK_DELETED, ...payload });
  })
);

activityLogger.on(
  EVENTS.USER_LOGGED_IN,
  safeListener(EVENTS.USER_LOGGED_IN, (payload) => {
    logger.info(`[activity] user ${payload.email} logged in from ${payload.ip}`);
    activityLogger.record({ type: EVENTS.USER_LOGGED_IN, email: payload.email });
  })
);

activityLogger.on(
  EVENTS.USER_REGISTERED,
  safeListener(EVENTS.USER_REGISTERED, (payload) => {
    logger.info(`[activity] new user registered: ${payload.email}`);
    activityLogger.record({ type: EVENTS.USER_REGISTERED, email: payload.email });
    // In a real app this is where you'd enqueue a welcome email — note the
    // word ENQUEUE, not "send". Sending it inline here would block the
    // register response on an SMTP round-trip.
  })
);

activityLogger.on(
  EVENTS.USER_LOGGED_OUT,
  safeListener(EVENTS.USER_LOGGED_OUT, (payload) => {
    logger.debug(`[activity] user ${payload.userId} logged out`);
  })
);

// ============================================================
// 🧠 CONCEPT: The 'error' event is special
// WHY IT MATTERS (interview angle): if an EventEmitter emits 'error' and
//   NOTHING is listening, Node does not ignore it — it THROWS the error and
//   crashes the process. This is unique to the 'error' event name and is a
//   deliberate design choice ("errors must not pass silently"). Always
//   attach an 'error' listener to any long-lived emitter.
// HOW IT WORKS HERE: a no-op-but-logging listener so an emitted error can
//   never kill the server.
// ============================================================
activityLogger.on('error', (err) => {
  logger.error('[activity] emitter error:', err.message);
});

// ============================================================
// 🧠 CONCEPT: once() vs on(), and removing listeners
// WHY IT MATTERS (interview angle): `once()` auto-removes the listener after
//   the first call — the right tool for one-shot things like "warm the cache
//   after the first request". `on()` stays forever, and forgetting
//   `off()`/`removeListener()` on a per-request listener is the textbook
//   EventEmitter memory leak.
// HOW IT WORKS HERE: a one-shot boot marker demonstrating the API.
// ============================================================
activityLogger.once(EVENTS.USER_LOGGED_IN, () => {
  logger.debug('[activity] (once) first login since boot — this listener has now removed itself');
});

module.exports = { activityLogger, EVENTS };
