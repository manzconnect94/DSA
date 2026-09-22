# `client/src/api/axiosClient.js`

> ⭐ The frontend mirror of the backend auth flow. Contains the single most subtle bug-fix in the project.

**Lines:** 208 · **Concept blocks:** 6

## The two interceptors

| Interceptor | Job |
|---|---|
| **Request** | Attach `Authorization: Bearer <token>` to every outgoing request. Without it you'd write that header by hand at ~40 call sites and forget it at three. |
| **Response** | Catch `401 TOKEN_EXPIRED`, silently call `/auth/refresh`, and **replay** the original request with the new token. The user never notices their token expired. |

That's what "seamless session" actually means in implementation terms.

## ⭐ The hard part: five parallel requests all 401 at once

**The question interviewers probe.** A naive implementation sends **five simultaneous refresh calls**. And because the server implements [refresh token **rotation**](../../../server/controllers/authController.js.md):

```
request A → 401 → refresh #1 → ✅ token rotated
request B → 401 → refresh #2 → presents the now-REVOKED token
                             → 🚨 REUSE DETECTED
                             → the entire token family is revoked
                             → the user is logged out
```

⭐ **Your "seamless refresh" has become a random logout bug that only reproduces under concurrency** — i.e. on any page that makes several API calls at once. The kind of bug that takes days to find.

### ✅ The fix: a single-flight queue

```js
let refreshPromise = null;

if (!refreshPromise) {
  refreshPromise = axios.post('/api/auth/refresh', {}, { withCredentials: true })
    .then(res => { setAccessToken(res.data.data.accessToken); return res.data.data.accessToken; })
    .finally(() => { refreshPromise = null; });
}
const newToken = await refreshPromise;      // ← everyone awaits the SAME promise
```

The first 401 **starts** the refresh; every subsequent 401 **queues** on that same promise, then replays with the token it produced. **Ten parallel 401s → exactly ONE call to `/auth/refresh`.**

⚠️ **`.finally()` matters:** on *failure* we must also reset `refreshPromise`, or the app is **permanently stuck** awaiting a rejected promise — every future request fails forever.

## ⭐ Two guards, both essential

```js
const shouldTryRefresh =
  status === 401 &&
  errorCode === 'TOKEN_EXPIRED' &&        // guard 1
  !originalRequest._retry &&              // guard 2
  !originalRequest.url?.includes('/auth/refresh');
```

| Guard | Why |
|---|---|
| **The error code** | A 401 from a **forged** token (`TOKEN_INVALID`) or a **deleted** user (`USER_DELETED`) will **never** be fixed by refreshing. Retrying is pointless work that hides the real problem. ⭐ **This is exactly why the backend returns distinct codes** rather than a generic 401 — see [`middleware/auth.js`](../../../server/middleware/auth.js.md). |
| **The `_retry` flag** | Without it, a request that 401s → refreshes → retries → **401s again** will refresh and retry **forever**: an infinite loop that hammers your auth endpoint and freezes the browser tab. Marking the request gives each one exactly **one** second chance. |

The third condition prevents the refresh call refreshing itself — guaranteed recursion.

## `withCredentials: true`

By default `fetch` and axios do **not** send cookies on cross-origin requests. This opts in — and it's what makes the httpOnly refresh cookie reach `/auth/refresh` at all.

⚠️ **The #1 cause of "my refresh endpoint says no cookie provided."**

⚠️ It also has a **server-side requirement**: the API must respond with `Access-Control-Allow-Credentials: true` **and a specific origin** (never a wildcard). See the [CORS block](../../../server/app.js.md) — the two settings are a matched pair, which is why the server keeps an explicit allowlist.

## The token lives in memory

```js
let accessToken = null;
export function setAccessToken(token) { accessToken = token; }
```

⭐ A module-scope variable is **not reachable by an XSS payload** the way `localStorage.getItem('token')` is, and it's wiped when the tab closes.

⚠️ **The trade-off:** it's also wiped on every page **refresh**. That's not a bug — it's why the app calls `/auth/refresh` on boot (see [`AuthContext`](../context/AuthContext.jsx.md)). The httpOnly cookie survives the reload and silently re-issues an access token.

⭐ **That handshake is the entire reason the two-token design exists on the client side.** Full storage trade-offs: [`server/utils/tokens.js`](../../../server/utils/tokens.js.md).

## `extractErrorMessage`

Normalises the backend's error envelope once, so components don't each contain:

```js
err.response?.data?.error?.message ?? err.message ?? 'Something went wrong'
```

It also flattens validation `details` (an array of `{field, message}`) into a readable string, and surfaces a friendly network-error message when there's **no response at all** (network failure, timeout, or a CORS rejection — worth distinguishing, because a CORS problem looks like a network error to JS).

## Interview questions

- **"How do you transparently refresh an expired token?"** → A response interceptor that catches 401, refreshes, and replays. Then immediately raise the concurrency problem — that's the answer that stands out.
- **"Five requests 401 simultaneously. What happens?"** → Without single-flight: five refresh calls, rotation detects reuse, the user is logged out at random.
- **"How do you prevent an infinite refresh loop?"** → A `_retry` flag per request, and never refresh the refresh call.
- **"Why not refresh on every 401?"** → A forged token or deleted user can't be fixed by refreshing. Branch on the error code.
- **"My cookie isn't being sent."** → `withCredentials` on the client **and** `Access-Control-Allow-Credentials` + a specific origin on the server.
- **"Why not localStorage?"** → XSS can read it. Memory for the access token, httpOnly for the refresh token.

## Related

- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — the boot refresh and the failure callback
- [`server/controllers/authController.js`](../../../server/controllers/authController.js.md) — rotation and reuse detection
- [`server/middleware/auth.js`](../../../server/middleware/auth.js.md) — the distinct error codes this branches on
- [`server/utils/tokens.js`](../../../server/utils/tokens.js.md) — storage trade-offs
- [`server/app.js`](../../../server/app.js.md) — the matching CORS config
