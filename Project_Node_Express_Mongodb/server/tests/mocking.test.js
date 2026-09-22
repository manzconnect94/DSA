// ============================================================
// 🧠 CONCEPT: MOCKING — replacing a real dependency with a fake
// WHY IT MATTERS (interview angle): the question behind "do you write
//   tests?" is usually "do you know WHEN to mock?" Mock when the real
//   dependency is:
//     • SLOW        — bcrypt with 10 salt rounds is ~100ms PER CALL. A
//                     suite with 50 login tests spends 5 seconds hashing.
//     • NON-DETERMINISTIC — Date.now(), Math.random(), crypto.randomUUID().
//                     You cannot assert on a value that changes every run.
//     • EXTERNAL    — a payment gateway, an email provider, a third-party
//                     API. You must not hit these from CI (cost, rate
//                     limits, flakiness, and you'd be testing THEIR uptime).
//     • HARD TO TRIGGER — you need to test "what happens when the database
//                     times out?", and you cannot make that happen on demand.
//
//   ⚠️ AND WHEN NOT TO MOCK — the more important half:
//     • Don't mock what you're testing. Mocking the function under test
//       means you're asserting on your own fake.
//     • Don't over-mock. A test where every dependency is a mock proves
//       only that the mocks were called; it verifies no real behaviour and
//       still passes after you break the integration between the parts.
//       This is why we ALSO run real integration tests against a real
//       in-memory MongoDB.
//     • Mocks DRIFT. Your mock of a library keeps the old API after the
//       library changes, so tests pass while production breaks. Contract
//       tests exist to catch this.
//
//   THE VOCABULARY, since interviewers sometimes ask for precision:
//     STUB — returns canned values. "findById always returns this user."
//     SPY  — records how a real function was called, without replacing it.
//     MOCK — a fake with ASSERTABLE EXPECTATIONS. "sendEmail must be
//            called exactly once, with this address."
//     FAKE — a working but simplified implementation, e.g. an in-memory DB.
//   Jest blurs these: jest.fn() can act as any of them.
// ============================================================

const bcrypt = require('bcryptjs');

describe('Mocking a module — bcrypt', () => {
  afterEach(() => {
    // ============================================================
    // 🧠 CONCEPT: Always restore mocks
    // WHY IT MATTERS (interview angle): a mock that leaks into the next
    //   test file is a classic source of "it passes alone but fails in the
    //   suite". restoreAllMocks() puts the real implementations back.
    //   The config option `restoreMocks: true` does this automatically.
    // ============================================================
    jest.restoreAllMocks();
  });

  test('stub bcrypt.compare to return true without doing the real work', async () => {
    // jest.spyOn replaces the method but remembers the original so it can
    // be restored — safer than reassigning the property yourself.
    const compareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await bcrypt.compare('anything-at-all', '$2a$10$not.a.real.hash');

    expect(result).toBe(true);
    expect(compareSpy).toHaveBeenCalledTimes(1);
    // Asserting on the ARGUMENTS is usually more valuable than asserting on
    // the call count — it verifies you passed the right things.
    expect(compareSpy).toHaveBeenCalledWith('anything-at-all', '$2a$10$not.a.real.hash');
  });

  test('stub bcrypt.compare to return false — the failure path', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    expect(await bcrypt.compare('wrong', 'hash')).toBe(false);
  });

  // ============================================================
  // 🧠 CONCEPT: Mocking a REJECTION to test error handling
  // WHY IT MATTERS (interview angle): this is the case you cannot test any
  //   other way. How do you make bcrypt throw on demand? You can't — so you
  //   mock it. Error paths are the least-tested and most-likely-to-be-buggy
  //   code in any codebase, precisely because they are hard to trigger.
  // ============================================================
  test('simulate bcrypt throwing, to exercise the error path', async () => {
    jest.spyOn(bcrypt, 'hash').mockRejectedValue(new Error('bcrypt exploded'));

    await expect(bcrypt.hash('password', 10)).rejects.toThrow('bcrypt exploded');
  });

  test('measure the speed difference mocking buys', async () => {
    // Real bcrypt at a realistic cost factor.
    const realStart = Date.now();
    await bcrypt.hash('password', 10);
    const realMs = Date.now() - realStart;

    jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2a$10$fake');
    const mockStart = Date.now();
    await bcrypt.hash('password', 10);
    const mockMs = Date.now() - mockStart;

    // Real bcrypt is intentionally slow (that IS the security property).
    // The mock is effectively instant. Across a large suite this is the
    // difference between a 5-second and a 60-second test run.
    expect(realMs).toBeGreaterThan(mockMs);
  });
});

