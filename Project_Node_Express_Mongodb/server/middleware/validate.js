// ============================================================
// 🧠 CONCEPT: Input validation & sanitisation at the boundary
// WHY IT MATTERS (interview angle): the foundational security rule is
//   "NEVER TRUST CLIENT INPUT". Not the body, not the query string, not the
//   headers, not even fields your own frontend controls — anyone can curl
//   your API directly, and your frontend validation is a UX feature, not a
//   security control.
//
//   VALIDATION vs SANITISATION (the distinction they're checking for):
//   • VALIDATION   — REJECT bad input. "email must look like an email."
//                    Fail closed with a 400.
//   • SANITISATION — TRANSFORM input into something safe. Trim whitespace,
//                    lowercase the email, strip HTML tags, cast "5" -> 5.
//   You want both, and validation should run on the sanitised value.
//
//   WHERE TO VALIDATE: at the edge, before any business logic touches the
//   data. By the time a value reaches your controller it should already be
//   known-good — that is what makes the controller simple.
//
// HOW IT WORKS HERE: express-validator chains declared per route, plus a
//   shared `handleValidation` middleware that turns any failures into one
//   consistent 400. Zod would be the modern alternative — see the note at
//   the bottom.
// ============================================================

const { body, param, query, validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');
const { STATUSES, PRIORITIES } = require('../models/Task');

// ============================================================
// 🧠 CONCEPT: Collect ALL errors, not just the first
// WHY IT MATTERS (interview angle): a UX point with a security edge.
//   Returning one error at a time forces the user through five round-trips
//   to fix a five-field form. Returning all of them at once lets the client
//   highlight every bad field immediately. express-validator accumulates
//   results on `req` and this middleware drains them in one go.
// ============================================================
function handleValidation(req, _res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const details = result.array().map((e) => ({
    field: e.path || e.param,
    message: e.msg,
    // ⚠️ We deliberately do NOT echo back `e.value`. Reflecting raw user
    // input in a response is how reflected XSS happens if that response is
    // ever rendered into a page, and it can leak a mistyped password.
  }));

  return next(ApiError.badRequest('Validation failed', details));
}

// ============================================================
// 🧠 CONCEPT: NoSQL INJECTION — the MongoDB equivalent of SQLi
// WHY IT MATTERS (interview angle): candidates often say "MongoDB doesn't
//   have SQL injection", which is true and beside the point. MongoDB has its
//   OWN injection class, and it is arguably easier to exploit.
//
//   ❌ THE ATTACK — an operator smuggled in as a JSON value:
//
//     // Your login code, which looks completely reasonable:
//     const user = await User.findOne({ email: req.body.email });
//
//     // An attacker POSTs this JSON body instead of a string email:
//     { "email": { "$ne": null }, "password": { "$ne": null } }
//
//     // req.body.email is now an OBJECT, not a string, so the query becomes:
//     User.findOne({ email: { $ne: null } })
//
//     // ...which matches the FIRST USER IN THE COLLECTION — frequently the
//     // admin account. Authentication bypassed, no password needed.
//
//   Variants: `{"$gt": ""}` does the same thing. `$regex` lets an attacker
//   extract a password character by character. `$where` executes arbitrary
//   JavaScript on the database server, which is total compromise (disable
//   it; it's off by default on modern Atlas).
//
//   WHY IT HAPPENS: `express.json()` parses the body into rich JS types.
//   Nothing forces `email` to be a string, and the MongoDB driver treats a
//   nested object as a query operator, exactly as designed.
//
//   ✅ FOUR LAYERS OF DEFENCE, in order of importance:
//
//   1. TYPE-VALIDATE EVERY INPUT (the real fix, and what we do below).
//      `body('email').isEmail()` fails immediately on a non-string, so the
//      object never reaches the query. Validation IS injection defence.
//
//   2. COERCE EXPLICITLY at the query site: `String(req.body.email)`.
//      An object stringifies to "[object Object]", which matches nothing.
//      Cheap belt-and-braces — see User.findByEmail in models/User.js.
//
//   3. MONGOOSE SCHEMA CASTING helps but is NOT sufficient. Mongoose casts
//      values to the schema type for a field declared `String`, which
//      defeats the basic case. It does NOT protect a raw driver call, an
//      aggregation pipeline, or a field you pass through `$where`, and
//      `strictQuery` behaviour varies by version. Never rely on it alone.
//
//   4. STRIP KEYS BEGINNING WITH `$` OR CONTAINING `.` from user input —
//      what express-mongo-sanitize does. Included below as sanitizeMongo so
//      the mechanism is visible rather than hidden in a dependency.
//
// HOW IT WORKS HERE: layer 1 via the chains below, layer 2 in the models,
//   layer 4 via the app-wide sanitizeMongo middleware.
// ============================================================

/**
 * Recursively remove keys that begin with `$` or contain `.` from an object.
 * This is a hand-rolled express-mongo-sanitize so the logic is inspectable.
 */
function stripMongoOperators(value, depth = 0) {
  // Bound the recursion: a deeply nested payload is itself a DoS vector
  // (an attacker sends 10,000 levels of nesting and burns your stack/CPU).
  if (depth > 10 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => stripMongoOperators(v, depth + 1));
  }

  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    // `$ne`, `$gt`, `$where` — operator injection.
    // `a.b` — dotted keys can reach into nested document paths.
    if (key.startsWith('$') || key.includes('.')) continue;

    // ============================================================
    // 🧠 CONCEPT: Prototype pollution
    // WHY IT MATTERS (interview angle): a related injection class. If an
    //   attacker can set the key `__proto__` or `constructor.prototype` on
    //   an object you later merge, they can add properties to
    //   Object.prototype itself — affecting EVERY object in the process.
    //   Classic escalation: set `__proto__.isAdmin = true` and suddenly
    //   every object in your app reports isAdmin. Strip these keys too.
    // ============================================================
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

    clean[key] = stripMongoOperators(val, depth + 1);
  }
  return clean;
}

