# MERN Boilerplate Generation Spec — Node.js + React Interview Prep

> **Purpose of this file:** Paste this entire document into a new Claude conversation (or Claude Code) as the instruction set for generating a complete MERN boilerplate. The goal is not just a working app — it's a codebase that doubles as revision material, with every interview-relevant concept implemented AND clearly commented so it can be read back later like a cheat sheet.

---

## 0. Instructions to give Claude (paste this as the actual prompt)

```
Build a MERN stack boilerplate project (Task Manager domain) that implements
every concept listed in this spec. Requirements for the output:

1. Every file must include a comment block above any interview-relevant
   concept, in this exact format:

   // ============================================================
   // 🧠 CONCEPT: <name of concept>
   // WHY IT MATTERS (interview angle): <1-2 line explanation>
   // HOW IT WORKS HERE: <1-2 line explanation specific to this code>
   // ============================================================

2. Do not skip "boring" plumbing (env config, error middleware, folder
   structure) — comment those too, since interviewers ask about them.

3. Where a concept has a "slow way" and a "fast way" (e.g. queries,
   pagination, auth checks), implement BOTH, side by side or toggled by
   a flag/route, so I can compare them directly. Add a comment explaining
   the performance difference and why.

4. Keep business logic minimal (it's a Task Manager) — the code exists to
   demonstrate concepts, not to be a real product.

5. Add a top-level README.md that lists every concept implemented, which
   file it lives in, and one likely interview question for each.

6. Prefer readable, slightly verbose code over clever one-liners — this is
   a study artifact, not a production optimization exercise.

Build it in this order: backend core → auth → performance/query demos →
security → advanced Node concepts → frontend → integration → README.
```

---

## 1. Tech Stack

- **Backend:** Node.js, Express.js, MongoDB, Mongoose
- **Auth:** JWT (access + refresh tokens), bcrypt
- **Frontend:** React (Vite), React Router, Context API + one example with Redux Toolkit or Zustand (for comparison)
- **Caching:** Redis (in-memory fallback if Redis unavailable, clearly commented)
- **Testing:** Jest + Supertest (backend), React Testing Library (frontend)
- **Extras:** Multer (file upload), EventEmitter (built-in), Winston or simple custom logger

---

## 2. Folder Structure

```
/server
  /config          → db connection, env loading, redis client
  /models          → User, Task, RefreshToken
  /controllers     → business logic per resource
  /routes          → route definitions only
  /middleware      → auth, error handler, rate limiter, validation, logger
  /utils           → token generation, async wrapper, event emitter
  /jobs            → example cron/background job (optional bonus)
  /tests           → jest + supertest suites
  server.js
  app.js
/client
  /src
    /api           → axios instance + interceptors
    /context       → AuthContext, TaskContext
    /store         → Redux/Zustand example (parallel to Context, for comparison)
    /hooks         → custom hooks (useAuth, useFetch, useDebounce)
    /components
    /pages
    /routes        → ProtectedRoute, PublicRoute
README.md
```

---

## 3. Node.js Concepts Checklist (must all appear, with comments)

### Core language / runtime
- [ ] Event loop phases — demonstrate with `setTimeout` vs `setImmediate` vs `process.nextTick` in a small demo script (`/server/utils/eventLoopDemo.js`)
- [ ] Callback pattern (error-first callback) — one deliberate example even though rest of app uses async/await, with a comment contrasting the two
- [ ] Promises & async/await — used throughout; comment on Promise.all usage where applicable (e.g. fetching task counts + user profile in parallel)
- [ ] CommonJS module system (or ESM — pick one, comment on the difference)
- [ ] `EventEmitter` — implement an `activityLogger` that emits `taskCreated`, `taskDeleted`, `userLoggedIn` events, with a listener that logs them. Comment on pub/sub pattern and how this differs from a message queue.
- [ ] Streams & Buffers — a CSV export endpoint (`GET /api/tasks/export`) that streams data instead of building the full string in memory; comment on backpressure and why streaming matters for large datasets
- [ ] `Buffer` basics — show one raw buffer manipulation example (e.g. reading a small file as buffer) with comments
- [ ] Child processes / worker threads — not required to fully implement, but include a **commented-out or minimal** example (e.g. offloading a CPU-heavy task like report generation to a worker thread) with a comment explaining when you'd reach for this vs clustering
- [ ] `cluster` module — include a `cluster.js` entry point (optional alt to `server.js`) that forks workers per CPU core, with comments on why Node is single-threaded and how clustering works around that

