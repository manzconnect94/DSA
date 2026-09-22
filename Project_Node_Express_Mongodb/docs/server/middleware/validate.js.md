# `server/middleware/validate.js`

> Input validation and sanitisation at the boundary. Defends against NoSQL injection, mass assignment, prototype pollution and unbounded-input DoS.

**Lines:** 377 · **Concept blocks:** 10

## The founding rule

> **NEVER TRUST CLIENT INPUT.** Not the body, not the query string, not the headers, not even fields your own frontend controls — anyone can curl your API directly. **Your frontend validation is a UX feature, not a security control.**

## Validation vs sanitisation

| | Action | Example |
|---|---|---|
| **Validation** | **REJECT** bad input, fail closed with 400 | "email must look like an email" |
| **Sanitisation** | **TRANSFORM** into something safe | trim, lowercase, cast `"5"` → `5` |

You want both, and validation should run on the *sanitised* value.

## Exports

| Export | Purpose |
|---|---|
| `sanitizeMongo` | App-level: strips `$`-prefixed, dotted and prototype keys |
| `stripMongoOperators(value)` | The pure function behind it — [unit tested](../tests/mocking.test.js.md) |
| `handleValidation` | Drains express-validator results into one 400 |
| `registerValidation` · `loginValidation` | Auth chains |
| `createTaskValidation` · `updateTaskValidation` | Task chains |
| `listTasksValidation` · `mongoIdParamValidation` | Query/param chains |

---

## ⭐ NoSQL injection

Candidates often say "MongoDB doesn't have SQL injection" — true, and beside the point. MongoDB has its **own** injection class, arguably easier to exploit.

### ❌ The attack

```js
// Your login code, which looks completely reasonable:
const user = await User.findOne({ email: req.body.email });
```

```json
// The attacker POSTs this instead of a string email:
{ "email": { "$ne": null }, "password": { "$ne": null } }
```

`req.body.email` is now an **object**, so the query becomes `findOne({ email: { $ne: null } })` — which **matches the first user in the collection**, frequently the admin. Authentication bypassed, no password needed.

**Variants:** `{"$gt": ""}` does the same. `$regex` lets an attacker extract a password character by character. `$where` executes **arbitrary JavaScript on the database server** — total compromise (disable it; off by default on modern Atlas).

**Why it happens:** `express.json()` parses the body into rich JS types. Nothing forces `email` to be a string, and the driver treats a nested object as a query operator — **exactly as designed**.

### ✅ Four layers of defence, in order of importance

| # | Layer | Note |
|---|---|---|
| 1 | **Type-validate every input** | `body('email').isEmail()` fails immediately on a non-string, so the object never reaches the query. ⭐ **Validation *is* injection defence.** |
| 2 | **Coerce explicitly** at the query site | `String(req.body.email)` — an object stringifies to `"[object Object]"`, matching nothing. Done in [`User.findByEmail`](../models/User.js.md). |
| 3 | Mongoose schema casting | Helps but is **NOT sufficient**. It doesn't protect a raw driver call, an aggregation pipeline, or `$where`, and `strictQuery` behaviour varies by version. **Never rely on it alone.** |
| 4 | **Strip `$` and dotted keys** | What `express-mongo-sanitize` does — hand-rolled here as `sanitizeMongo` so the mechanism is visible. |

### Prototype pollution

A related class. If an attacker sets `__proto__` or `constructor.prototype` on an object you later merge, they can add properties to `Object.prototype` itself — affecting **every object in the process**. Classic escalation: `__proto__.isAdmin = true`, and suddenly every object reports `isAdmin`. Those keys are stripped too.

⚠️ `stripMongoOperators` also **bounds recursion depth at 10** — a deeply nested payload is itself a DoS vector (10,000 levels of nesting burns your stack and CPU). [Tested.](../tests/mocking.test.js.md)

---

## ⭐ Mass assignment / over-posting

A vulnerability created by convenience.

```js
❌ const user = await User.create(req.body);
```

Looks clean. But the attacker POSTs `{ "name":"x", "email":"x@y.z", "password":"...", "role":"admin" }` and **creates themselves an admin account**. This is the bug that let someone commit to the Rails repo on GitHub in 2012.

**Two fixes, and you want both:**

1. **Allowlist at the controller** — explicitly destructure `{ name, email, password }`. Never spread `req.body` into a model. **Allowlist, not denylist** — a denylist misses the next sensitive field someone adds.
2. **Reject unexpected fields at validation** — so a client sending `role` gets a clear 400 rather than silent stripping, which also **surfaces the attempt in your logs**.

