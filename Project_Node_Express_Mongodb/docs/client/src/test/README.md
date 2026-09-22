# `client/src/test/`

> 6 passing tests with Vitest + React Testing Library.

```bash
cd client && npm test
# Test Files  1 passed (1)
#      Tests  6 passed (6)
```

| File | Doc | Lines | Purpose |
|---|---|---|---|
| `setup.js` | [→](./setup.js.md) | 38 | RTL setup, cleanup, jsdom stubs |
| `TaskForm.test.jsx` | [→](./TaskForm.test.jsx.md) | 101 | 5 component tests + 1 hook test |

## ⭐ RTL's guiding principle

> *"The more your tests resemble the way your software is used, the more confidence they give you."*

In practice:

| | |
|---|---|
| ✅ | Query by what a **USER perceives**: role, label text, visible text, placeholder — `getByRole('button', { name: /log in/i })` |
| ❌ | **Don't** query by CSS class or component internals. Those are **implementation details** — rename a class and a passing test breaks even though the app works perfectly. ⭐ **That's a test that costs you money without catching bugs.** |

### ⭐ The benefit people miss

Querying by **role** means your tests **fail when the UI is inaccessible.** `getByRole('button', { name: ... })` **cannot find a button with no accessible name.**

So RTL **nudges you toward accessible markup** — and that's why every [component](../components/README.md) here uses real `<label for>` associations, `role="alert"` and `aria-label` on icon buttons. It isn't incidental; the tests wouldn't work otherwise.

## Vitest, not Jest

Not inconsistency with the server — Vitest reuses [`vite.config.js`](../../vite.config.js.md), so the JSX transform, aliases and plugins are configured **once**. With Jest you'd need a Babel config and a transform chain duplicating what Vite already does.

Its API is intentionally Jest-compatible (`describe`/`test`/`expect`, `vi` instead of `jest`), so the knowledge transfers directly.

## `userEvent` over `fireEvent`

| | Behaviour |
|---|---|
| `fireEvent.change(input, {...})` | Dispatches **one** synthetic event |
| `userEvent.type(input, 'abc')` | Simulates the **full** interaction: focus, keydown, keypress, input, keyup — **per character** |

⭐ `user-event` catches bugs `fireEvent` misses — a handler that only listens for `keydown`, or a field that behaves differently when focused. It's async, hence `await user.type(...)`.

## ⚠️ What's deliberately NOT tested

Being honest about coverage is worth more than pretending:

| Not tested | Why |
|---|---|
| Pages | They'd need router + provider + API mocks. Real value, but it's E2E territory (Playwright/Cypress). |
| The axios interceptor | ⚠️ ⭐ **The biggest genuine gap.** The [single-flight refresh](../api/axiosClient.js.md) is the most subtle logic on the client and it's **untested** — it would need `msw` to mock the 401/refresh sequence. |
| React Query pages | Need a `QueryClientProvider` wrapper and mocked endpoints |
| Zustand store | Testable via `getState()`/`setState()` directly, which would be quick to add |

⭐ **"What would you test next?"** — the interceptor, with `msw`, asserting that ten concurrent 401s produce exactly **one** refresh call. That's the highest-value missing test, and knowing which one it is matters more than the count.

## The testing pyramid here

| Layer | Count | Where |
|---|---|---|
| E2E | 0 | — |
| Integration | 49 | [server](../../../server/tests/README.md) |
| Unit / component | 31 + 6 | server + client |

The client is **component-heavy and thin** on purpose: most of this project's risk lives in the backend's auth and access control, which is [where the security tests are](../../../server/tests/README.md).

## Interview questions

- **"How should you query elements in a test?"** → By role/label — what a user perceives. Never by class. Then the accessibility side effect.
- **"`fireEvent` or `userEvent`?"** → `userEvent`; it simulates the real event sequence.
- **"Jest or Vitest?"** → Vitest in a Vite project — shared config, no duplicated transform pipeline.
- **"What's your coverage gap?"** → The axios interceptor's single-flight refresh, and I'd use `msw` to close it.

## Related

- [`setup.js`](./setup.js.md) · [`TaskForm.test.jsx`](./TaskForm.test.jsx.md)
- [`server/tests/`](../../../server/tests/README.md) — the backend suite
- [`vite.config.js`](../../vite.config.js.md) — the `test` block