### Express-specific
- [ ] Middleware chain & execution order — comment showing how `next()` passes control
- [ ] Custom middleware (auth check, request logger, validation)
- [ ] Error-handling middleware (4-arg signature) vs regular middleware — comment on why arg count matters to Express
- [ ] Centralized async error handling — an `asyncHandler` wrapper utility to avoid repetitive try/catch, with comment on why this pattern exists
- [ ] Route-level vs app-level middleware
- [ ] Environment config via `dotenv`, with comments on why secrets never get committed

### Database / Mongoose
- [ ] Schema design, validation, and indexes
- [ ] **Slow query vs fast query demo** (see Section 5 — dedicated deep-dive)
- [ ] Connection pooling — comment on Mongoose's default pool size and when to tune it
- [ ] Aggregation pipeline — one non-trivial example (e.g. task counts grouped by status per user)
- [ ] Population (`populate()`) vs manual joins — comment on the N+1 query problem and how `populate` can still cause it if misused

### Auth & Authorization (dedicated section 4)

### Security
- [ ] `helmet` — secure HTTP headers
- [ ] `express-rate-limit` — brute-force protection on `/login`
- [ ] Input sanitization / validation (`express-validator` or `zod`)
- [ ] CORS configuration — comment on what it actually protects against (and what it doesn't)
- [ ] Password hashing with bcrypt — comment on salt rounds trade-off
- [ ] SQL/NoSQL injection prevention — comment even though Mongoose largely protects against this by default

### Performance & Scaling
- [ ] Caching layer (Redis) on a read-heavy endpoint (e.g. task list), with cache invalidation on write — comment on cache-aside pattern
- [ ] Pagination: offset-based vs cursor-based — implement both, comment on trade-offs at scale
- [ ] Compression middleware (`compression`) — comment on when it helps vs when it costs CPU
- [ ] Load balancing / horizontal scaling — not implementable locally, but comment in README on how this app would be scaled (stateless JWT auth enabling multiple instances, sticky sessions not needed, etc.)

### Testing
- [ ] Unit test example (pure function, e.g. token generation)
- [ ] Integration test example (Supertest hitting an actual route with a test DB)
- [ ] Mocking example (mock bcrypt or DB call)

---

## 4. Authentication & Authorization — Detailed Spec

Implement **both** concepts clearly separated and commented, since interviewers often test whether candidates confuse the two.

### Authentication (who are you)
- `POST /api/auth/register` — hash password with bcrypt, create user
- `POST /api/auth/login` — verify password, issue:
  - **Access token** (JWT, short-lived, ~15 min, sent in response body, stored in memory/state on frontend)
  - **Refresh token** (long-lived, ~7 days, stored as httpOnly cookie, also saved in DB so it can be revoked)
- `POST /api/auth/refresh` — validate refresh token against DB, issue new access token — comment on why refresh tokens are stored server-side (revocation capability) while access tokens are not
- `POST /api/auth/logout` — invalidate refresh token in DB
- Middleware `verifyAccessToken` — decodes JWT, attaches `req.user`, comment on signature verification vs just decoding

### Authorization (what are you allowed to do)
- Role field on `User` model: `user` / `admin`
- Middleware `requireRole('admin')` — reusable role-gate middleware, comment on RBAC (role-based access control)
- Resource-level authorization — comment showing the difference between "is logged in" (authentication) vs "is this task yours" (authorization) — e.g. a user can only edit/delete their own tasks, even though they're authenticated
- Example of an **authorization bug** deliberately shown in a comment (e.g. checking `req.user` exists but forgetting to check ownership) — comment explaining why this is a common real-world vulnerability (IDOR — Insecure Direct Object Reference)

### JWT internals (comment-only deep dive)
- Comment block explaining JWT structure: header.payload.signature
- Comment on why JWTs are stateless and the trade-off (can't easily revoke an access token before expiry — hence short expiry + refresh token pattern)
- Comment on where to store tokens on the frontend (memory vs localStorage vs httpOnly cookie) and XSS/CSRF trade-offs of each

---

## 5. Slow Query vs Fast Query — Dedicated Demo

This should be its own controller/route file: `/server/controllers/queryDemoController.js`, with routes like:

- `GET /api/demo/tasks-slow` — deliberately inefficient:
  - No index on the filtered field
  - Fetches all fields (`find()` with no `.select()`)
  - Loops in JS to filter/aggregate instead of using MongoDB aggregation
  - N+1 pattern: fetches tasks, then loops and queries the user for each task individually
- `GET /api/demo/tasks-fast` — optimized version of the same result:
  - Uses an indexed field in the query filter
  - `.select()` to fetch only needed fields
  - Single aggregation pipeline instead of JS loops
  - `.populate()` (or a `$lookup` in aggregation) instead of per-item queries

**Required comments on both routes:**
- Explain what makes the slow version slow (in Big-O terms where relevant, and in terms of number of DB round-trips)
- Show how to actually verify this: `.explain("executionStats")` usage documented in a comment, with what to look for (`COLLSCAN` vs `IXSCAN`, `totalDocsExamined`, `executionTimeMillis`)
- Add a note in README on how to seed enough dummy data (e.g. via a `seed.js` script with 10k+ documents) to actually observe the difference locally

**Also include:**
- Compound index example and a comment on index field order mattering
- Comment on when an index *hurts* (write-heavy collections, low-cardinality fields)

---

## 6. React Concepts Checklist

### Core
- [ ] Function components + hooks only (no class components) — but include one comment explaining what `componentDidMount`/`componentDidUpdate` map to in hooks, since interviewers still ask this
- [ ] `useState`, `useEffect` (with cleanup function demonstrated — e.g. cleaning up an event listener or interval)
- [ ] `useContext` — AuthContext and TaskContext
- [ ] `useRef` — one DOM-access example and one "persist value without re-render" example
- [ ] `useMemo` / `useCallback` — one real example each with a comment on when memoization actually helps vs adds overhead
- [ ] Custom hooks — `useAuth()`, `useFetch()`, `useDebounce()` (debounce a search input hitting the task list)
- [ ] Controlled vs uncontrolled components — comment example of both for a form input

### App architecture
- [ ] React Router — public routes, protected routes (`ProtectedRoute` wrapper checking auth context)
- [ ] Context API implementation — comment on prop drilling problem it solves, and its limitation (re-render scope) vs Redux
- [ ] One parallel example using Redux Toolkit **or** Zustand for the same state Context manages — comment comparing the two approaches directly
- [ ] Error boundaries — a class component (only class component allowed, since hooks can't do this) wrapping the app, with comment on why error boundaries must be classes
- [ ] Code splitting / lazy loading — `React.lazy` + `Suspense` on a route, comment on bundle size impact
- [ ] Axios interceptor — attach JWT to every request, handle 401 by attempting token refresh, comment on this being the frontend mirror of the backend auth flow

### Data fetching patterns
- [ ] Basic `fetch`/`axios` in `useEffect` — the "manual" way, with comment on its downsides (no caching, no dedup, race conditions)
- [ ] Same data fetched via React Query (or SWR) — comment side-by-side contrasting caching, refetching, loading/error states handled for you

---

## 7. Deliverables Checklist (what the final output should include)

- [ ] Full working backend with all routes above
- [ ] Full working frontend consuming those routes
- [ ] `seed.js` script to populate dummy data for the slow/fast query demo
- [ ] `.env.example` file listing all required environment variables
- [ ] `README.md` containing:
  - Setup instructions
  - A table: **Concept → File location → Sample interview question**
  - Instructions on how to run the slow-vs-fast query comparison and read `.explain()` output
- [ ] Jest test suite that runs with a single command
- [ ] Comments formatted exactly as specified in Section 0, throughout

---

## 8. Optional Stretch (only if time permits)

- WebSocket demo (Socket.io) for real-time task updates — comment on how this differs from polling
- Dockerfile + docker-compose (app + MongoDB + Redis) — comment on why this matters for "how would you deploy this" interview questions
- Rate-limited public API key system (separate from user JWT auth) — comment on API key vs JWT use cases