Guarded fields here: `role`, `isActive` (register) and `owner` (task create/update — otherwise you could create tasks in someone else's account, or transfer ownership).

---

## ⭐ Escape on OUTPUT, not on input

**A mistake I made while building this file, caught by a test** — which makes it a better lesson than getting it right first time.

The original called `.escape()` on the title. A test then asserted a stored title of `"Alice's private task"` and got back `"Alice&#x27;s private task"`. **The data was corrupted at rest.**

### Why input-escaping is an anti-pattern

| # | Problem |
|---|---|
| 1 | **It destroys data.** The user typed an apostrophe; you stored an HTML entity. Now search doesn't match, CSV exports are wrong, email templates show `&#x27;`, and length limits count the wrong characters. |
| 2 | **It double-escapes.** Render `&#x27;` in a template that escapes on output (any modern one does) and the user sees literal `&#x27;`. Everyone has seen this on a real website. |
| 3 | ⭐ **It escapes for the wrong context.** Escaping is **context-dependent**: HTML body, HTML attribute, JS string, URL parameter, CSS and SQL all need **different** escaping. At input time you don't yet know where the value will be rendered — so any choice is wrong somewhere. HTML-escaping a value that later goes into a URL provides **no protection at all**. |

### ✅ The correct model

Store the user's **actual** input (validated for type, length and shape), then escape at the moment of **rendering**, for the specific context. In this stack that's already handled:

- **React escapes by default** when you write `{task.title}` in JSX. You'd have to deliberately use `dangerouslySetInnerHTML` to create a hole — hence the name.
- **The [CSV export](../controllers/taskController.js.md)** escapes for CSV context (and neutralises formula injection) at write time.
- **Mongoose parameterises queries**, so injection is handled by type validation above.

**The one exception:** genuine **rich text** rendered as HTML. Then you don't "escape" — you **sanitise with an allowlist parser** (DOMPurify, sanitize-html) that keeps `<b>` and `<a href>` while stripping `<script>` and `onerror=`. A different operation, and the only time input-time transformation is right.

---

## Other concepts

| Concept | Takeaway |
|---|---|
| **Collect ALL errors** | Returning one at a time forces five round-trips to fix a five-field form. |
| **`normalizeEmail()` and its sharp edge** | Lowercases the domain and strips Gmail dots/+tags, preventing one mailbox farming unlimited accounts. ⚠️ But it's **lossy** — users relying on +tags find their stored address doesn't match what they typed, and reset emails go elsewhere. **Be consistent**: normalise at registration *and* login or they'll never match. |
| **Password policy — why the old rules were wrong** | **NIST SP 800-63B (2017) explicitly recommends AGAINST** mandatory composition rules and forced rotation. Complexity rules push users to predictable patterns (`Password1!`); rotation produces `Password1!` → `Password2!`. NIST recommends **length** (8 min, 64+ allowed), **screening against breached-password lists** (the HaveIBeenPwned k-anonymity API is free and never sees the password), and **MFA**. ⚠️ An upper bound matters too: **bcrypt silently truncates at 72 bytes**, so without a max length a 200-char passphrase is only protected by its first 72. |
| **Pagination limits as DoS defence** | `?limit=1000000` makes your server load a million documents and very likely fall over. **An unbounded `limit` is a DoS vector handed to every anonymous caller.** |

## express-validator vs Zod

| | express-validator | Zod |
|---|---|---|
| Style | Middleware chains, mutates `req` | Declare a schema once |
| Types | None | ⭐ `z.infer` gives a TypeScript type from the same schema |
| Mass assignment | Manual `.not().exists()` per field | ⭐ **`.strict()` rejects unknown keys** — fixed structurally, for free |
| Downstream safety | "Inspect and report" | `req.body = result.data` — downstream code can **only** see validated fields |

That last row is the real difference: Zod gives you a stronger guarantee than "we checked and logged".

## Interview questions

- **"Is MongoDB vulnerable to injection?"** → Yes, its own class. Walk through `{"$ne": null}` as a login bypass.
- **"How do you prevent it?"** → The four layers, in order. Lead with "validate types — validation *is* injection defence".
- **"What's wrong with `User.create(req.body)`?"** → Mass assignment. Allowlist, and reject unknown fields.
- **"Should you HTML-escape input before storing it?"** → **No.** Three reasons, ending with the context argument.
- **"What's a good password policy?"** → Length over complexity, breach screening, MFA. Cite NIST. Mention bcrypt's 72-byte truncation.
- **"What does `?limit=999999` do?"** → OOM. Clamp server-side.

## Related

- [`controllers/authController.js`](../controllers/authController.js.md) — the controller-side allowlist
- [`models/User.js`](../models/User.js.md) — schema-level validation and `findByEmail` coercion
- [`controllers/taskController.js`](../controllers/taskController.js.md) — CSV escaping, the output-side counterpart
- [`tests/integration.auth.test.js`](../tests/integration.auth.test.js.md) — injection and mass-assignment tests
- [`client/src/pages/RegisterPage.jsx`](../../client/src/pages/RegisterPage.jsx.md) — the UX-only client mirror
