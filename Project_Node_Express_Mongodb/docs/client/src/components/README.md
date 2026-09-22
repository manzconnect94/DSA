# `client/src/components/`

> Four reusable components — three function components and the project's **only class**.

| File | Doc | Lines | Demonstrates |
|---|---|---|---|
| `ErrorBoundary.jsx` | [→](./ErrorBoundary.jsx.md) | 167 | ⭐ **Why boundaries must be classes** |
| `TaskForm.jsx` | [→](./TaskForm.jsx.md) | 206 | **Controlled vs uncontrolled**, both uses of `useRef` |
| `TaskList.jsx` | [→](./TaskList.jsx.md) | 200 | `useMemo`/`useCallback`/`React.memo`, **why index keys are a bug** |
| `Navbar.jsx` | [→](./Navbar.jsx.md) | 69 | Event-listener **cleanup** |

## ⭐ The one class component

[`ErrorBoundary`](./ErrorBoundary.jsx.md) is the only class in the codebase, because `getDerivedStateFromError` and `componentDidCatch` have **no hook equivalent**. **There is no `useErrorBoundary`.** The React team has said one is planned, but today if you need a boundary you write a class — or use `react-error-boundary`, which is itself a class behind a hook-friendly API.

Everything else is a function component with hooks.

## Components vs pages

| | Location | Returns | Knows about |
|---|---|---|---|
| **Component** | `components/` | Presentational JSX | Only its props |
| **Page** | [`pages/`](../pages/README.md) | A route's full view | Hooks, context, stores, routing |

⭐ The practical test: `TaskForm` and `TaskList` take **props and callbacks only** — no `useAuth`, no store, no `axiosClient`. That's why they can be reused unchanged across all three state-strategy pages ([Context](../pages/TasksPage.jsx.md), [React Query](../pages/ReactQueryPage.jsx.md), [Zustand](../pages/ZustandPage.jsx.md)).

**If they read from a store directly, that comparison would be impossible** — you'd need three copies. That's the concrete payoff of keeping components dumb.

## The memoisation pairing

[`TaskList`](./TaskList.jsx.md) demonstrates something worth internalising: **`React.memo` on a child and `useCallback` on the parent's handlers are a MATCHED SET.**

```jsx
const TaskRow = memo(function TaskRow({ task, onToggle, onDelete }) { ... });
// ...in the parent:
const handleToggle = useCallback((id, status) => { ... }, [onToggle]);
```

⚠️ Without `useCallback`, each row receives a **new function every render**, memo's shallow compare always fails, and **all 500 rows re-render** — you paid for the comparison and got nothing. **One without the other is usually wasted effort.**

## Accessibility, and why it's load-bearing here

Every component uses semantic markup: real `<label for>` associations, `role="alert"` on errors, `aria-label` on icon-only buttons.

⭐ Not incidental — [RTL queries by role and label](../test/setup.js.md), so **inaccessible markup makes the tests fail to find elements.** `getByRole('button', { name: /add task/i })` cannot find a button with no accessible name.

That's a genuinely useful side effect: **testing by role nudges you toward accessible markup.**

## Interview questions

- **"Why must an error boundary be a class?"** → `getDerivedStateFromError` and `componentDidCatch` have no hook equivalent.
- **"How do you keep components reusable?"** → Props in, callbacks out. No direct store or context access. This project proves it by reusing two components across three state strategies.
- **"I wrapped my component in `memo` and it still re-renders."** → Unstable prop identities. memo and `useCallback` go together.
- **"How should you query elements in tests?"** → By role/label, not class — and it improves accessibility as a side effect.

## Related

- [`pages/`](../pages/README.md) — the consumers
- [`test/TaskForm.test.jsx`](../test/TaskForm.test.jsx.md) — component tests
