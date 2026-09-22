# `server/utils/asyncHandler.js`

> A four-line wrapper that prevents every async route handler in the app from hanging on error.

**Lines:** 51 · **Concept blocks:** 1 · **Dependencies:** none

## The whole implementation

```js
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
```

## ⭐ Why it exists

**THE classic Express gotcha.** Express 4's router **does not understand promises**. If an async route handler rejects:

- Express never sees the error
- `next(err)` is never called
- **The request HANGS** until the client times out
- Your [error middleware](../middleware/errorHandler.js.md) never runs

No stack trace, no 500, no log entry. Just a request that never completes — which is far harder to debug than a crash.

### Two follow-ups worth knowing

**"Isn't this fixed in Express 5?"** → Yes. Express 5 awaits handler return values and forwards rejections automatically, making the wrapper unnecessary. **This project uses Express 4, where it IS necessary.** Knowing both is the complete answer.

**"Why not a global `unhandledRejection` handler?"** → By then you've **lost the `req`/`res` pair** and cannot send a response. You'd log the error and still leave the client hanging.

## How it works

`Promise.resolve()` normalises both cases:

| `fn` is | What happens |
|---|---|
| `async` | Returns a promise; `.catch(next)` forwards any rejection |
| A **sync** function that throws | The throw happens *inside* the `Promise.resolve()` call and becomes a rejection |

⭐ So **sync and async failures take the identical path** — one wrapper covers both.

## The comparison

**Without it** — boilerplate in every handler:

```js
router.get('/tasks', async (req, res, next) => {
  try {
    const tasks = await Task.find();
    res.json(tasks);
  } catch (err) {
    next(err);          // ← forget this line and the request hangs
  }
});
```

**With it:**

```js
router.get('/tasks', asyncHandler(async (req, res) => {
  res.json(await Task.find());
}));
```

The problem isn't the typing — it's that **you have to remember `next(err)` in every single catch block**, and the one you forget fails silently.

## Usage

Every async handler in the project is wrapped. Grep for it:

```bash
grep -rn "asyncHandler" server/controllers server/middleware | wc -l
```

Note it's also used on **middleware** (`verifyAccessToken`, `requireOwnership`), not just route handlers — middleware can be async too, with the same failure mode.

## Interview questions

- **"An async route handler throws. What does the client see?"** → Nothing — the request hangs. Express 4 doesn't catch promise rejections.
- **"How do you avoid try/catch in every handler?"** → This wrapper. Explain `Promise.resolve` normalising sync throws too.
- **"Is this still needed in Express 5?"** → No, and saying so is the better answer — it shows you know *why* the pattern exists rather than cargo-culting it.
- **"Why not handle it globally with `unhandledRejection`?"** → No access to `req`/`res`; you can log but not respond.
- **"What's the difference between this and a try/catch?"** → None functionally. It's about making the correct behaviour the *default* rather than something you must remember 40 times.

## Related

- [`middleware/errorHandler.js`](../middleware/errorHandler.js.md) — where `next(err)` lands, and the 4-arg signature
- [`utils/ApiError.js`](./ApiError.js.md) — what handlers throw
- [`controllers/`](../controllers/README.md) — every consumer