function sanitizeMongo(req, _res, next) {
  // ⚠️ In Express 5, req.query is a getter with no setter — reassigning it
  // throws. Mutating in place works in both 4 and 5.
  if (req.body && typeof req.body === 'object') {
    req.body = stripMongoOperators(req.body);
  }
  if (req.params && typeof req.params === 'object') {
    Object.assign(req.params, stripMongoOperators(req.params));
  }
  if (req.query && typeof req.query === 'object') {
    const cleaned = stripMongoOperators(req.query);
    for (const key of Object.keys(req.query)) {
      if (!(key in cleaned)) delete req.query[key];
    }
    Object.assign(req.query, cleaned);
  }
  return next();
}

// ------------------------------------------------------------------
// Validation chains — declared per route
// ------------------------------------------------------------------

const registerValidation = [
  body('name')
    .trim() // SANITISE first...
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 80 }) // ...then VALIDATE the sanitised value
    .withMessage('Name must be 2-80 characters'),
// ⚠️ Deliberately NO .escape() — see the "escape on OUTPUT, not INPUT"
// concept block further down this file. A user named O'Brien should be
// stored as O'Brien, not O&#x27;Brien.

  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email is required')
    // ============================================================
    // 🧠 CONCEPT: normalizeEmail() and its sharp edge
    // WHY IT MATTERS (interview angle): it lowercases the domain and, by
    //   default, strips dots and +tags from Gmail addresses, so
    //   `Bob.Smith+news@Gmail.com` becomes `bobsmith@gmail.com`. That
    //   prevents one person farming unlimited accounts from one mailbox.
    //   ⚠️ But it is LOSSY: users who genuinely rely on +tags for filtering
    //   will find their stored address doesn't match what they typed, and
    //   "forgot password" emails go to a different string than they expect.
    //   Know that you are making a trade, and be consistent — normalise at
    //   registration AND login or the two will never match.
    // ============================================================
    .normalizeEmail({ gmail_remove_dots: false })
    .isLength({ max: 254 }) // RFC 5321 maximum
    .withMessage('Email is too long'),

  body('password')
    // NOTE: no .trim() on passwords. Trimming silently changes the user's
    // credential, and a leading/trailing space is a legitimate character.
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be 8-128 characters')
    // ============================================================
    // 🧠 CONCEPT: Password policy — and why the old rules were wrong
    // WHY IT MATTERS (interview angle): NIST SP 800-63B (2017) explicitly
    //   RECOMMENDS AGAINST mandatory composition rules and forced periodic
    //   rotation. Why: complexity rules push users toward predictable
    //   patterns (Password1!) and forced rotation produces Password1! ->
    //   Password2!. What NIST recommends instead is length (8 minimum, 64+
    //   allowed), screening against known-breached password lists (the
    //   HaveIBeenPwned k-anonymity API is free and does this without ever
    //   sending the password), and MFA.
    //   ⚠️ An upper bound matters too: bcrypt SILENTLY TRUNCATES INPUT AT
    //   72 BYTES. Without a max length, a user's 200-character passphrase
    //   is only protected by its first 72 bytes — and if you ever migrate
    //   away from bcrypt, their "strong" password was never what they
    //   thought. (Hash with SHA-256 first if you need unbounded length.)
    //   The rule below is deliberately mild and is here to show the shape
    //   of the trade-off, not because it is best practice.
    // ============================================================
    .matches(/[a-zA-Z]/)
    .withMessage('Password must contain at least one letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one digit'),

  // ============================================================
  // 🧠 CONCEPT: MASS ASSIGNMENT / over-posting
  // WHY IT MATTERS (interview angle): a vulnerability created by convenience.
  //
  //   ❌ const user = await User.create(req.body);
  //
  //   Looks clean. But the attacker POSTs:
  //     { "name":"x", "email":"x@y.z", "password":"...", "role":"admin" }
  //   and creates themselves an ADMIN ACCOUNT. This is the bug that let
  //   someone commit to the Rails repo on GitHub in 2012.
  //
  //   ✅ Two fixes, and you want both:
  //   1. ALLOWLIST the fields at the controller — explicitly pick
  //      { name, email, password } out of the body. Never spread req.body
  //      into a model. (Allowlist, not denylist: a denylist misses the next
  //      sensitive field someone adds.)
  //   2. REJECT unexpected fields at validation, as below, so a client
  //      sending `role` gets a clear 400 rather than silent stripping —
  //      which also surfaces the attempt in your logs.
  // ============================================================
  body('role')
    .not()
    .exists()
    .withMessage('role cannot be set during registration'),
  body('isActive').not().exists().withMessage('isActive cannot be set during registration'),

  handleValidation,
];

