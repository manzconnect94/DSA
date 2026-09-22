// ============================================================
// 🧠 CONCEPT: Axios interceptors — the frontend mirror of the backend auth
// WHY IT MATTERS (interview angle): this file is the client-side half of
//   the JWT flow in server/controllers/authController.js, and being able to
//   describe BOTH halves is what makes the answer complete.
//
//   TWO INTERCEPTORS, two jobs:
//
//   1. REQUEST INTERCEPTOR — attach `Authorization: Bearer <token>` to
//      every outgoing request. Without it you would write that header by
//      hand at ~40 call sites and forget it at three of them.
//
//   2. RESPONSE INTERCEPTOR — catch 401 TOKEN_EXPIRED, silently call
//      /api/auth/refresh, and REPLAY the original request with the new
//      token. The user never notices their token expired. This is what
//      "seamless session" actually means in implementation terms.
//
//   ⭐ THE HARD PART, and the thing interviewers probe: what happens when
//   FIVE requests fire in parallel and ALL of them 401 at once? A naive
//   implementation sends five simultaneous refresh calls. With refresh
//   token ROTATION on the server, the first one succeeds and rotates the
//   token — so the other four present an already-revoked token, the server
//   detects reuse, and it REVOKES THE ENTIRE FAMILY and logs the user out.
//   Your "seamless refresh" has become a random logout bug that only
//   reproduces under concurrency.
//
//   THE FIX IS A SINGLE-FLIGHT QUEUE: the first 401 starts the refresh;
//   every subsequent 401 QUEUES and waits on that same promise, then
//   replays with the token it produced. Implemented below.
//
// HOW IT WORKS HERE: the access token lives in a module variable (memory,
//   not localStorage — see the storage trade-offs in server/utils/tokens.js)
//   and the refresh token is an httpOnly cookie the browser sends for us.
// ============================================================

import axios from 'axios';

// ============================================================
// 🧠 CONCEPT: The access token lives in MEMORY, not localStorage
// WHY IT MATTERS (interview angle): a module-scope variable is not
//   reachable by an XSS payload the way `localStorage.getItem('token')` is,
//   and it is wiped when the tab closes.
//   ⚠️ THE TRADE-OFF: it is also wiped on every page REFRESH. That is not
//   a bug — it is why the app calls /api/auth/refresh on boot (see
//   AuthContext). The httpOnly refresh cookie survives the reload and
//   silently re-issues an access token. That handshake is the entire reason
//   the two-token design exists on the client side.
// ============================================================
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function clearAccessToken() {
  accessToken = null;
}

// A callback the AuthContext registers so the interceptor can force a
// logout without importing React state (which would be a circular import).
let onAuthFailure = () => {};
export function registerAuthFailureHandler(fn) {
  onAuthFailure = fn;
}

const axiosClient = axios.create({
  baseURL: '/api', // the Vite dev proxy forwards this to :5000
  timeout: 20_000,

  // ============================================================
  // 🧠 CONCEPT: withCredentials
  // WHY IT MATTERS (interview angle): by default, fetch and axios do NOT
  //   send cookies on cross-origin requests. `withCredentials: true` opts
  //   in — and it is what makes the httpOnly refresh cookie reach
  //   /api/auth/refresh at all. Forgetting this is the #1 cause of "my
  //   refresh endpoint says no cookie provided".
  //   ⚠️ It also has a server-side requirement: the API must respond with
  //   `Access-Control-Allow-Credentials: true` AND a SPECIFIC origin (never
  //   a wildcard). See the CORS block in server/app.js — the two settings
  //   are a matched pair.
  // ============================================================
  withCredentials: true,

  headers: { 'Content-Type': 'application/json' },
});

// ------------------------------------------------------------------
// REQUEST INTERCEPTOR
// ------------------------------------------------------------------
axiosClient.interceptors.request.use(
  (config) => {
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    // Attach a correlation id so a frontend error can be matched to a
    // backend log line. See middleware/requestLogger.js.
    config.metadata = { startedAt: performance.now() };
    return config;
  },
  (error) => Promise.reject(error)
);

// ------------------------------------------------------------------
// RESPONSE INTERCEPTOR — with single-flight refresh
// ------------------------------------------------------------------

// The in-flight refresh promise. null when no refresh is happening.
let refreshPromise = null;

