# `client/src/context/AuthContext.jsx`

> Holds the current user and the access token. Changes rarely — which makes it a **good** Context fit.

**Lines:** 237 · **Concept blocks:** 7

## ⭐ Context solves prop drilling

**The problem, stated precisely:**

❌ **Prop drilling** — the current user is needed by `<Navbar>`, four levels below `<App>`. Without Context you pass `user` through `<Layout>`, `<Header>` and `<Nav>`, **none of which use it**. Those three now have a prop they don't care about, they **all re-render when it changes**, and they **cannot be reused elsewhere** without supplying it. Add a second such value and it compounds.

✅ **Context** — a Provider publishes a value, and **any** descendant at any depth reads it with `useContext`. The intermediate components never see it.

## ⚠️⚠️ The limitation — ask this before they do

When a Context value changes, **EVERY component consuming it re-renders.** Not just the ones using the part that changed — **all** of them. `React.memo` does **not** help, because `useContext` subscribes the component directly; memo only compares props.

⭐ **This is THE reason people reach for Redux/Zustand**, and the reason is specifically about **re-render granularity**, not about Context being "not a real state manager". Context is a **dependency injection** mechanism — it has no opinion about *how* state is updated.

Mitigations are listed in the [folder doc](./README.md); this file applies split-by-frequency and `useMemo`.

## ⭐ `useMemo` on the Provider value — essential, not optional

```jsx
❌ <AuthContext.Provider value={{ user, login, logout }}>
```

A new object **every render**. Context compares by reference, so every consumer re-renders even when `user` is identical. **You've built the exact problem Context gets blamed for.**

```jsx
✅ const value = useMemo(() => ({ user, isLoading, ..., login, logout }), [user, isLoading, ..., login, logout]);
```

Which is also why `login`/`register`/`logout` are wrapped in `useCallback` — an unstable function identity would defeat the `useMemo`.

## ⭐ `useCallback` — when it actually matters

Every render creates brand-new function objects. `login` on render 2 is a **different object** from render 1, even with identical code. That matters in exactly **three** situations:

| # | Situation | Consequence of instability |
|---|---|---|
| 1 | In a `useEffect`/`useMemo` **dependency array** | The effect re-runs **every render**. If it sets state → **infinite loop.** |
| 2 | Passed to a **`React.memo`'d** child | A new prop identity defeats the memo entirely — **the optimisation silently does nothing** |
| 3 | In a **context value** ← *this case* | Every consumer re-renders |

⚠️ **OTHERWISE `useCallback` IS A NET COST.** It allocates the dependency array and runs a comparison on every render, to avoid... allocating a function, which is extremely cheap in V8. **Wrapping every handler "for performance" makes code slower AND noisier.** Measure first.

*(React 19's compiler automates this — itself a sign that hand-written memoisation was a bad developer experience.)*

## ⭐ Silent re-authentication on boot

The access token [lives in memory](../api/axiosClient.js.md), so a page refresh destroys it. But the **httpOnly refresh cookie survives** — the browser still has it.

So on boot the app calls `/auth/refresh`:

| Outcome | Result |
|---|---|
| Valid cookie | New access token — **the user never saw a login screen** |
| No/invalid cookie | Genuinely logged out |

⭐ **This is the piece that makes "token in memory" practical rather than infuriating**, and it's the direct answer to "but doesn't the user get logged out on every refresh?"

## ⭐ `useRef` to persist a value WITHOUT re-rendering

The second, less-known use of `useRef` (the first is [DOM access](../components/TaskForm.jsx.md)). A ref is a mutable box whose `.current` **survives re-renders but does NOT trigger one** when changed.

| | Changing it re-renders? | Survives re-render? | For |
|---|---|---|---|
| `useState` | ✅ Yes | ✅ | Data the UI displays |
| `useRef` | ❌ **No** | ✅ | Data the render **doesn't depend on**: timer ids, previous values, "has this run?" flags, subscription handles |
| a plain local | — | ❌ **Reset every render** | Nothing useful here |

### The concrete use: guarding StrictMode

```js
if (bootstrapAttempted.current) return;
bootstrapAttempted.current = true;
```

[React 18 StrictMode](../main.jsx.md) deliberately double-invokes effects in development. Without this flag the boot refresh fires **twice** — and because the server implements [rotation](../../../server/controllers/authController.js.md), the second call presents an **already-rotated token** → **reuse detection** → the whole family revoked → **the user is logged straight back out.**

⭐ A real bug StrictMode caught, and a good answer to "why does my effect run twice and how do you handle it?" — **you make it idempotent, you don't remove StrictMode.**

## The class-lifecycle mapping

Interviewers still ask:

| Class | Hook |
|---|---|
| `componentDidMount` | `useEffect(fn, [])` |
| `componentDidUpdate` | `useEffect(fn, [dep])` |
| `componentWillUnmount` | the **returned cleanup function** |
| All three | `useEffect(fn)` — no dep array |

⚠️ **But the mapping is a teaching aid, not an equivalence.** The real mental model is better: **an effect SYNCHRONISES your component with an external system**, and the dependency array says "re-synchronise when these change". Thinking in lifecycle terms is what leads to the classic bugs — a **stale closure** capturing an old value, or a missing dependency because "I only want this on mount".

## API

| Value | Notes |
|---|---|
| `user` | `{ id, name, email, role }` or `null` |
| `isLoading` | ⭐ `true` until the boot refresh settles — [essential for route guards](../routes/ProtectedRoute.jsx.md) |
| `isAuthenticated` / `isAdmin` | Derived |
| `login` / `register` / `logout` | Return `{ ok, error? }` rather than throwing, so pages can render the error inline |

## Interview questions

- **"What problem does Context solve, and what's its limitation?"** → Prop drilling; all-or-nothing re-renders.
- **"Why does every consumer re-render?"** → Inline object as the provider value.
- **"When does `useCallback` actually help?"** → The three cases. Then say it's a net cost otherwise — that's the discriminating part.
- **"`useRef` vs `useState`?"** → Re-render or not. Give a concrete use for each.
- **"Doesn't the user get logged out on refresh if the token is in memory?"** → No — the boot refresh restores it from the httpOnly cookie.
- **"Why does your effect run twice?"** → StrictMode. Guard with a ref; don't disable the check.
- **"What do class lifecycle methods map to?"** → The table, then the better mental model.

## Related

- [`api/axiosClient.js`](../api/axiosClient.js.md) — where the token lives, and the failure callback
- [`hooks/useAuth.js`](../hooks/useAuth.js.md) — the stable import path
- [`routes/ProtectedRoute.jsx`](../routes/ProtectedRoute.jsx.md) — why `isLoading` matters
- [`main.jsx`](../main.jsx.md) — StrictMode
- [`store/taskStore.js`](../store/taskStore.js.md) — the selector-based alternative
