# `client/src/components/Navbar.jsx`

> Navigation, user display and logout. Small, but it's the event-listener cleanup showcase.

**Lines:** 69 · **Concept blocks:** 1

## What it renders

| Section | Contents |
|---|---|
| Brand | Link to `/` |
| Links *(authenticated only)* | Tasks · React Query · Zustand · Query demos · **Admin (only if `isAdmin`)** |
| User | Name, role pill, an offline indicator, logout button |

⚠️ Hiding the Admin link when `!isAdmin` is **cosmetic** — the same principle as [`ProtectedRoute`](../routes/ProtectedRoute.jsx.md). A user can type `/admin` directly; the **server** is what refuses.

## ⭐ `useEffect` cleanup removing an event listener

The second canonical cleanup example (the first is the timer in [`useDebounce`](../hooks/useDebounce.js.md)).

```js
useEffect(() => {
  const handleOnline  = () => setOnline(true);
  const handleOffline = () => setOnline(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, []);
```

### Without `removeEventListener`

**Every mount adds another listener to `window`.** Navigate between pages ten times and there are **ten listeners**, each holding a closure over a **dead component's state**.

⭐ That's a **textbook memory leak**, and the symptom is a page that gets **progressively slower the longer it's open** — the kind of bug that never appears in a short test session and is reported as "the app gets sluggish after a while".

⚠️ It's also worse under [StrictMode](../main.jsx.md), which mounts → unmounts → remounts in development. Without cleanup you'd have **two** listeners immediately — which is exactly the leak StrictMode exists to surface.

### ⚠️ The identity requirement

```js
❌ window.removeEventListener('online', () => setOnline(true));
```

**Removes NOTHING** — that arrow is a **brand-new function**, and `removeEventListener` matches by **reference**. Hence the **named handlers** stored in variables.

⭐ A subtle detail that catches people: the code *looks* correct and fails silently. There's no error; the listener just stays attached forever.

## `window.navigator.onLine`

Initial state comes from `navigator.onLine`, then the events keep it current.

⚠️ Worth knowing it's **unreliable**: it reports whether the OS has *a* network interface, not whether the internet (or your API) is actually reachable. Connected to a wifi network with no upstream? `onLine` is `true`. It's fine as a UX hint, but **never** as a reason to skip error handling.

## `NavLink` vs `Link`

`NavLink` adds an `active` class automatically based on the current route. ⭐ **That's the only reason to prefer it** — otherwise use `Link`. (In v6 you can also pass a function to `className`/`style` for finer control.)

## Logout

```js
async function handleLogout() {
  await logout();
  navigate('/login', { replace: true });
}
```

`replace: true` so **Back doesn't return to the authenticated page** — which would render briefly before the guard redirects, a visible flash of content the user shouldn't see.

The [`logout` in AuthContext](../context/AuthContext.jsx.md) clears local state even if the network call fails, so a user with no connectivity can still log out.

## Interview questions

- **"When does the `useEffect` cleanup run?"** → Before the next effect and on unmount.
- **"What happens if you forget `removeEventListener`?"** → A listener per mount, each holding a dead closure. Progressive slowdown.
- **"Why doesn't my `removeEventListener` work?"** → An inline arrow — it's a different function reference. Use a named handler.
- **"Can you trust `navigator.onLine`?"** → No. It only reflects a network interface, not reachability.
- **"`NavLink` or `Link`?"** → `NavLink` only when you need active styling.
- **"Is hiding the Admin link a security measure?"** → No. The server enforces.

## Related

- [`hooks/useDebounce.js`](../hooks/useDebounce.js.md) — cleanup applied to timers
- [`hooks/useFetch.js`](../hooks/useFetch.js.md) — cleanup applied to requests
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — `logout`, `isAdmin`
- [`routes/ProtectedRoute.jsx`](../routes/ProtectedRoute.jsx.md) — why hiding a link isn't protection