const loginValidation = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail({ gmail_remove_dots: false }),
  // `isString()` is the anti-NoSQL-injection check: it rejects
  // { "$ne": null } outright, because that is an object, not a string.
  body('password').isString().withMessage('Password is required').notEmpty().withMessage('Password is required'),
  handleValidation,
];

// ============================================================
// 🧠 CONCEPT: ⚠️ ESCAPE ON OUTPUT, NOT ON INPUT
// WHY IT MATTERS (interview angle): a mistake I made while building this
//   file, caught by a test — which makes it a better lesson than if I'd
//   got it right first time.
//
//   The original version called `.escape()` on the title. A test then
//   asserted a stored title of "Alice's private task" and got back
//   "Alice&#x27;s private task". The data was CORRUPTED at rest.
//
//   ⭐ WHY INPUT-ESCAPING IS AN ANTI-PATTERN:
//   1. IT DESTROYS DATA. The user typed an apostrophe. You stored an HTML
//      entity. Now your search doesn't match, your CSV export is wrong,
//      your email templates show &#x27;, and length limits count the wrong
//      number of characters.
//   2. IT DOUBLE-ESCAPES. Render `&#x27;` in a template that escapes on
//      output (which any modern one does) and the user sees the literal
//      text "&#x27;". Everyone has seen this bug on a real website.
//   3. ⭐ IT ESCAPES FOR THE WRONG CONTEXT. Escaping is
//      CONTEXT-DEPENDENT: HTML body, HTML attribute, JavaScript string,
//      URL parameter, CSS and SQL all need DIFFERENT escaping. At input
//      time you do not yet know where the value will be rendered — so any
//      choice you make is wrong somewhere. HTML-escaping a value that
//      later goes into a URL provides no protection at all.
//
//   ✅ THE CORRECT MODEL: store the user's ACTUAL input (validated for
//   type, length and shape — which we still do), then escape at the
//   moment of RENDERING, for the specific context.
//
//   In this stack that is already handled:
//   • React escapes by default when you write {task.title} in JSX. You
//     would have to deliberately use dangerouslySetInnerHTML to create an
//     XSS hole — hence the name.
//   • The CSV export escapes for CSV context (and neutralises formula
//     injection) at write time — see taskController.js.
//   • Mongoose parameterises queries, so injection is handled separately
//     by the type validation above.
//
//   The ONE case for sanitising at input is when you accept genuine RICH
//   TEXT that will be rendered as HTML. Then you do not "escape" — you
//   SANITISE with an allowlist parser (DOMPurify, sanitize-html) that
//   keeps <b> and <a href> while stripping <script> and onerror=. That is
//   a different operation from escaping, and it is the only time input-time
//   transformation is right.
// ============================================================
const createTaskValidation = [
  // Note: NO .escape(). We validate type and length, and store what the
  // user actually typed.
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('status').optional().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  body('priority').optional().isIn(PRIORITIES).withMessage(`priority must be one of: ${PRIORITIES.join(', ')}`),
  body('dueDate').optional({ nullable: true }).isISO8601().withMessage('dueDate must be an ISO 8601 date').toDate(),
  body('tags').optional().isArray({ max: 10 }).withMessage('At most 10 tags'),
  body('tags.*').optional().isString().trim().isLength({ max: 30 }),
  body('estimatedHours').optional().isFloat({ min: 0, max: 1000 }).toFloat(),
  // Ownership is derived from the JWT, NEVER from the body — otherwise a
  // user could create tasks on someone else's behalf (mass assignment again).
  body('owner').not().exists().withMessage('owner is derived from your token'),
  handleValidation,
];

