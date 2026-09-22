# `client/src/pages/LoginPage.jsx`

> A fully controlled login form. Pre-filled with the seeded demo credentials.

**Lines:** 116 · **Concept blocks:** 3 · **Route:** `/login` (wrapped in `PublicRoute`)

## Why fully controlled

A login form is the **right** place for controlled inputs — you want a live-disabled submit button and instant feedback, and both need the current values in state.

Contrast with [`TaskForm`](../components/TaskForm.jsx.md), which mixes controlled and uncontrolled deliberately.

## ⭐ The error message is deliberately vague

The server returns **"Invalid email or password"** for **both** an unknown email and a wrong password, to prevent [user enumeration](../../../server/controllers/authController.js.md).

⚠️ **The UI must not "helpfully improve" on that** by saying "no account with that email" — that would **reintroduce the leak in the frontend after the backend carefully closed it.**

⭐ A good point to raise unprompted: **security properties can be undone at any layer.** A careful server-side defence is worthless if the client renders a more specific message it inferred from a status code.

## The destination handshake

```js
const destination = location.state?.from?.pathname || '/tasks';
// ...on success:
navigate(destination, { replace: true });
```

[`ProtectedRoute`](../routes/ProtectedRoute.jsx.md) stashed the intended path when it bounced the user here. So a deep link to `/tasks/abc123` → login → **back to `/tasks/abc123`**, not a generic home page.

⚠️ `replace: true` so **Back doesn't return to the login screen.**

## `autoComplete` hints

```jsx
<input type="email"    autoComplete="username" />
<input type="password" autoComplete="current-password" />
```

⭐ **An accessibility and UX feature.** `current-password` vs `new-password` tells password managers which field is which. Get it wrong and 1Password/Chrome offer to save the wrong value, or fail to autofill — **a small detail real users notice immediately.**

(`username` rather than `email` is the spec-correct token for a login identifier, even when it's an email.)

## The detail block: "What happens when you click Log in?"

A collapsible `<details>` narrating the full flow — server-side password verification (including the [dummy-hash timing defence](../../../server/controllers/authController.js.md)), the two tokens and where each is stored, the interceptor attaching the header, and the silent refresh.

⭐ It's the study-artifact idea applied to the UI: the page **explains itself** while you use it, so the auth flow is legible from the browser, not just from the source.

## Pre-filled credentials

```js
const [email, setEmail] = useState('demo@example.com');
const [password, setPassword] = useState('Password123');
```

Convenience for a study repo — you can log in with one click after seeding. ⚠️ **Obviously not something to ship**: a pre-filled password field is a credential in your bundle and would be flagged by any review.

## Interview questions

- **"Should a login error say which field was wrong?"** → No — user enumeration. And note the client must not infer a more specific message either.
- **"Where does the user land after logging in?"** → Their intended destination, stashed in navigation state by the guard.
- **"Why `replace` on the post-login navigate?"** → So Back doesn't return to the login page.
- **"What does `autoComplete="current-password"` do?"** → Tells password managers which field this is; the wrong token breaks autofill.
- **"Controlled or uncontrolled for a login form?"** → Controlled — you need the values for the disabled state.

## Related

- [`routes/ProtectedRoute.jsx`](../routes/ProtectedRoute.jsx.md) — sets `location.state.from`
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — the `login` action
- [`server/controllers/authController.js`](../../../server/controllers/authController.js.md) — enumeration and timing defences
- [`RegisterPage.jsx`](./RegisterPage.jsx.md) — the sibling, with live validation