axiosClient.interceptors.response.use(
  (response) => {
    // Useful for the perf demos: surface how long the round-trip took.
    if (response.config.metadata) {
      response.durationMs = Math.round(performance.now() - response.config.metadata.startedAt);
    }
    return response;
  },

  async (error) => {
    const originalRequest = error.config;

    // No response at all = network failure, timeout, or CORS rejection.
    if (!error.response) {
      return Promise.reject(
        Object.assign(error, { friendlyMessage: 'Network error — is the API server running on :5000?' })
      );
    }

    const { status, data } = error.response;
    const errorCode = data?.error?.code;

    // ============================================================
    // 🧠 CONCEPT: Only refresh on TOKEN_EXPIRED, and only ONCE
    // WHY IT MATTERS (interview angle): two guards, both essential.
    //
    //   GUARD 1 — the error code. A 401 from a FORGED token
    //   (TOKEN_INVALID) or a DELETED user (USER_DELETED) will never be
    //   fixed by refreshing. Retrying those is pointless work, and it hides
    //   the real problem from the user. This is exactly why the backend
    //   returns distinct codes rather than a generic 401 — see
    //   server/middleware/auth.js.
    //
    //   GUARD 2 — the `_retry` flag. Without it, a request that 401s,
    //   refreshes, retries, and 401s AGAIN will refresh and retry forever:
    //   an INFINITE LOOP that hammers your auth endpoint and freezes the
    //   browser tab. Marking the request means each one gets exactly one
    //   second chance.
    // ============================================================
    const shouldTryRefresh =
      status === 401 &&
      errorCode === 'TOKEN_EXPIRED' &&
      !originalRequest._retry &&
      // Never try to refresh the refresh call itself — guaranteed recursion.
      !originalRequest.url?.includes('/auth/refresh');

    if (!shouldTryRefresh) {
      // A 401 we cannot fix means the session is genuinely over.
      if (status === 401 && !originalRequest.url?.includes('/auth/')) {
        clearAccessToken();
        onAuthFailure();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      // ============================================================
      // 🧠 CONCEPT: Single-flight — the concurrency fix
      // WHY IT MATTERS (interview angle): the core of this file. If a
      //   refresh is already running, we do NOT start another; we await the
      //   SAME promise. Ten parallel 401s therefore produce exactly ONE
      //   call to /api/auth/refresh, and all ten then retry with the single
      //   new token.
      //   Without this, refresh-token rotation + concurrent requests =
      //   reuse detection = the whole family revoked = a mysterious random
      //   logout that only happens on pages making several API calls at
      //   once. It is the kind of bug that takes days to find.
      // ============================================================
      if (!refreshPromise) {
        refreshPromise = axios
          .post('/api/auth/refresh', {}, { withCredentials: true })
          .then((res) => {
            const newToken = res.data.data.accessToken;
            setAccessToken(newToken);
            return newToken;
          })
          .finally(() => {
            // Clear it so the NEXT expiry can start a fresh refresh.
            // `finally` matters: on failure we must also reset, or the app
            // is permanently stuck awaiting a rejected promise.
            refreshPromise = null;
          });
      }

      const newToken = await refreshPromise;

      // Replay the original request with the new credential.
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return axiosClient(originalRequest);
    } catch (refreshError) {
      // The refresh token is expired, revoked, or reuse was detected.
      // There is no recovery — the user must log in again.
      clearAccessToken();
      onAuthFailure();
      return Promise.reject(refreshError);
    }
  }
);

// ============================================================
// 🧠 CONCEPT: A normalised error shape for the UI
// WHY IT MATTERS (interview angle): components should not each contain
//   `err.response?.data?.error?.message ?? err.message ?? 'Something went
//   wrong'`. Normalising once here means the UI layer handles one shape,
//   and changing the backend's error format is a one-file change.
// ============================================================
export function extractErrorMessage(error) {
  if (error?.friendlyMessage) return error.friendlyMessage;

  const apiError = error?.response?.data?.error;
  if (apiError?.details?.length) {
    // Validation errors arrive as an array of { field, message }.
    return apiError.details.map((d) => `${d.field}: ${d.message}`).join(', ');
  }
  return apiError?.message || error?.message || 'Something went wrong';
}

export default axiosClient;
