# `server/middleware/auth.js`

> ⭐ The most important file in the project. Authentication, role authorization, and resource authorization — three separate things, deliberately kept separate.

**Lines:** 364 · **Concept blocks:** 13

## ⭐ AuthN vs AuthZ — the distinction that separates juniors from mid-levels

They're constantly conflated, and the difference is not academic — it maps to two different middleware, two different status codes, and two different classes of vulnerability.

| | **Authentication (AuthN)** | **Authorization (AuthZ)** |
|---|---|---|
| Question | **"Who are you?"** | **"What are you allowed to do?"** |
| Mechanism | Password check, JWT signature | Role check, ownership check |
| Failure | **401** Unauthorized *(a 1990s spec misnomer — it means unauthenticated)* | **403** Forbidden *("I know exactly who you are, and no")* |
| Here | `verifyAccessToken` | `requireRole`, `requireOwnership` |

⭐ **The critical insight: authentication alone is NOT access control.** "The user has a valid token" says nothing about whether *this* task belongs to *them*. Forgetting the second check is IDOR.

## Exports

| Export | Type | Purpose |
|---|---|---|
| `verifyAccessToken` | middleware | AuthN — verifies signature, attaches `req.user` |
| `optionalAuth` | middleware | Attaches `req.user` if a valid token exists, never rejects |
| `requireRole(...roles)` | **factory** | AuthZ, coarse — role gate |
| `requireOwnership(Model, opts)` | **factory** | AuthZ, fine — per-object gate |
| `extractBearerToken(req)` | helper | Parses the `Authorization` header |

---

## `verifyAccessToken`

| Concept | Takeaway |
|---|---|
| **Why "Bearer"** | It literally means whoever *bears* the token gets access — no additional proof, no device binding. That's why HTTPS is non-negotiable: a copied token works perfectly for the copier. Using a **header** rather than a cookie also means the browser doesn't attach it automatically, making these endpoints **immune to CSRF**. |
| **⭐ `verify()` — not just decoding** | The single most consequential line. `jwt.decode()` would parse the payload with **zero verification** — anyone could forge `{"role":"admin"}` and walk in. `jwt.verify()` recomputes HMAC-SHA256 with the server's secret and compares, **and** enforces `exp`/`nbf`/`iss`. Only verify() is an authentication check. |
| **Distinguish expired from invalid** | The frontend needs to tell these apart. `TOKEN_EXPIRED` → silently refresh and retry. `TOKEN_INVALID` → the token is forged or malformed, so refreshing is pointless: log out. An undifferentiated 401 forces the client into a **refresh loop on a forged token**. Consumed by the [axios interceptor](../../client/src/api/axiosClient.js.md). |
| **⭐ To hit the DB or not** | The real trade-off of stateless auth. **Trust claims only:** maximum speed, truly stateless, zero shared state — but the claims are a **snapshot from up to 15 minutes ago**, so a user you just deleted, banned or demoted still has a token saying otherwise. **Load the user** (~1ms indexed `_id` lookup): you can honour deactivation and password changes immediately, at one query per request. You're no longer *fully* stateless, though still sessionless. **The honest answer is "it depends on your threat model"** — high-security → load; high-throughput public reads → trust claims and keep expiry short. A common middle ground: trust on reads, load on writes. This project loads, so the checks it enables are visible. |
| **Password-change invalidation** | Rejects any token whose `iat` predates `passwordChangedAt`. Closes the "I changed my password, why is the attacker still logged in?" hole — targeted revocation of a stateless token. |
| **Attaching to `req`** | The idiomatic way to pass data downstream. ⚠️ Don't collide with Express's own properties, and don't hang large objects off `req` — everything attached stays alive until the response finishes. |

