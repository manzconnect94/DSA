# `client/src/context/`

> Two contexts, deliberately **split by change frequency**.

| File | Doc | Lines | Changes | Pattern |
|---|---|---|---|---|
| `AuthContext.jsx` | [→](./AuthContext.jsx.md) | 237 | **Rarely** (login, logout, refresh) | `useState` + `useCallback` |
| `TaskContext.jsx` | [→](./TaskContext.jsx.md) | 187 | **Frequently** (every fetch, create, delete) | `useReducer` |

## ⭐ Why two contexts and not one

**The single most important design decision in this folder.**

When a Context value changes, **EVERY component consuming that context re-renders.** Not just the ones using the part that changed — **all** of them. `React.memo` does **not** help, because `useContext` subscribes the component directly and memo only compares props.

So a single `AppContext` holding user + theme + tasks + notifications means **a keystroke in a search box re-renders your entire app.**

⭐ Splitting by change frequency is mitigation #1: a component that only needs `user` doesn't re-render when the task list updates.

### The full mitigation list

| # | Mitigation | Applied? |
|---|---|---|
| 1 | **Split contexts** by change frequency | ✅ This folder |
| 2 | Split **state** from **dispatch** into two contexts — components that only dispatch never re-render on state change | Not here (would be the next step) |
| 3 | **`useMemo` the provider value** — an unchanged value must not get a new object identity | ✅ Both files |
| 4 | Use a store with **selectors** when you need per-field subscriptions | ✅ [`store/`](../store/README.md) |

## ⚠️ The mistake that creates the problem people blame on Context

```jsx
❌ <AuthContext.Provider value={{ user, login, logout }}>
```

That object literal is a **new object on every render** of the provider. Context compares by reference (`Object.is`), so **every consumer in the entire tree re-renders on every provider render** — even when `user` is byte-for-byte identical.

⭐ **You've built the exact performance problem Context is accused of having.** `useMemo` on the value is not optional.

The same applies to functions in the value — hence `useCallback` on `login`/`logout`/`register`.

## The custom-hook convention

Both files export a hook rather than the raw context:

```js
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used inside an <AuthProvider>');
  return context;
}
```

Three concrete benefits:

1. ⭐ **A useful error** when used outside the Provider. Without it, `useContext` returns `undefined` and you get `Cannot destructure property 'user' of undefined` **pointing at the wrong file entirely**.
2. Consumers import **one** thing, not two.
3. ⭐ **An abstraction boundary** — swap Context for Zustand or Redux inside the hook and **not a single consuming component changes.** That's the real payoff, and it's why [`hooks/useAuth.js`](../hooks/useAuth.js.md) re-exports it from a stable path.

Note `createContext(null)` with an explicit `=== null` check, rather than defaulting to `{}` — a `{}` default would make the error case indistinguishable from a legitimately empty context.

## Interview questions

- **"What problem does Context solve?"** → Prop drilling: passing a value through components that don't use it, coupling them and re-rendering them for nothing.
- **"What's Context's limitation?"** → All-or-nothing re-render granularity. `React.memo` can't help.
- **"Why does every consumer re-render when nothing changed?"** → An inline object literal as the provider value. Memoise it.
- **"Context or Redux?"** → Context for low-frequency global values; a selector-based store for frequently-changing state. But first ask whether it's [server state](../pages/ReactQueryPage.jsx.md).
- **"Why export a hook instead of the context?"** → Error messages, one import, and the freedom to change the implementation.

## Related

- [`store/taskStore.js`](../store/taskStore.js.md) — the same state, with selectors
- [`pages/ZustandPage.jsx`](../pages/ZustandPage.jsx.md) — the difference, with live render counters
- [`App.jsx`](../App.jsx.md) — provider composition order
