# `client/src/hooks/`

> Three custom hooks. Reusable stateful logic, extracted so it's independently testable.

| File | Doc | Lines | Purpose |
|---|---|---|---|
| `useFetch.js` | [→](./useFetch.js.md) | 144 | ⭐ Data fetching, **with the race condition fixed** |
| `useDebounce.js` | [→](./useDebounce.js.md) | 100 | Debounce (+ a throttle sibling) — the **cleanup** showcase |
| `useAuth.js` | [→](./useAuth.js.md) | 11 | A re-export for a stable import path |

## What makes something a custom hook

Two rules, and the reasoning behind each:

1. **The name must start with `use`.** Not cosmetic — it's how the React linter knows to enforce the rules of hooks in that function, and how React's dev tooling identifies it.
2. **It may call other hooks.** That's the entire point: a plain function can't call `useState`; a hook can.

A custom hook extracts **stateful logic**, not markup. That's the distinction from a component: a hook returns **data**, a component returns **JSX**.

## Why extract them

| Benefit | Example |
|---|---|
| **Reuse** | `useDebounce` is used by both [`TasksPage`](../pages/TasksPage.jsx.md) and [`ReactQueryPage`](../pages/ReactQueryPage.jsx.md) |
| ⭐ **Independent testing** | `renderHook` tests them with no UI at all — see [the test](../test/TaskForm.test.jsx.md) |
| **Readability** | A page says `useDebounce(search, 400)` instead of embedding a timer and its cleanup |
| **A seam for change** | `useAuth` can switch from Context to Zustand without touching consumers |

## ⭐ The `useEffect` cleanup thread

All three hooks demonstrate it, on three different resources — and it's the same rule every time:

| Hook | Creates | Must dispose with |
|---|---|---|
| [`useDebounce`](./useDebounce.js.md) | `setTimeout` | `clearTimeout` |
| [`useFetch`](./useFetch.js.md) | An in-flight request | `AbortController.abort()` + an ignore flag |
| ([`Navbar`](../components/Navbar.jsx.md)) | `addEventListener` | `removeEventListener` |

**The rule:** anything long-lived created in an effect must be disposed of in the returned cleanup. Otherwise the callback still fires after unmount, still holds a reference to that component's closure (**so it's never garbage collected**), and may call `setState` on something that no longer exists.

⚠️ React 18 removed the setState-after-unmount warning, but the underlying waste — holding a dead component's closure alive — is still real.

## Shared gotcha: unstable dependencies

Both `useFetch` and `useDebounce` have to deal with dependency-array identity:

```js
const paramsKey = JSON.stringify(params ?? {});   // ← serialised for stability
```

⚠️ An object literal passed by a caller is a **new reference every render**. Put it directly in a dependency array and the effect re-runs every render → fetch → setState → render → fetch... ⭐ **an infinite request loop.** It usually presents as **"why is my API being called 400 times?"**

## Interview questions

- **"What makes a custom hook a hook?"** → The `use` prefix (for lint/tooling) and the ability to call other hooks.
- **"When do you extract one?"** → Reused stateful logic, or logic complex enough to test on its own.
- **"How do you test a hook?"** → `renderHook`, often with fake timers.
- **"When does the cleanup function run?"** → Before the effect re-runs, and on unmount.
- **"Why is my effect looping infinitely?"** → An unstable dependency — usually an inline object or function.

## Related

- [`context/README.md`](../context/README.md) — hooks wrapping context
- [`test/`](../test/README.md) — `renderHook` + fake timers
