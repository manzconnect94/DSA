# `server/tests/mocking.test.js`

> 15 tests on mocking strategy, fake timers, and why pure functions need neither.

**Lines:** 210 · **Concept blocks:** 7 · **Tests:** 15

## ⭐ When to mock

The question behind "do you write tests?" is usually "do you know **when** to mock?" Mock when the real dependency is:

| Reason | Example |
|---|---|
| **Slow** | bcrypt at 10 salt rounds is ~100ms **per call**. A suite with 50 login tests spends 5 seconds hashing. |
| **Non-deterministic** | `Date.now()`, `Math.random()`, `crypto.randomUUID()`. You cannot assert on a value that changes every run. |
| **External** | A payment gateway, an email provider. **You must not hit these from CI** — cost, rate limits, flakiness, and you'd be testing *their* uptime. |
| **Hard to trigger** | "What happens when the database times out?" You cannot make that happen on demand. |

## ⚠️ And when NOT to — the more important half

| Don't | Why |
|---|---|
| **Mock what you're testing** | You'd be asserting on your own fake |
| **Over-mock** | A test where **every** dependency is a mock proves only that the mocks were called. It verifies no real behaviour and **still passes after you break the integration between the parts.** ⭐ This is why the project *also* runs [real integration tests](./integration.auth.test.js.md). |
| **Forget that mocks DRIFT** | Your mock keeps the old API after the library changes, so **tests pass while production breaks.** Contract tests exist to catch this. |

## The vocabulary

Interviewers sometimes ask for precision:

| Term | Definition |
|---|---|
| **Stub** | Returns canned values. "`findById` always returns this user." |
| **Spy** | Records how a **real** function was called, without replacing it |
| **Mock** | A fake with **assertable expectations**. "`sendEmail` must be called once, with this address." |
| **Fake** | A working but simplified implementation — e.g. an in-memory database |

⭐ **Jest blurs these:** `jest.fn()` can act as any of them. Knowing the distinctions still helps you say what a test is actually verifying.

## Coverage

| Group | Tests |
|---|---|
| **Mocking bcrypt** | Stub to true · stub to false · ⭐ **mock a rejection** · measure the speed difference |
| **Mocking Mongoose** | Canned document · simulate a connection failure · ⭐ **chainable query builder** |
| **Fake timers** | Advance time · freeze the clock · ⭐ **debounce fires once** |
| **Pure functions** | `stripMongoOperators` — operators, dotted keys, prototype pollution, clean data untouched, **recursion depth bounded** |

## ⭐ The tests worth studying

### Mocking a rejection — the case you cannot test otherwise

```js
jest.spyOn(bcrypt, 'hash').mockRejectedValue(new Error('bcrypt exploded'));
await expect(bcrypt.hash('password', 10)).rejects.toThrow('bcrypt exploded');
```

How do you make bcrypt throw on demand? **You can't** — so you mock it.

⭐ **Error paths are the least-tested and most-likely-to-be-buggy code in any codebase**, precisely because they're hard to trigger. This is how you reach them.

### ⭐ Mocking a chainable query builder

A real practical difficulty people hit. `Task.find().select().sort().limit().lean()` is a fluent chain, so a mock must return an object whose methods **return themselves**, right up to the final call that resolves:

```js
const chain = {
  select: jest.fn().mockReturnThis(),
  sort:   jest.fn().mockReturnThis(),
  skip:   jest.fn().mockReturnThis(),
  limit:  jest.fn().mockReturnThis(),
  lean:   jest.fn().mockResolvedValue([{ title: 'Mocked task' }]),  // ← only the LAST resolves
};
jest.spyOn(Task, 'find').mockReturnValue(chain);
```

`mockReturnThis()` is the tool. Getting this wrong (`cannot read property 'sort' of undefined`) is **one of the most common Jest + Mongoose frustrations.**

Note it also asserts on the **arguments** — `expect(chain.limit).toHaveBeenCalledWith(10)` — which is usually more valuable than the call count, because it verifies you passed the right things.

### The speed measurement

```js
// real bcrypt at 10 rounds  →  ~100ms
// mocked                    →  ~0ms
expect(realMs).toBeGreaterThan(mockMs);
```

Makes the cost concrete. Real bcrypt is **intentionally slow — that IS the security property.** Across a large suite this is the difference between a 5-second and a 60-second run.

### ⭐ Fake timers

```js
const callback = jest.fn();
setTimeout(callback, 60_000);            // "one minute"
jest.advanceTimersByTime(60_000);        // time travel
expect(callback).toHaveBeenCalledTimes(1);
// The test itself took under a millisecond.
```

**How do you test "this token expires after 7 days" without waiting 7 days?** You replace the clock. This makes previously untestable logic — debounces, retries with backoff, TTLs, schedulers — **fully testable AND fast**.

`jest.setSystemTime(new Date('2025-01-01'))` freezes `Date.now()`, so an assertion on a date **can never flake**.

The debounce test mirrors the client's [`useDebounce`](../../client/src/hooks/useDebounce.js.md): three rapid calls, advance 300ms, assert **one** call with the **last** value.

### ⭐ Pure functions need no mocking at all

The punchline of the file. `stripMongoOperators` is pure — input in, output out, no dependencies — so it needs **zero setup, zero mocks**, and runs in microseconds.

```js
expect(stripMongoOperators({ email: { $ne: null } })).toEqual({ email: {} });
expect(stripMongoOperators(JSON.parse('{"__proto__":{"isAdmin":true},"name":"x"}'))).toEqual({ name: 'x' });
```

⭐ **When something is hard to test, that is usually a DESIGN signal: extract the logic into a pure function and the testing problem disappears.**

The depth test builds an 80-level nested object and asserts no stack overflow — verifying the [DoS guard](../middleware/validate.js.md).

## `restoreAllMocks`

```js
afterEach(() => jest.restoreAllMocks());
```

⚠️ A mock that leaks into the next test file is a classic source of **"it passes alone but fails in the suite"**. `jest.spyOn` (rather than reassigning the property) is what makes restoration possible. The config option `restoreMocks: true` does it automatically.

## Interview questions

- **"When do you mock?"** → Slow, non-deterministic, external, or hard-to-trigger. Then give the *don't* list — that's the discriminating half.
- **"What's the risk of over-mocking?"** → You verify the mocks, not the behaviour. Mocks also drift from the real API.
- **"Stub vs spy vs mock vs fake?"** → The four definitions.
- **"How do you mock `Model.find().select().lean()`?"** → `mockReturnThis()` on every link, resolve on the last.
- **"How do you test a 7-day expiry?"** → Fake timers.
- **"How do you test an error path you can't trigger?"** → Mock the dependency to reject.

## Related

- [`setup.js`](./setup.js.md) — the *other* strategy (a real in-memory DB) and why both exist
- [`middleware/validate.js`](../middleware/validate.js.md) — `stripMongoOperators`
- [`client/src/test/TaskForm.test.jsx`](../../client/src/test/TaskForm.test.jsx.md) — fake timers on the client
