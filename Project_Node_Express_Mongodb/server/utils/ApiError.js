// ============================================================
// 🧠 CONCEPT: Operational errors vs programmer errors
// WHY IT MATTERS (interview angle): a top-tier answer to "how do you handle
//   errors in Node?" distinguishes the two:
//   • OPERATIONAL error — an expected failure in a correct program: bad
//     input, 404, expired token, DB timeout. Handle it, return a clean HTTP
//     status, keep the process alive.
//   • PROGRAMMER error — a bug: `undefined is not a function`, a typo. You
//     cannot meaningfully recover, because the process is in an unknown
//     state. Log it, return a generic 500, and (in production) let the
//     process restart under a supervisor.
//   Conflating the two is why you see apps that swallow real bugs.
// HOW IT WORKS HERE: ApiError marks `isOperational = true`. The error
//   middleware uses that flag to decide whether to leak the real message to
//   the client or replace it with "Internal server error".
// ============================================================

class ApiError extends Error {
  constructor(statusCode, message, { code = undefined, details = undefined, isOperational = true } = {}) {
    super(message);

    // ============================================================
    // 🧠 CONCEPT: Extending built-in Error correctly
    // WHY IT MATTERS (interview angle): subclassing Error is a classic
    //   gotcha. `Error.captureStackTrace` removes the constructor frame so
    //   the stack points at the throw site, not at this file. `this.name`
    //   must be set manually or it stays "Error".
    // HOW IT WORKS HERE: both are done below.
    // ============================================================
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }

  // Static factories keep call sites readable: ApiError.notFound('Task')
  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, { code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'Authentication required') {
    // 401 means "I don't know who you are" (authentication failed).
    return new ApiError(401, message, { code: 'UNAUTHENTICATED' });
  }

  static forbidden(message = 'You do not have permission to do that') {
    // 403 means "I know who you are, and you still can't" (authorization).
    // Mixing up 401 and 403 is a favourite interview nitpick.
    return new ApiError(403, message, { code: 'FORBIDDEN' });
  }

  static notFound(resource = 'Resource') {
    return new ApiError(404, `${resource} not found`, { code: 'NOT_FOUND' });
  }

  static conflict(message = 'Resource already exists') {
    return new ApiError(409, message, { code: 'CONFLICT' });
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message, { code: 'RATE_LIMITED' });
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, message, { code: 'INTERNAL', isOperational: false });
  }
}

module.exports = ApiError;
