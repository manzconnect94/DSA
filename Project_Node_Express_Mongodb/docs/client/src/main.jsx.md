# `client/src/main.jsx`

> The entry point. Mounts React into `#root`.

**Lines:** 61 · **Concept blocks:** 3

## ESM here, CommonJS on the server

This file uses `import`; every server file uses `require`. **Deliberate**, so the repo demonstrates both — the full comparison table is at the top of [`server/app.js`](../../server/app.js.md).

The short version of why the client uses ESM: bundlers need **static analysis** to tree-shake unused code and to split bundles at dynamic `import()` boundaries — which is what [`React.lazy`](./App.jsx.md) relies on. CommonJS's runtime `require()` makes both impossible.

## ⭐ `createRoot` — the React 18 concurrent renderer

React 18 replaced `ReactDOM.render(<App/>, el)` with `createRoot(el).render(<App/>)`. **Not cosmetic** — it opts you into **concurrent rendering**:

| Change | Detail |
|---|---|
| ⭐ **Automatic batching everywhere** | In React 17, multiple `setState` calls inside a **promise or `setTimeout`** each caused a **separate render**. In 18 they're batched into one. **This is the change most likely to alter behaviour in an upgraded app.** |
| **Interruptible rendering** | React can pause a low-priority render to handle urgent user input, then resume. This is what makes `useTransition` and `useDeferredValue` possible. |
| **Streaming SSR** | Full `<Suspense>` support on the server |

⚠️ Calling the old `render()` in React 18 still works but logs a warning and **silently keeps you in legacy mode** with none of the above — so an app can be "on React 18" while getting none of its benefits.

## ⭐ StrictMode double-invokes things in development

A question that trips people up constantly: **"why does my `useEffect` run twice?"**

In **development only**, StrictMode deliberately:

- Renders components **twice**, to surface impure render logic
- **Mounts, unmounts, then remounts** every component — running each effect → cleanup → effect

### ⭐ It is not a bug and not something to "fix" by removing StrictMode

It's a **detector**. It finds effects with **missing or broken cleanup**. An effect that opens a subscription without closing it will leak in production; StrictMode makes that leak **visible immediately, in development**, instead of in a week-old production session.

⚠️ **It does not happen in production builds.** So if double-invocation breaks something, the correct response is to make the effect **idempotent**, not to disable the check.

### A concrete example from this project

[`AuthContext`](./context/AuthContext.jsx.md) guards its boot refresh with a `useRef` flag:

```js
if (bootstrapAttempted.current) return;
bootstrapAttempted.current = true;
```

Without it, the boot `POST /auth/refresh` fires **twice**. And because the server implements [refresh token **rotation**](../../server/controllers/authController.js.md), the second call presents an **already-rotated token** → **reuse detection** → the entire token family is revoked → **the user is logged straight back out.**

⭐ **That's a real bug StrictMode caught** — and one that would have been intermittent and baffling in production.

## Interview questions

- **"Why does my `useEffect` run twice?"** → StrictMode in development, deliberately. It's detecting missing cleanup. Don't remove it — make the effect idempotent.
- **"What changed in React 18?"** → `createRoot`, automatic batching everywhere, concurrent/interruptible rendering, streaming SSR.
- **"What actually broke when you upgraded to 18?"** → Usually automatic batching — code that relied on a re-render per `setState` inside an async callback.
- **"Does StrictMode affect production?"** → No. Development only.
- **"How would you make an effect idempotent?"** → Guard with a ref, or make the operation naturally safe to repeat (and always write the cleanup).

## Related

- [`App.jsx`](./App.jsx.md) — what gets rendered
- [`index.html`](../index.html.md) — the `#root` div
- [`context/AuthContext.jsx`](./context/AuthContext.jsx.md) — the StrictMode guard in practice
- [`server/app.js`](../../server/app.js.md) — the CJS vs ESM table
