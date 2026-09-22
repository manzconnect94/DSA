# `server/tests/`

> 80 passing tests across four suites. The security tests are the point.

```bash
cd server && npm test
# Test Suites: 4 passed, 4 total
# Tests:       80 passed, 80 total
```

## Files

| File | Doc | Tests | Type |
|---|---|---|---|
| `setup.js` | [→](./setup.js.md) | — | In-memory MongoDB lifecycle |
| `unit.tokens.test.js` | [→](./unit.tokens.test.js.md) | 16 | **Unit** — pure functions |
| `integration.auth.test.js` | [→](./integration.auth.test.js.md) | 27 | **Integration** — Supertest + real DB |
| `integration.tasks.test.js` | [→](./integration.tasks.test.js.md) | 22 | **Integration** — ⭐ includes the IDOR tests |
| `mocking.test.js` | [→](./mocking.test.js.md) | 15 | **Mocking** + fake timers + pure functions |

## The testing pyramid, as applied here

```
        ╱╲          E2E — none here. Slow, brittle, but the only
       ╱  ╲               tests that prove the whole thing works.
      ╱────╲              (The client has a few RTL component tests.)
     ╱      ╲
    ╱ INTEG. ╲     49 tests — routes + middleware + real MongoDB.
   ╱          ╲          Catches what unit tests cannot: middleware
  ╱────────────╲         order, route typos, hooks not firing.
 ╱              ╲
╱   UNIT + MOCK  ╲  31 tests — pure functions and isolated behaviour.
──────────────────       Milliseconds, fully deterministic.
```

## ⭐ The security tests

The reason this suite exists. Each one guards a specific vulnerability, and each would **pass silently if you only tested the happy path**:

| Test | Guards against | File |
|---|---|---|
| **Bob can't read/update/delete Alice's task (404)** | ⭐ **IDOR** — OWASP #1 | [tasks](./integration.tasks.test.js.md) |
| Identical error for unknown-email and wrong-password | **User enumeration** | [auth](./integration.auth.test.js.md) |
| `role: 'admin'` in the register body is rejected | **Mass assignment** | [auth](./integration.auth.test.js.md) |
| `{"$ne": null}` as an email is rejected | **NoSQL injection** | [auth](./integration.auth.test.js.md) |
| Replaying a rotated refresh token revokes the family | **Token theft** | [auth](./integration.auth.test.js.md) |
| The password hash never appears in any response | **Credential leakage** | [auth](./integration.auth.test.js.md) |
| A tampered JWT payload is rejected | **Forgery** | [tokens](./unit.tokens.test.js.md) |
| An `alg: none` token is rejected | **Algorithm confusion** | [tokens](./unit.tokens.test.js.md) |
| A regular user gets 403 on an admin route | **Broken access control** | [tasks](./integration.tasks.test.js.md) |
| A `=HYPERLINK(...)` title is neutralised in the CSV | **Formula injection** | [tasks](./integration.tasks.test.js.md) |
| `__proto__` keys are stripped | **Prototype pollution** | [mocking](./mocking.test.js.md) |
| `?limit=1000000` returns 400 | **DoS** | [tasks](./integration.tasks.test.js.md) |

⭐ **If you write one security test in a codebase, write the IDOR one** — broken access control is OWASP's #1 risk and it's **invisible in manual QA**, because testers only ever look at their own data.

## Two bugs this suite actually caught

Not hypothetical — both were real defects found while building the project:

| Bug | How it surfaced | Fix |
|---|---|---|
| **The rate limiter throttled the test suite** | 27 failures with a confusing "cannot read property of undefined". Every Supertest request comes from `127.0.0.1`, so the whole suite shared one bucket; the 11th registration got a 429. | [Disabled in the test env](../middleware/rateLimiter.js.md), with the general lesson documented |
| **`.escape()` corrupted stored data** | A test asserted `"Alice's private task"` and got `"Alice&#x27;s private task"` | [Escape on output, not input](../middleware/validate.js.md) |

⭐ The second is the better story: the test didn't just catch a typo, it caught a **wrong architectural decision** about *where* escaping belongs.

## Running

| Command | Purpose |
|---|---|
| `npm test` | All 80, serially |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | With a coverage report |
| `npx jest tests/integration.auth.test.js -t "reuse"` | One test by name |

`NODE_ENV=test` is load-bearing — see [`jest.config.js`](../jest.config.js.md).

## Interview questions

- **"How do you test database code?"** → In-memory MongoDB. Explain why mocking the DB entirely tests your mock, not MongoDB.
- **"Unit or integration?"** → Both, in pyramid proportions. Integration catches middleware order and route wiring; unit gives fast, precise feedback.
- **"Write one security test."** → The IDOR test.
- **"Your tests pass individually and fail together."** → Shared state, or something keyed on a value that's constant in tests.

## Related

- [`jest.config.js`](../jest.config.js.md) — config and `--runInBand`
- [`client/src/test/`](../../client/src/test/README.md) — the frontend suite
