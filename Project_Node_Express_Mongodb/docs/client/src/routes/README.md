# `client/src/routes/`

> Route guards. One file, two components.

| File | Doc | Lines | Exports |
|---|---|---|---|
| `ProtectedRoute.jsx` | [→](./ProtectedRoute.jsx.md) | 116 | `ProtectedRoute` (default) + `PublicRoute` |

## ⚠️⚠️ Read this first

**CLIENT-SIDE ROUTE GUARDS ARE NOT SECURITY.**

All the JavaScript is already in the user's browser. They can open DevTools, set `isAuthenticated = true`, delete this component from the bundle, or **simply ignore your app entirely and curl the API.**

⭐ **A route guard prevents an honest user from seeing a broken page; it prevents an attacker from precisely nothing.**

**The real security is on the server** — [`verifyAccessToken`, `requireRole`, `requireOwnership`](../../../server/middleware/auth.js.md) — which run on a machine the user does not control.

**The right mental model:** the client guard decides **WHAT TO SHOW**; the server decides **WHAT IS ALLOWED.**

## So what are they for?

Genuinely useful things:

- **Not rendering** a dashboard that will immediately 401 and fill the screen with errors
- **Redirecting** to `/login` with the intended destination remembered
- **Hiding** admin UI that would only frustrate a non-admin

If your API is properly protected, a user who bypasses the guard sees an **empty page and a pile of 403s** — annoying for them, harmless for you. ⭐ **That's the correct outcome, and being able to say so is the point.**

## The two guards

| Component | Behaviour |
|---|---|
| `ProtectedRoute` | Not authenticated → redirect to `/login`, remembering where they were going. Optional `requireRole`. |
| `PublicRoute` | **Already** authenticated → redirect **away** from `/login`/`/register` |

`PublicRoute` is the inverse, and it matters: without it, a logged-in user can navigate back to `/login`, sign in again, and **create a duplicate session** — or just be confused.

## ⚠️ The loading state is not optional

A subtle, very common bug. On page load, [`AuthContext`](../context/AuthContext.jsx.md) is still calling `/auth/refresh` to silently restore the session — so for a few hundred milliseconds `isAuthenticated` is `false` **even though the user IS logged in.**

Without a loading guard, **every refresh of a protected page flashes the login screen** and then redirects back — or worse, kicks the user out entirely.

⭐ **The fix is a three-state model** — loading / authenticated / unauthenticated — and rendering nothing decisive while loading.

## Interview questions

- **"Your route guard checks `isAdmin`. Is that secure?"** → No. It's UX. The server enforces. This is the single most important thing to say about this folder.
- **"Why does refreshing a protected page flash the login screen?"** → A two-state model where auth is still resolving. Add a loading state.
- **"Where does access control actually live?"** → Server middleware. The client mirrors it for presentation only.

## Related

- [`ProtectedRoute.jsx`](./ProtectedRoute.jsx.md) — the implementation
- [`server/middleware/auth.js`](../../../server/middleware/auth.js.md) — ⭐ the real enforcement
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — `isLoading`
- [`App.jsx`](../App.jsx.md) — how the guards are applied
