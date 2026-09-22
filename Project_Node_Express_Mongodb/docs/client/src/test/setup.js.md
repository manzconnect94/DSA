# `client/src/test/setup.js`

> Vitest setup: RTL matchers, cleanup between tests, and jsdom stubs. Loaded via `setupFiles` in [`vite.config.js`](../../vite.config.js.md).

**Lines:** 38 · **Concept blocks:** 1

## What it does

| Step | Purpose |
|---|---|
| `import '@testing-library/jest-dom'` | Adds DOM matchers: `toBeDisabled()`, `toBeInTheDocument()`, `toHaveValue()` |
| `afterEach(cleanup)` | **Unmounts components between tests** |
| `afterEach(vi.clearAllMocks)` | Resets mock call history |
| `window.matchMedia` stub | jsdom doesn't implement it |

## Test isolation

```js
afterEach(() => { cleanup(); vi.clearAllMocks(); });
```

`cleanup()` unmounts everything rendered, so **no DOM state leaks** into the next test. ⭐ **The client-side equivalent of clearing collections in [`server/tests/setup.js`](../../../server/tests/setup.js.md)** — the same principle, different resource.

⚠️ Without it, `screen.getByLabelText(/title/i)` in the second test could find **two** matching inputs (one left over from the first) and throw `Found multiple elements`. A confusing failure that has nothing to do with the test that reports it.

*(Modern RTL auto-cleans when a global `afterEach` is available, but declaring it explicitly makes the behaviour visible rather than magic — which is the point of a study repo.)*

## ⚠️ Stubbing browser APIs jsdom lacks

```js
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({ matches: false, media: query, addEventListener: () => {}, ... }),
});
```

⭐ **jsdom is not a browser** — it's a JS implementation of DOM standards, and it deliberately doesn't implement everything. Any component calling `matchMedia` would throw `window.matchMedia is not a function`.

**Commonly stubbed in real projects:**

| API | Why jsdom lacks it |
|---|---|
| `matchMedia` | Media queries need a layout engine |
| `IntersectionObserver` | Same — needs real layout |
| `ResizeObserver` | Same |
| `scrollTo`, `getBoundingClientRect` | Returns all zeros — **no layout engine at all** |
| `localStorage` | Present, but shared between tests unless cleared |

⭐ **That last row about layout is the important limitation to name:** `getBoundingClientRect` returns zeros in jsdom, so **anything depending on real measurements cannot be meaningfully unit-tested.** Visual and layout behaviour needs a real browser — Playwright, Cypress, or Vitest's browser mode.

The stub returns `matches: false`, i.e. "no media query matches" — a deliberate, deterministic default. ⚠️ If a component branched on `prefers-reduced-motion` you'd want to override it per test rather than accept the global default.

## Why `css: false` in the Vite config

Skipping CSS processing in tests is faster and harmless — because [RTL queries by role and text](./README.md), **never by class.** If a test depended on a CSS class, it would be testing an implementation detail anyway.

## Comparison with the server's setup

| | [`server/tests/setup.js`](../../../server/tests/setup.js.md) | This file |
|---|---|---|
| Expensive setup | ⭐ Starts a **real in-memory MongoDB** | None needed |
| Per-test cleanup | `deleteMany({})` on every collection | `cleanup()` — unmount |
| Environment | `node` | `jsdom` |
| Teardown | Drop DB, close connection, stop server | — |

⭐ The client has no equivalent to the in-memory database because **it has no persistent state to isolate** — each `render()` is a fresh tree. That asymmetry is itself informative: **frontend tests are cheap because components are (or should be) stateless between mounts.**

## Interview questions

- **"Why clean up between tests?"** → Order-independence. Leftover DOM makes queries ambiguous and produces failures unrelated to the failing test.
- **"What is jsdom and what can't it do?"** → A JS DOM implementation, not a browser. **No layout engine** — so no real measurements, no `matchMedia`, no observers. Anything layout-dependent needs a real browser.
- **"How do you handle a component using `IntersectionObserver`?"** → Stub it in setup, or use a real browser runner if the behaviour is the point.
- **"Why not test CSS?"** → It's an implementation detail. Test behaviour and accessible output; use visual regression tooling for appearance.

## Related

- [`TaskForm.test.jsx`](./TaskForm.test.jsx.md) — the tests this enables
- [`vite.config.js`](../../vite.config.js.md) — `setupFiles`, `environment`, `css: false`
- [`server/tests/setup.js`](../../../server/tests/setup.js.md) — the backend counterpart
