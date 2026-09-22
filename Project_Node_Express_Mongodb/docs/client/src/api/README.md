# `client/src/api/`

> The single HTTP boundary. Every request in the app goes through here.

| File | Doc | Lines |
|---|---|---|
| `axiosClient.js` | [→](./axiosClient.js.md) | 208 |

## Why one file

Three concerns are centralised, and each would otherwise be duplicated at ~40 call sites:

| Concern | Without centralisation |
|---|---|
| **Attaching the auth token** | `headers: { Authorization: ... }` written by hand everywhere, and forgotten in three places |
| **Refreshing an expired token** | Every call site needs its own 401 → refresh → retry logic |
| **Normalising error shapes** | Every component contains `err.response?.data?.error?.message ?? err.message ?? 'Something went wrong'` |

⭐ It's also an **abstraction boundary**: swapping axios for `fetch`, or changing the backend's error envelope, is a one-file change.

## Where the token lives

```js
let accessToken = null;    // ← a module variable. Memory, not localStorage.
```

⭐ Not reachable by an XSS payload the way `localStorage.getItem('token')` is, and wiped when the tab closes. The trade-off — it's also wiped on **page refresh** — is handled by the boot refresh in [`AuthContext`](../context/AuthContext.jsx.md).

Full XSS-vs-CSRF reasoning: [`server/utils/tokens.js`](../../../server/utils/tokens.js.md).

## The callback registration pattern

```js
let onAuthFailure = () => {};
export function registerAuthFailureHandler(fn) { onAuthFailure = fn; }
```

The interceptor needs to force a logout when a refresh finally fails — but it **cannot import React state** without a circular dependency (`AuthContext` imports `axiosClient`, which would import `AuthContext`).

⭐ So `AuthContext` **registers a callback** on mount. This is dependency inversion in four lines: the low-level module declares *what* it needs, and the high-level module supplies it. A generally useful pattern whenever non-React code must trigger React state.

## Interview questions

- **"How do you attach an auth token to every request?"** → A request interceptor, so it's impossible to forget.
- **"Where should the token live?"** → Memory for the access token, httpOnly cookie for the refresh token. Neither localStorage.
- **"How does non-React code trigger a React state update?"** → Register a callback from within React, or use a store that lives outside React ([Zustand](../store/taskStore.js.md) can be called via `getState()`).

## Related

- [`axiosClient.js`](./axiosClient.js.md) — ⭐ the single-flight refresh
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — registers the failure handler
- [`server/controllers/authController.js`](../../../server/controllers/authController.js.md) — the server side of the same flow
