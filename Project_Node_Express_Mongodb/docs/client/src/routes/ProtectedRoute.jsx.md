# `client/src/routes/ProtectedRoute.jsx`

> Route guards for authentication and roles. ⚠️ **UX, not security.**

**Lines:** 116 · **Concept blocks:** 5 · **Exports:** `ProtectedRoute` (default), `PublicRoute`

## ⚠️⚠️ Not security — and interviewers deliberately probe this

**All the JavaScript is already in the user's browser.** They can open DevTools, set `isAuthenticated = true`, delete this component from the bundle, or **simply ignore your app and curl the API.**

⭐ **The real security is [`verifyAccessToken`, `requireRole` and `requireOwnership`](../../../server/middleware/auth.js.md)** — running on a machine the user doesn't control. **This component is a REDIRECT, not a lock.**

The 403 screen says so explicitly, and invites you to try the endpoint directly:

> ⚠️ *This check is cosmetic. The real enforcement is `requireRole('admin')` on the server — try calling `GET /api/admin/users` directly and you will still get a 403.*

⭐ **The mental model:** the client decides **what to show**; the server decides **what is allowed.**

## ⭐ The loading state is NOT optional

A subtle and very common bug.

On page load, [`AuthContext`](../context/AuthContext.jsx.md) is still calling `/auth/refresh` to silently restore the session. So for a few hundred milliseconds `isAuthenticated` is `false` **even though the user IS logged in.**

Without this guard:

| Symptom | |
|---|---|
| Best case | **Every refresh of a protected page flashes the login screen**, then redirects back |
| Worse | The user is **kicked out entirely** |

⭐ **The fix is a three-state model:**

```jsx
if (isLoading) return <div>Restoring session…</div>;   // ← render nothing decisive
if (!isAuthenticated) return <Navigate to="/login" ... />;
return children;
```

**Two states (authenticated / not) is the bug. Three states is the fix.**

The fallback even names what's happening — *"Calling /api/auth/refresh with the httpOnly cookie"* — so the mechanism is visible while you wait.

## Preserving the intended destination

```jsx
return <Navigate to="/login" state={{ from: location }} replace />;
```

A user deep-links to `/tasks/abc123`, gets bounced to `/login`, logs in — and should land back on `/tasks/abc123`, **not** a generic home page. Stashing `location` in navigation state makes that possible; [`LoginPage`](../pages/LoginPage.jsx.md) reads it back.

⚠️ **`replace` matters too:** without it, the login page is **pushed** onto the history stack, so pressing Back after logging in returns the user **to the login screen**.

## The role gate

```jsx
if (requireRole && user?.role !== requireRole) return <Forbidden />;
```

Renders an explanatory 403 rather than redirecting — ⭐ a **deliberate UX choice**. A redirect would leave the user wondering why they bounced; an explanation tells them they're logged in as the wrong role.

Note `user?.role` — optional chaining, because `user` could be null in a race. ⭐ **Fail closed**, the same principle as [`requireRole` on the server](../../../server/middleware/auth.js.md).

## ⭐ `children` vs `<Outlet />`

React Router v6 supports **both**, and this component handles either:

```jsx
return children ?? <Outlet />;
```

| Pattern | Usage |
|---|---|
| **Wrapper** | `<Route path="/x" element={<ProtectedRoute><X/></ProtectedRoute>} />` — explicit and readable per route |
| **Layout route** | `<Route element={<ProtectedRoute/>}>` with nested `<Route>`s rendered through `<Outlet/>` — less repetition |

⭐ **The layout pattern is secure-by-default**, exactly like [router-level middleware on the server](../../../server/routes/README.md): a new nested route **inherits the guard automatically**, rather than depending on the next developer remembering.

[`App.jsx`](../App.jsx.md) uses the wrapper form for explicitness, but supporting both means callers can pick.

## `PublicRoute` — the inverse

An already-logged-in user should not see the login page. Without this they can navigate back to `/login`, sign in again, and **create a duplicate session** — or just be confused.

It also reads `location.state.from` to send them where they were originally headed.

## Interview questions

- **"Your route guard checks `isAdmin`. Is that secure?"** → No, and explain precisely why: the code is in the user's browser. The server enforces. ⭐ **This is the one to get right.**
- **"Why does refreshing a protected page flash the login screen?"** → A two-state model while auth is still resolving. Add a loading state.
- **"Redirect or render a 403 for a wrong role?"** → 403 with an explanation; a silent redirect is confusing.
- **"Why `replace` on the redirect?"** → Otherwise Back returns to the login page.
- **"`children` or `<Outlet />`?"** → Both work. The layout-route form is secure-by-default for many routes.
- **"So what ARE client guards for?"** → Not rendering doomed UI, remembering the destination, and hiding irrelevant navigation.

## Related

- [`server/middleware/auth.js`](../../../server/middleware/auth.js.md) — ⭐ the real enforcement
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — `isLoading`, `isAuthenticated`, `isAdmin`
- [`pages/LoginPage.jsx`](../pages/LoginPage.jsx.md) — reads `location.state.from`
- [`pages/AdminPage.jsx`](../pages/AdminPage.jsx.md) — what sits behind the role gate
- [`App.jsx`](../App.jsx.md) — how these are applied