const updateTaskValidation = [
  param('id').isMongoId().withMessage('Invalid task id'),
  // No .escape() here either — see the escape-on-output block above.
  body('title').optional().trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('status').optional().isIn(STATUSES),
  body('priority').optional().isIn(PRIORITIES),
  body('dueDate').optional({ nullable: true }).isISO8601().toDate(),
  body('tags').optional().isArray({ max: 10 }),
  body('estimatedHours').optional().isFloat({ min: 0, max: 1000 }).toFloat(),
  body('owner').not().exists().withMessage('Ownership cannot be transferred via this endpoint'),
  handleValidation,
];

const mongoIdParamValidation = [param('id').isMongoId().withMessage('Invalid id'), handleValidation];

// ============================================================
// 🧠 CONCEPT: Validating pagination params is a DoS defence
// WHY IT MATTERS (interview angle): `?limit=1000000` on an unvalidated
//   endpoint makes your server load a million documents into memory,
//   serialise them to JSON, and very likely fall over. An unbounded `limit`
//   is a denial-of-service vector handed to every anonymous caller. Always
//   clamp it server-side — and note that `page=999999` is the other half of
//   the problem, which is precisely what the cursor-pagination demo in
//   controllers/taskController.js addresses.
// ============================================================
const listTasksValidation = [
  query('page').optional().isInt({ min: 1, max: 100000 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100').toInt(),
  query('status').optional().isIn(STATUSES),
  query('priority').optional().isIn(PRIORITIES),
  query('search').optional().trim().isLength({ max: 100 }),
  query('sort').optional().isIn(['createdAt', '-createdAt', 'dueDate', '-dueDate', 'priority', '-priority']),
  query('cursor').optional().isMongoId().withMessage('cursor must be a valid id'),
  handleValidation,
];

// ============================================================
// 🧠 CONCEPT: express-validator vs Zod — the modern alternative
// WHY IT MATTERS (interview angle): worth being able to compare them.
//   • express-validator: middleware-chain style, mutates req, Express-native,
//     great for incremental adoption. Weakness — the schema lives in the
//     route layer and gives you no TypeScript types.
//   • Zod: declare a schema ONCE, get runtime validation AND a static
//     TypeScript type from it via z.infer. One source of truth for the
//     shape, shareable between client and server. This is why Zod has taken
//     over in TS codebases.
//
//   The Zod equivalent of registerValidation:
//
//     const registerSchema = z.object({
//       name:     z.string().trim().min(2).max(80),
//       email:    z.string().trim().toLowerCase().email().max(254),
//       password: z.string().min(8).max(128),
//     }).strict();   // .strict() REJECTS unknown keys -> mass assignment fixed
//                    // structurally, for free, on every schema.
//
//     const validate = (schema) => (req, res, next) => {
//       const result = schema.safeParse(req.body);
//       if (!result.success) return next(ApiError.badRequest('Validation failed', result.error.issues));
//       req.body = result.data;   // now the PARSED, typed, stripped data
//       next();
//     };
//
//   Note `req.body = result.data` — you replace the body with the parsed
//   output, so downstream code can only see validated fields. That is a
//   stronger guarantee than express-validator's "inspect and report" model.
// ============================================================

module.exports = {
  handleValidation,
  sanitizeMongo,
  stripMongoOperators,
  registerValidation,
  loginValidation,
  createTaskValidation,
  updateTaskValidation,
  mongoIdParamValidation,
  listTasksValidation,
};
