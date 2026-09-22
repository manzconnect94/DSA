# `server/utils/ApiError.js`

> A custom Error subclass carrying a status code and an `isOperational` flag.

**Lines:** 61 · **Concept blocks:** 2 · **Dependencies:** none

## ⭐ Operational vs programmer errors

A top-tier answer to "how do you handle errors in Node?" distinguishes the two:

| | **Operational** | **Programmer** |
|---|---|---|
| What | An **expected failure in a correct program**: bad input, 404, expired token, DB timeout | A **bug**: `undefined is not a function`, a typo |
| Recoverable? | Yes — handle it, return a clean status, keep the process alive | **No** — the process is in an unknown state |
| Response | The real message (you wrote it) | Generic "Internal server error" |
| Action | Log at `warn` | Log at `error`, and [exit on an uncaught one](../middleware/errorHandler.js.md) |
| Flag | `isOperational: true` | `false` |

⭐ **Conflating the two is why you see apps that swallow real bugs** — a catch-all that returns "something went wrong" for both a validation failure and a null-pointer dereference means you never find out about the second.

The flag is what [`errorHandler`](../middleware/errorHandler.js.md) uses to decide whether to leak the real message or replace it with a generic string in production.

## ⚠️ Extending built-in Error correctly

A classic gotcha — two things you must do manually:

```js
this.name = this.constructor.name;          // otherwise it stays "Error"
Error.captureStackTrace(this, this.constructor);  // removes the constructor frame
```

`captureStackTrace` makes the stack point at the **throw site**, not at this file. Without it, every stack trace in your app starts with `ApiError.js` — useless.

*(Also worth knowing: before ES6, subclassing Error required `Object.setPrototypeOf` gymnastics because `Error.call(this)` returned a new object rather than mutating `this`. Native classes fixed it, but transpiled-to-ES5 code can still hit it.)*

## Static factories

| Factory | Status | Code |
|---|---|---|
| `badRequest(msg, details)` | 400 | `BAD_REQUEST` |
| `unauthorized(msg)` | **401** | `UNAUTHENTICATED` |
| `forbidden(msg)` | **403** | `FORBIDDEN` |
| `notFound(resource)` | 404 | `NOT_FOUND` |
| `conflict(msg)` | 409 | `CONFLICT` |
| `tooManyRequests(msg)` | 429 | `RATE_LIMITED` |
| `internal(msg)` | 500 | `INTERNAL` (`isOperational: false`) |

They keep call sites readable: `throw ApiError.notFound('Task')`.

## ⭐ 401 vs 403 — a favourite nitpick

| | Means | Note |
|---|---|---|
| **401** Unauthorized | **"I don't know who you are"** — authentication failed | A **1990s HTTP spec misnomer**; it really means *unauthenticated*. The `code` here is `UNAUTHENTICATED` to be honest about it. |
| **403** Forbidden | **"I know exactly who you are, and you still can't"** — authorization failed | |

Mixing them up is a quick credibility hit. The practical difference for a **client**: 401 means "try authenticating / refresh the token"; 403 means **"don't bother, you'll never be allowed"**. Returning the wrong one sends the client into a pointless refresh loop. See [`middleware/auth.js`](../middleware/auth.js.md).

## The `code` field

A machine-readable string alongside the human message. It matters because the [client interceptor](../../client/src/api/axiosClient.js.md) **branches on it**: `TOKEN_EXPIRED` → refresh and retry; `TOKEN_INVALID` → log out. An undifferentiated 401 would force a refresh loop on a forged token.

## Interview questions

- **"How do you structure error handling in Node?"** → Distinguish operational from programmer errors; a custom Error class carrying status + flag; one central handler; exit on uncaught programmer errors.
- **"401 or 403?"** → I-don't-know-you vs I-know-you-and-no. Mention that 401's name is a spec mistake.
- **"Why subclass Error instead of throwing an object?"** → You keep the stack trace and `instanceof` checks. A thrown plain object has no stack, which makes debugging much harder.
- **"Why is `captureStackTrace` needed?"** → To remove the constructor frame so the stack points at the throw site.
- **"Why a `code` field as well as a message?"** → Messages are for humans and change freely; clients must branch on something stable.

## Related

- [`middleware/errorHandler.js`](../middleware/errorHandler.js.md) — consumes `isOperational` and `statusCode`
- [`utils/asyncHandler.js`](./asyncHandler.js.md) — how thrown errors reach the handler
- [`middleware/auth.js`](../middleware/auth.js.md) — the 401/403 distinction applied