**Error codes it can return:** `TOKEN_EXPIRED` (401) · `TOKEN_INVALID` (401) · `USER_DELETED` (401) · `PASSWORD_CHANGED` (401) · deactivated (**403**, because refreshing wouldn't help).

Note it does **not** echo `err.message` to the client — that can reveal whether the failure was a bad signature vs malformed structure, a small information leak to someone probing your auth.

---

## `requireRole` — RBAC

| Concept | Takeaway |
|---|---|
| **RBAC** | Permissions attach to **roles**; users are assigned roles. You manage a handful of roles instead of per-user lists. Simple, auditable, the right default. |
| **⚠️ Ordering: AuthN before AuthZ** | Mounted without `verifyAccessToken` in front, `req.user` is undefined. A naive `if (req.user.role !== 'admin')` throws a **TypeError → 500**, and on some hand-rolled error handlers a thrown TypeError has been known to be swallowed and **the request allowed through**. **Always fail closed** when a precondition is missing. |

**Where RBAC breaks down, and what comes next:**

| Model | Rule shape |
|---|---|
| **RBAC** | "Admins can delete tasks." Fails when rules depend on the specific object or context. |
| **ABAC** (attribute-based) | "You can delete a task IF you own it AND it isn't archived AND it's before the deadline." Computed from attributes of user, resource and environment. |
| **ReBAC** (relationship-based) | Google Zanzibar / OpenFGA: "you can edit this doc because you're an editor of the folder containing it." Needed once permissions inherit through a graph. |

⚠️ **The role-explosion smell:** if you're creating `admin-who-can-also-export-but-not-delete`, RBAC has stopped fitting and you want **permissions/scopes**, not more roles.

---

## ⭐ `requireOwnership` — IDOR

OWASP ranks **Broken Access Control as the #1 web application risk**, and IDOR is its most common form. It's also one of the most frequently reported bug-bounty findings, because it's so easy to introduce and invisible in normal testing.

### ❌ The bug

```js
router.delete('/tasks/:id', verifyAccessToken, async (req, res) => {
  // "The user is authenticated, so this is safe."  ← WRONG
  await Task.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});
```

**Why it looks fine:** there *is* an auth check. Anonymous callers are rejected. Every test passes. It works perfectly in QA — because testers only ever delete their own tasks.

**Why it's catastrophic:** the route verified **authentication** but never **authorization**. `req.params.id` is entirely attacker-controlled. Any logged-in user — one who signed up thirty seconds ago — can enumerate or guess ids and delete **every task belonging to every other user**.

**How it's found:** open DevTools, watch a request to `/api/tasks/6512ab...`, change one hex digit, replay. That's the entire exploit.

### ✅ The fix

```js
const task = await Task.findOne({ _id: req.params.id, owner: req.user.id });
if (!task) throw ApiError.notFound('Task');
```

Note the **shape**: the ownership condition is **in the query**, not an `if` after the fetch. Deliberate — it's impossible to fetch the document and then forget the check, it's a single round-trip, and it lets MongoDB use the `{ owner, ... }` [compound index](../models/Task.js.md).

### ⚠️ Why 404 and not 403

Returning 403 **confirms that a task with that id exists** and belongs to someone else — an information leak letting an attacker enumerate valid ids and map your data volume. 404 is indistinguishable from "no such task".

*(Counter-argument worth knowing: 403 is more honest for internal tools where enumeration isn't a concern.)*

### Other defences

- **UUIDs/ULIDs instead of sequential ids** — but defence in depth, **not** a substitute. "Unguessable id" is security through obscurity; ids leak via logs, referrers and shared links.
- **Centralise the check in middleware** — exactly what this file does, so it can't be forgotten.
- **Write a test asserting user B gets 404 for user A's resource** — [done here](../tests/integration.tasks.test.js.md).

### Implementation details

| Concept | Takeaway |
|---|---|
| **Validate the ObjectId first** | A malformed id passed to `findById()` throws a CastError → an ugly 500. A 500 on attacker-supplied input is both bad UX and a signal that you've found an unhandled path worth probing. |
| **Scope, don't post-filter** | The three reasons above. |
| **Audit-log privileged access** | An admin override is a legitimate feature **and** an insider-threat vector. If an admin can read any user's data, the compensating control is that every such access is logged. **That's what turns a backdoor into a documented capability.** |

The document is attached as `req.resource`, so the controller doesn't re-query — one round-trip, and no TOCTOU gap between check and use.

---

## Interview questions

- **"Authentication vs authorization?"** → The table. Then the killer line: authentication alone is not access control.
- **"This route is authenticated. Is it secure?"** → Not necessarily — walk through IDOR.
- **"401 or 403?"** → 401 = I don't know you. 403 = I know you and you still can't.
- **"`verify()` or `decode()`?"** → decode does zero verification. Using it for auth is a total bypass.
- **"Should auth middleware hit the database?"** → Give both sides and pick based on threat model.
- **"Why 404 instead of 403 for someone else's resource?"** → Prevents id enumeration.
- **"When does RBAC stop working?"** → When rules depend on the object or context → ABAC; when they inherit through a graph → ReBAC. Watch for role explosion.

## Related

- [`utils/tokens.js`](../utils/tokens.js.md) — JWT internals, `verify` vs `decode`
- [`models/User.js`](../models/User.js.md) — `role`, `isActive`, `passwordChangedAt`
- [`routes/taskRoutes.js`](../routes/taskRoutes.js.md) — where `requireOwnership` is attached
- [`tests/integration.tasks.test.js`](../tests/integration.tasks.test.js.md) — ⭐ the IDOR test
- [`client/src/routes/ProtectedRoute.jsx`](../../client/src/routes/ProtectedRoute.jsx.md) — the client mirror, and why it's *not* security
