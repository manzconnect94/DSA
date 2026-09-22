// ============================================================
// 🧠 CONCEPT: Centralised async error handling (the asyncHandler wrapper)
// WHY IT MATTERS (interview angle): THE classic Express gotcha. Express 4's
//   router does not understand promises. If an async route handler rejects,
//   Express never sees the error — `next(err)` is never called — so the
//   request HANGS until the client times out, and your error middleware
//   never runs. Without this wrapper you must write try/catch in every
//   single handler and remember `next(err)` in every catch block.
//
//   Two follow-ups worth knowing:
//   • "Isn't this fixed in Express 5?" Yes — Express 5 awaits handler return
//     values and forwards rejections automatically, making this wrapper
//     unnecessary. This project uses Express 4, where it IS necessary.
//   • "Why not just add a global unhandledRejection handler?" Because by
//     then you've lost the req/res pair and cannot send a response.
//
// HOW IT WORKS HERE: asyncHandler takes an async fn and returns a normal
//   Express handler. Promise.resolve() normalises both sync and async fns,
//   and .catch(next) funnels every rejection into the error middleware.
// ============================================================

/**
 * @param {Function} fn - async (req, res, next) => ...
 * @returns {Function} an Express-compatible handler that can never leave a
 *                     rejected promise unhandled.
 */
const asyncHandler = (fn) => (req, res, next) => {
  // Promise.resolve() handles the case where `fn` is a plain sync function
  // that throws — the throw happens inside the resolve() call and becomes a
  // rejection, so sync and async failures take the identical path.
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ------------------------------------------------------------
// The equivalent WITHOUT the wrapper, for direct comparison.
// Every handler in the app would need this boilerplate:
//
//   router.get('/tasks', async (req, res, next) => {
//     try {
//       const tasks = await Task.find();
//       res.json(tasks);
//     } catch (err) {
//       next(err);          // <- forget this line and the request hangs
//     }
//   });
//
// With the wrapper:
//
//   router.get('/tasks', asyncHandler(async (req, res) => {
//     res.json(await Task.find());
//   }));
// ------------------------------------------------------------

module.exports = asyncHandler;