// ============================================================
// 🧠 CONCEPT: Mocking a Mongoose model method
// WHY IT MATTERS (interview angle): lets you test controller/service logic
//   without a database at all, and — crucially — lets you simulate database
//   FAILURES that are otherwise impossible to produce on demand.
// ============================================================
describe('Mocking a Mongoose model', () => {
  afterEach(() => jest.restoreAllMocks());

  test('stub User.findById to return a canned document', async () => {
    const User = require('../models/User');

    const fakeUser = { _id: 'abc123', name: 'Mocked User', email: 'mock@example.com', role: 'admin' };
    jest.spyOn(User, 'findById').mockResolvedValue(fakeUser);

    const result = await User.findById('abc123');

    expect(result.name).toBe('Mocked User');
    expect(result.role).toBe('admin');
    // No database was involved at any point in this test.
  });

  test('simulate a database connection failure', async () => {
    const Task = require('../models/Task');

    jest.spyOn(Task, 'countDocuments').mockRejectedValue(new Error('connection timed out'));

    await expect(Task.countDocuments()).rejects.toThrow('connection timed out');
  });

  // ============================================================
  // 🧠 CONCEPT: Mocking a CHAINABLE query builder
  // WHY IT MATTERS (interview angle): a real practical difficulty people
  //   hit. `Task.find().select().sort().limit().lean()` is a fluent chain,
  //   so a mock must return an object whose methods return THEMSELVES,
  //   right up to the final call that resolves. `mockReturnThis()` is the
  //   tool. Getting this wrong ("cannot read property 'sort' of undefined")
  //   is one of the most common Jest+Mongoose frustrations.
  // ============================================================
  test('mock a chained query builder', async () => {
    const Task = require('../models/Task');

    const chain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      // Only the LAST method in the chain resolves to the data.
      lean: jest.fn().mockResolvedValue([{ title: 'Mocked task' }]),
    };

    jest.spyOn(Task, 'find').mockReturnValue(chain);

    const result = await Task.find({}).select('title').sort('-createdAt').skip(0).limit(10).lean();

    expect(result).toEqual([{ title: 'Mocked task' }]);
    expect(chain.select).toHaveBeenCalledWith('title');
    expect(chain.limit).toHaveBeenCalledWith(10);
  });
});

// ============================================================
// 🧠 CONCEPT: Fake timers — controlling time itself
// WHY IT MATTERS (interview angle): how do you test "this token expires
//   after 7 days" without waiting 7 days? You replace the clock. Jest's
//   fake timers let you advance time instantly, which makes previously
//   untestable logic (debounces, retries with backoff, TTLs, schedulers)
//   fully testable AND fast.
// ============================================================
describe('Fake timers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('advance time to trigger a setTimeout instantly', () => {
    const callback = jest.fn();
    setTimeout(callback, 60_000); // "one minute"

    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60_000); // time travel

    expect(callback).toHaveBeenCalledTimes(1);
    // The test itself took under a millisecond.
  });

  test('freeze the system clock for deterministic date assertions', () => {
    jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    // Date.now() is now fixed, so an assertion on it can never flake.
    expect(new Date().toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  test('a debounce fires only once for rapid calls', () => {
    // The same logic as the client's useDebounce hook.
    const fn = jest.fn();
    let timer = null;
    const debounced = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), 300);
    };

    debounced('a');
    debounced('ab');
    debounced('abc'); // three keystrokes in quick succession

    jest.advanceTimersByTime(300);

    // Only the LAST value produced a call — that is the whole point of
    // debouncing a search input.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('abc');
  });
});

// ============================================================
// 🧠 CONCEPT: Testing pure functions needs no mocking at all
// WHY IT MATTERS (interview angle): the punchline of the whole file. The
//   sanitiser below is pure — input in, output out, no dependencies — so it
//   needs zero setup, zero mocks and runs in microseconds. When something
//   is hard to test, that is usually a DESIGN signal: extract the logic
//   into a pure function and the testing problem disappears.
// ============================================================
describe('Pure function: stripMongoOperators', () => {
  const { stripMongoOperators } = require('../middleware/validate');

  test('removes $-prefixed operator keys', () => {
    expect(stripMongoOperators({ email: { $ne: null } })).toEqual({ email: {} });
  });

  test('removes dotted keys that could reach nested paths', () => {
    expect(stripMongoOperators({ 'user.role': 'admin', name: 'ok' })).toEqual({ name: 'ok' });
  });

  test('blocks prototype pollution keys', () => {
    const polluted = JSON.parse('{"__proto__": {"isAdmin": true}, "name": "x"}');
    expect(stripMongoOperators(polluted)).toEqual({ name: 'x' });
  });

  test('leaves legitimate data untouched', () => {
    const clean = { name: 'Manzer', tags: ['a', 'b'], nested: { ok: 1 } };
    expect(stripMongoOperators(clean)).toEqual(clean);
  });

  test('bounds recursion depth (deep-nesting DoS defence)', () => {
    // Build an 80-level deep object.
    let deep = { value: 'bottom' };
    for (let i = 0; i < 80; i += 1) deep = { nested: deep };

    // Must not throw a stack overflow.
    expect(() => stripMongoOperators(deep)).not.toThrow();
  });
});
