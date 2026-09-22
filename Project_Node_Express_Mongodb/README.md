# MERN Interview Boilerplate — Task Manager

A working MERN stack app that doubles as **revision material**. Every interview-relevant concept is implemented *and* commented in place, so you can read the codebase back like a cheat sheet.

Every concept block uses this format, so you can grep for them:

```js
// ============================================================
// 🧠 CONCEPT: <name>
// WHY IT MATTERS (interview angle): <why an interviewer asks>
// HOW IT WORKS HERE: <what this specific code does>
// ============================================================
```

There are **373 of these blocks across 71 files** (every file in the project but one). Find them all:

```bash
grep -rn "🧠 CONCEPT" server client --include=*.js --include=*.jsx | wc -l
```

> 📖 **Per-file documentation:** [`docs/`](./docs/README.md) contains one Markdown file for every source file and every folder — 101 docs describing what each file does, the concepts it contains, its API, and the interview questions it answers. Start at [`docs/README.md`](./docs/README.md) for the map, or jump to [`docs/server/`](./docs/server/README.md) / [`docs/client/`](./docs/client/README.md).
>
> The **concept index below** is organised by topic; the **docs tree** is organised by file. Use whichever matches how you're revising.

**Design principle:** where a concept has a slow way and a fast way, **both are implemented** side by side (`/api/demo/tasks-slow` vs `/api/demo/tasks-fast`, Context vs Zustand vs React Query, offset vs cursor pagination) so you can measure the difference instead of taking it on faith.

---

## Status

| | |
|---|---|
| Backend tests | ✅ 80 passing (Jest + Supertest + mongodb-memory-server) |
| Frontend tests | ✅ 6 passing (Vitest + React Testing Library) |
| Client build | ✅ Builds clean, with visible code-split chunks |
| Demo scripts | ✅ `eventLoopDemo`, `bufferDemo`, `callbackDemo` all run |

---

## Quick start

### Option A — Docker (recommended: no local MongoDB or Redis needed)

```bash
docker compose up -d
docker compose exec api npm run seed      # 10,000 tasks
open http://localhost:5173               # React app
open http://localhost:5000/api/health    # API
docker compose logs -f api
```

### Option B — Local

Requires **Node 18+** and **MongoDB** running on `localhost:27017`. Redis is optional (the app falls back to an in-memory cache and says so loudly in the logs).

```bash
# 1. Install
npm run install:all

# 2. Configure
cp server/.env.example server/.env        # works as-is for local dev

# 3. Seed
cd server && npm run seed                 # 10k tasks, 20 users
#            npm run seed:big             # 50k tasks — do this for the perf demos

# 4. Run (two terminals)
npm run dev --prefix server               # API  -> :5000
npm run dev --prefix client               # App  -> :5173
```

**Seeded logins:**

| Email | Password | Role |
|---|---|---|
| `demo@example.com` | `Password123` | user (owns ~60% of the seeded tasks) |
| `admin@example.com` | `Password123` | admin |

### Verify everything

```bash
npm test                    # backend: 80 tests
npm run test:client         # frontend: 6 tests
cd server && npm run cluster    # multi-core mode; hit /api/health and watch the pid change
```

### Standalone concept demos (no database needed)

```bash
cd server
npm run demo:eventloop     # setTimeout vs setImmediate vs nextTick, thread pool, blocking
npm run demo:buffer        # encodings, magic numbers, off-heap memory, endianness
npm run demo:callback      # callback hell -> promises -> async/await -> Promise.all
```

Run `demo:eventloop` a few times — **experiment 1's output order changes between runs**, and understanding why is the point.

---

## The headline demo: slow vs fast queries

This is the part worth doing first.

```bash
cd server && npm run seed:big     # 50,000 tasks — essential, see the warning below
npm run dev
```

Log in as `demo@example.com`, then open **Query demos** in the UI (or curl the endpoints with a Bearer token).

| Endpoint | What it does |
|---|---|
| `GET /api/demo/compare` | Runs both paths, reports the speedup and round-trips saved |
| `GET /api/demo/tasks-slow` | COLLSCAN + no projection + no `.lean()` + N+1 + JS aggregation |
| `GET /api/demo/tasks-fast` | IXSCAN + `$project` + `$lookup` + `$group` — **one** query |
| `GET /api/demo/explain` | `.explain("executionStats")` for unindexed vs indexed vs covered |
| `GET /api/demo/populate` | Manual loop vs `.populate()` vs `$lookup`, timed |
| `GET /api/demo/indexes` | Index inventory + `$indexStats` usage counts |

> ⚠️ **Seed at least 10k documents first.** With 20 documents a COLLSCAN and an IXSCAN are both sub-millisecond and prove nothing. That is itself the lesson: **performance bugs don't appear in dev, they appear in production, because production is where the data is.**

### The four mistakes, and what each costs

| # | Mistake | Cost | Fix |
|---|---|---|---|
| 1 | Filter on an unindexed field | `COLLSCAN` — O(n) docs examined | Index it → `IXSCAN`, ~O(log n) |
| 2 | No `.select()` projection | 5–20× more I/O, network and CPU | Project only needed fields |
| 3 | No `.lean()` | Full Mongoose Document hydration per row | `.lean()` for read-only paths |
| 4 | **N+1 queries** | **1 + N network round-trips** | `$lookup`, `.populate()`, or a batched `$in` |

Mistake 4 usually dominates: 500 tasks = 501 queries. Even at 1 ms each that's 500 ms of *pure waiting*, and on a cloud database with 5 ms latency it's **2.5 seconds**. Latency × count is what kills you, not query time.

### How to read `.explain("executionStats")`

```js
// mongosh
db.tasks.find({ legacyTag: "batch-import" }).explain("executionStats")

// Mongoose
await Task.find({ owner, status: 'todo' }).explain('executionStats')
```

**The four numbers that matter:**

1. **`winningPlan.stage`**
   - `COLLSCAN` ❌ full scan, no index used
   - `IXSCAN` ✅ index seek
   - `SORT` ❌ in-memory sort — **fails outright above 100 MB**
   - `PROJECTION_COVERED` ✅✅ answered from the index alone; documents never read

2. **`totalDocsExamined` ÷ `nReturned`** — the efficiency ratio. This single number *is* index quality:
   - `50000 / 500` = 100:1 ❌
   - `500 / 500` = 1:1 ✅
   - `0 / 500` = covered query ✅✅

   Worse than roughly 10:1 deserves investigation.

3. **`totalKeysExamined`** — compare to docs examined. If keys ≫ docs, your compound index field **order** is probably wrong (see the ESR rule below).

4. **`executionTimeMillis`** — ⚠️ noisy. Affected by cache warmth: run it twice. The **document counts are the stable signal**; timing is not.

Also check `rejectedPlans`. MongoDB **caches the winning plan per query shape**, so a plan chosen when the collection was small can persist and become wrong as data grows. `db.tasks.getPlanCache().clear()` forces re-evaluation — a real production diagnostic.

### Compound indexes: the ESR rule

`{ owner: 1, status: 1, createdAt: -1 }` in `server/models/Task.js` follows **ESR**:

- **E**quality fields first (`owner`, `status`)
- **S**ort fields next (`createdAt`)
- **R**ange fields last

**The prefix rule** — this index serves `{owner}`, `{owner, status}`, `{owner, status, createdAt}` but **NOT** `{status}` alone, because that skips the prefix. Like a phone book sorted by (lastName, firstName): you can find "Smith" and "Smith, John", but not "everyone named John".

**When an index *hurts*** (the half people forget): write amplification (every insert updates every index), RAM pressure, low-cardinality uselessness, disk/backup size, and planner confusion. Find dead weight with `db.tasks.aggregate([{$indexStats:{}}])` — an index with `ops: 0` after a week is pure write tax. Drop it.

---

## Concept index

### Node.js core / runtime

| Concept | File | Likely interview question |
|---|---|---|
| Event loop phases | `server/utils/eventLoopDemo.js` | "Explain the event loop. Does `setTimeout(fn,0)` or `setImmediate` run first?" *(Trick: it's non-deterministic at top level, deterministic inside I/O — and you must explain why.)* |
| `process.nextTick` priority | `server/utils/eventLoopDemo.js` | "What's the difference between `nextTick` and `setImmediate`? How can `nextTick` starve the loop?" |
| Blocking the event loop | `server/utils/eventLoopDemo.js`, `server/controllers/adminController.js` | "What happens if one request does 5 seconds of CPU work?" |
| libuv thread pool | `server/utils/eventLoopDemo.js` | "Node is single-threaded — so how are 4 `fs.readFile` calls parallel? What is `UV_THREADPOOL_SIZE`?" |
| Error-first callbacks | `server/utils/callbackDemo.js` | "Why is the error the *first* argument? What happens if you `throw` inside an async callback?" |
| Callback hell → promises | `server/utils/callbackDemo.js` | "Name four concrete problems with callbacks that promises fix." *(Nesting, repeated error handling, no composition, inversion of control.)* |
| `Promise.all` vs sequential | `server/utils/callbackDemo.js`, `server/controllers/authController.js` (`me`) | "These two awaits don't depend on each other — what's wrong?" |
| `all` / `allSettled` / `race` / `any` | `server/utils/callbackDemo.js` | "When would you use `allSettled` over `all`?" |
| `util.promisify` | `server/utils/callbackDemo.js` | "How do you modernise a legacy callback API?" |
| Buffers & encodings | `server/utils/bufferDemo.js` | "What's a Buffer? Why isn't `string.length` the byte length?" |
| `alloc` vs `allocUnsafe` | `server/utils/bufferDemo.js` | "Why is it called *unsafe*?" *(Uninitialised memory → leaks other requests' data. Real CVEs.)* |
| Buffers are off-heap | `server/utils/bufferDemo.js` | "Why doesn't my Buffer leak show up in `heapUsed`?" |
| Magic numbers | `server/utils/bufferDemo.js`, `server/middleware/upload.js` | "How do you validate an uploaded file's real type?" |
| **Streams & backpressure** | `server/controllers/taskController.js` (`exportTasksCsv`) | "Export 500k rows to CSV without running out of memory. What is backpressure? Why `pipeline()` over `pipe()`?" |
| Transform streams | `server/controllers/taskController.js` | "How does a slow client slow down the database cursor?" |
| **Worker threads** | `server/workers/reportWorker.js`, `server/controllers/adminController.js` | "Worker threads vs child processes vs cluster — which and why?" |
| **`cluster` module** | `server/cluster.js` | "Why is Node single-threaded, and how do you use 16 cores?" |
| Rolling restart | `server/cluster.js` | "How do you deploy without dropping requests?" |
| `EventEmitter` / pub-sub | `server/utils/activityLogger.js` | "Is an EventEmitter a message queue?" *(No — in-process, synchronous, no persistence, no retry. Know the full table.)* |
| `emit()` is synchronous | `server/utils/activityLogger.js` | "Does `emit()` schedule work for later?" *(No — it runs every listener inline, on the current tick.)* |
| The special `'error'` event | `server/utils/activityLogger.js` | "What happens if an emitter emits `'error'` with no listener?" *(It throws and crashes the process.)* |
| CommonJS vs ESM | `server/app.js` (table), `client/src/main.jsx` | "Difference between `require` and `import`? Why can only ESM be tree-shaken?" |
| Graceful shutdown / SIGTERM | `server/middleware/errorHandler.js` | "Kubernetes sends SIGTERM. What should your app do?" |
| `uncaughtException` policy | `server/middleware/errorHandler.js` | "Should you keep the process alive after an uncaught exception?" *(No — log and exit. The process state is unknown.)* |

### Express

| Concept | File | Likely interview question |
|---|---|---|
| Middleware chain & `next()` | `server/middleware/requestLogger.js` | "What are the three things a middleware must do? What happens if you forget `next()`?" |
| **4-arg error middleware** | `server/middleware/errorHandler.js` | "How does Express know a middleware is an error handler?" *(`fn.length === 4` — and you can't omit `next` or use default params.)* |
| Middleware **order** | `server/app.js` | "What breaks if `express.json()` is registered after your routes?" |
| Route vs router vs app level | `server/middleware/requestLogger.js`, `server/routes/*.js` | "Where would you put an auth check, and why is router-level safer?" |
| **`asyncHandler`** | `server/utils/asyncHandler.js` | "An async route throws. Why does the request hang instead of 500?" |
| Operational vs programmer errors | `server/utils/ApiError.js` | "How do you decide whether to expose an error message to the client?" |
| 404 handler | `server/middleware/errorHandler.js`, `server/routes/index.js` | "Why isn't an unmatched route an 'error' in Express?" |
| Mongo error translation | `server/middleware/errorHandler.js` | "Why does a duplicate email return 500 instead of 409?" *(Code 11000 isn't a ValidationError.)* |
| Body size limits | `server/app.js` | "What stops someone POSTing a 2 GB JSON body?" |
| `trust proxy` | `server/app.js` | "Behind a load balancer, `req.ip` is wrong. Fix it — and what's the security risk of `trust proxy: true`?" |
| Liveness vs readiness | `server/routes/index.js` | "What's the difference, and why must liveness NOT check the database?" |
| `keepAliveTimeout` | `server/server.js` | "Random 502s behind an ALB. Where would you look?" |
| app.js / server.js split | `server/server.js` | "Why separate them?" *(Supertest can drive the app without binding a port.)* |
| API versioning | `server/routes/index.js` | "How would you version this API?" |

### MongoDB / Mongoose

| Concept | File | Likely interview question |
|---|---|---|
| Schema, validation, hooks | `server/models/User.js` | "MongoDB is schemaless — so what does Mongoose add?" |
| **`unique` is an index, not a validator** | `server/models/User.js` | "How do you enforce unique emails, and what error do you get?" |
| `select: false` | `server/models/User.js` | "How do you make sure a password hash is never returned?" |
| `pre('save')` hooks | `server/models/User.js` | "Where do you hash the password, and why not in the controller?" |
| **Hooks DON'T run on `findOneAndUpdate`** | `server/models/User.js`, `server/seed.js` | "Why would `findByIdAndUpdate` store a plaintext password?" |
| Instance methods vs statics | `server/models/User.js` | "Difference, and why can't they be arrow functions?" |
| Virtuals | `server/models/User.js`, `server/models/Task.js` | "Can you query or index a virtual?" *(No.)* |
| Embed vs reference | `server/models/Task.js` | "When do you embed and when do you reference?" *(And: what's the 16 MB limit?)* |
| **Indexes & ESR rule** | `server/models/Task.js` | "How do you order fields in a compound index?" |
| **The prefix rule** | `server/models/Task.js` | "Does `{a,b,c}` serve a query on `{b}`?" *(No.)* |
| **When an index hurts** | `server/models/Task.js` | "Why not just index everything?" |
| Multikey indexes | `server/models/Task.js` | "What happens when you index an array field?" |
| TTL indexes | `server/models/RefreshToken.js` | "How do you auto-expire sessions? How precise is it?" *(~60 s background sweep — don't rely on it for security.)* |
| Connection pooling | `server/config/db.js` | "Does Mongoose open a connection per query? What's the default pool size?" |
| **Aggregation pipeline** | `server/controllers/taskController.js` (`getTaskStats`) | "Name the stages. Why must `$match` come first?" |
| `$facet` | `server/controllers/taskController.js` | "How do you get a page of results AND a total count in one round-trip?" |
| **Aggregation doesn't cast ObjectIds** | `server/controllers/authController.js` (`me`) | "My `$match` returns an empty array but `find()` works. Why?" |
| `$lookup` | `server/controllers/queryDemoController.js` | "Can MongoDB join? What are the caveats?" |
| **`populate()` is NOT a join** | `server/controllers/queryDemoController.js` (`populateDemo`) | "How many queries does `.populate()` make? How can it still be N+1?" |
| **N+1 problem** | `server/controllers/queryDemoController.js` | "What is N+1, how do you spot it, and how do you fix it?" |
| `.lean()` | `server/controllers/taskController.js` | "What does `.lean()` skip, and what do you lose?" |
| `countDocuments` vs `estimatedDocumentCount` | `server/controllers/taskController.js` | "Which is O(1), and what's the catch?" |
| `.explain()` | `server/controllers/queryDemoController.js` | "How do you prove a query uses an index?" |
| `$indexStats` | `server/controllers/queryDemoController.js` | "How do you find indexes nobody uses?" |
| `insertMany` + batching | `server/seed.js` | "Insert 50k documents efficiently. Why batch, and what does `ordered:false` do?" |
| Build indexes after bulk load | `server/seed.js` | "How do you speed up a large data import?" |
| `autoIndex` in production | `server/models/*.js` | "Why is `autoIndex: true` dangerous in prod?" |
| `$regex` can't use an index | `server/controllers/taskController.js` | "Why is your search slow, and what's the ReDoS risk?" |

### Auth & authorization

| Concept | File | Likely interview question |
|---|---|---|
| **JWT anatomy** | `server/utils/tokens.js` | "What are a JWT's three parts? Is the payload encrypted?" *(No — base64 is encoding. Never put secrets in it.)* |
| **`verify()` vs `decode()`** | `server/middleware/auth.js`, `server/utils/tokens.js` | "What's the difference?" *(decode does ZERO verification — using it for auth is a total bypass.)* |
| The `alg: none` attack | `server/utils/tokens.js`, `server/tests/unit.tokens.test.js` | "How do you prevent algorithm confusion?" *(Always pass `algorithms: ['HS256']`.)* |
| **Access vs refresh tokens** | `server/controllers/authController.js` | "Why two tokens? Walk me through the whole flow." |
| **Stateless vs stateful trade-off** | `server/utils/tokens.js`, `server/models/RefreshToken.js` | "You can't revoke a JWT. So how does logout work?" |
| **Refresh rotation + reuse detection** | `server/controllers/authController.js` (`refresh`) | "How do you make refresh tokens safe if one is stolen?" |
| Hash refresh tokens at rest | `server/models/RefreshToken.js` | "Your sessions table leaks. How bad is it?" *(And why SHA-256 here but bcrypt for passwords?)* |
| **Token storage: XSS vs CSRF** | `server/utils/tokens.js` | "localStorage, memory, or httpOnly cookie?" *(No zero-risk option — reason about the trade-off.)* |
| Access token in body, refresh in cookie | `server/controllers/authController.js` | "Why the asymmetry?" *(Each token gets the protection matching its threat.)* |
| **bcrypt salt rounds** | `server/models/User.js`, `server/config/env.js` | "What are salt rounds? What's the trade-off?" |
| Salts embedded in the hash | `server/models/User.js` | "Why no separate salt column?" |
| bcrypt's 72-byte truncation | `server/middleware/validate.js` | "Why cap password length?" |
| **User enumeration + timing** | `server/controllers/authController.js` (`login`) | "What's wrong with 'no user with that email'?" *(And the timing leak even with identical messages.)* |
| **AuthN vs AuthZ** | `server/middleware/auth.js` | "Difference? Which is 401 and which is 403?" |
| **RBAC** | `server/middleware/auth.js` (`requireRole`) | "How do you implement roles? When does RBAC break down?" *(→ ABAC, ReBAC.)* |
| **IDOR** ⭐ | `server/middleware/auth.js` (`requireOwnership`) | "This route is authenticated. Is it secure?" *(The most important block in the codebase.)* |
| 404 vs 403 for enumeration | `server/middleware/auth.js` | "Why return 404 for someone else's resource?" |
| Token invalidation on password change | `server/models/User.js`, `server/middleware/auth.js` | "I changed my password — why is the attacker still logged in?" |
| Re-auth for sensitive actions | `server/controllers/authController.js` (`changePassword`) | "Why require the current password if they're already logged in?" |
| Session capping | `server/controllers/authController.js` | "A user logs in daily for a year. How many live credentials?" |
| Check-then-insert race | `server/controllers/authController.js` (`register`) | "Two simultaneous signups, same email. What happens?" |
| WebSocket auth | `server/server.js` | "How do you authenticate a WebSocket? What expires and when?" |

### Security

| Concept | File | Likely interview question |
|---|---|---|
| `helmet` headers | `server/app.js` | "What does helmet actually do? Name three headers and what they prevent." |
| **CORS: what it does NOT protect** | `server/app.js` | "Does CORS protect your API?" *(No — it's browser-enforced. curl ignores it entirely.)* |
| CORS + credentials | `server/app.js`, `client/src/api/axiosClient.js` | "Why can't you use `origin: '*'` with cookies?" |
| **Rate limiting algorithms** | `server/middleware/rateLimiter.js` | "Fixed window vs sliding window vs token bucket?" |
| In-memory store breaks at scale | `server/middleware/rateLimiter.js` | "You run 4 instances. Is your '5 attempts' limit still 5?" *(No — it's 20.)* |
| What to key a limit on | `server/middleware/rateLimiter.js` | "Why is keying on IP alone both too broad and too narrow?" |
| **NoSQL injection** | `server/middleware/validate.js` | "`{email: {$ne: null}}` as a login body. What happens?" |
| Prototype pollution | `server/middleware/validate.js` | "What's dangerous about a `__proto__` key in a request body?" |
| **Mass assignment** | `server/controllers/authController.js`, `server/middleware/validate.js` | "What's wrong with `User.create(req.body)`?" |
| **Escape on OUTPUT, not input** ⭐ | `server/middleware/validate.js` | "Should you HTML-escape user input before storing it?" *(No — it corrupts data and escapes for the wrong context. A test in this repo caught exactly that bug.)* |
| Validation vs sanitisation | `server/middleware/validate.js` | "What's the difference?" |
| express-validator vs Zod | `server/middleware/validate.js` | "Compare them." *(Zod's `.strict()` fixes mass assignment structurally.)* |
| Pagination limits as DoS defence | `server/middleware/validate.js` | "What does `?limit=1000000` do to your server?" |
| **Path traversal in uploads** | `server/middleware/upload.js` | "What's wrong with using `file.originalname` as the filename?" |
| MIME type is a client claim | `server/middleware/upload.js` | "How do you actually validate an upload's type?" |
| **CSV injection** | `server/controllers/taskController.js` | "A task title starts with `=`. What happens when the export opens in Excel?" |
| Stack traces in responses | `server/middleware/errorHandler.js` | "Why not return the stack trace?" |
| Secrets in git | `.gitignore`, `server/.env.example` | "How do you manage secrets?" |
| Separate JWT secrets | `server/config/env.js` | "What if access and refresh tokens share a secret?" |
| Non-root containers | `server/Dockerfile` | "Why not run as root in a container?" |
| `.dockerignore` as security | `server/.dockerignore` | "What ends up in your image without one?" *(`.env` and all of `.git`.)* |

### Performance & scaling

| Concept | File | Likely interview question |
|---|---|---|
| **Cache-aside pattern** | `server/utils/cache.js` | "Walk me through cache-aside. Contrast read-through and write-behind." |
| **Cache invalidation** | `server/utils/cache.js`, `server/controllers/taskController.js` | "User creates a task and doesn't see it. Why?" |
| Cache key design | `server/controllers/taskController.js` | "What must the key include?" *(Miss one input and you leak another user's data — a security bug, not a cache bug.)* |
| Thundering herd | `server/utils/cache.js` | "A hot key expires and 500 requests arrive. What happens?" |
| Cache must fail open | `server/utils/cache.js`, `server/config/redis.js` | "Redis is down. Should your API return 500?" |
| **Redis vs an in-process Map** | `server/config/redis.js` | "Why not just use a JS Map?" |
| `KEYS` blocks Redis | `server/utils/cache.js` | "What's wrong with `KEYS pattern*` in production?" |
| Redis eviction policy | `docker-compose.yml` | "When is `allkeys-lru` the *wrong* policy?" |
| **Offset vs cursor pagination** | `server/controllers/taskController.js` | "Paginate a million rows. What breaks with skip/limit?" |
| Cursor ties | `server/models/Task.js` | "Your cursor field isn't unique. What goes wrong?" |
| `compression` | `server/app.js` | "When does gzip *cost* you?" *(And what's BREACH?)* |
| **Debounce vs throttle** | `client/src/hooks/useDebounce.js` | "Which for a search box, which for scroll, and why?" |
| **Horizontal scaling** | `server/cluster.js`, this README | "How would you scale this to 10 servers?" |
| Distributed cron locking | `server/jobs/cleanupJob.js` | "You run 4 instances. How many times does your 3 a.m. job fire?" *(Four.)* |
| `SET NX EX` locks | `server/jobs/cleanupJob.js` | "Implement a distributed lock. What if the holder crashes?" |
| Request IDs / tracing | `server/middleware/requestLogger.js` | "How do you debug one request across five services?" |
| Monotonic clocks | `server/middleware/requestLogger.js` | "Why not `Date.now()` for measuring duration?" |
| Percentiles over averages | `server/middleware/requestLogger.js` | "Why p99 instead of the mean?" |

### React

| Concept | File | Likely interview question |
|---|---|---|
| `useState` / `useEffect` | throughout `client/src` | — |
| **Class lifecycle → hooks** | `client/src/context/AuthContext.jsx` | "What do `componentDidMount`/`DidUpdate`/`WillUnmount` map to?" |
| **`useEffect` cleanup** | `client/src/hooks/useDebounce.js`, `client/src/components/Navbar.jsx` | "When does the cleanup function run, and what leaks without it?" |
| **`useRef`: DOM access** | `client/src/components/TaskForm.jsx` | "When do you reach for a ref?" |
| **`useRef`: persist without re-render** | `client/src/components/TaskForm.jsx`, `client/src/context/AuthContext.jsx` | "Difference between `useRef` and `useState` for storing a value?" |
| **`useMemo` / `useCallback`** | `client/src/components/TaskList.jsx` | "When does memoisation help, and when does it cost more than it saves?" |
| `React.memo` + `useCallback` pairing | `client/src/components/TaskList.jsx` | "I wrapped my component in `memo` and it still re-renders. Why?" |
| **`key` prop / why index is a bug** | `client/src/components/TaskList.jsx` | "Why not use the array index as a key?" *(State attaches to the wrong row.)* |
| `useReducer` vs `useState` | `client/src/context/TaskContext.jsx` | "When would you reach for `useReducer`?" |
| Reducers must be pure | `client/src/context/TaskContext.jsx` | "Why can't you mutate state in a reducer?" |
| **Controlled vs uncontrolled** | `client/src/components/TaskForm.jsx` | "Difference? Which is faster? Why must a file input be uncontrolled?" |
| **Context & prop drilling** | `client/src/context/AuthContext.jsx` | "What problem does Context solve, and what's its big limitation?" |
| `useMemo` on the Provider value | `client/src/context/AuthContext.jsx` | "Why does every consumer re-render even when nothing changed?" |
| Custom hook wrapping `useContext` | `client/src/context/AuthContext.jsx` | "Why not export the raw context?" |
| **Context vs Redux vs Zustand** | `client/src/store/taskStore.js`, `client/src/pages/ZustandPage.jsx` | "Which would you pick?" *(Best answer: first ask whether it's server state.)* |
| **Selector subscriptions** | `client/src/store/taskStore.js`, `client/src/pages/ZustandPage.jsx` | "How does Zustand avoid Context's re-render problem?" *(Live render counters in the UI.)* |
| Zustand's SSR singleton risk | `client/src/store/taskStore.js` | "What breaks if you use a module-level store with SSR?" |
| **Error boundaries** | `client/src/components/ErrorBoundary.jsx` | "Why must they be class components? What do they NOT catch?" |
| **Code splitting** | `client/src/App.jsx` | "How does `React.lazy` work, and where should you split?" |
| `Suspense` placement | `client/src/App.jsx` | "Where do you put the boundary, and why is the Navbar outside it?" |
| **Axios interceptors** | `client/src/api/axiosClient.js` | "How do you transparently refresh an expired token?" |
| **Single-flight refresh** ⭐ | `client/src/api/axiosClient.js` | "Five parallel requests all 401 at once. What happens?" *(Naive code triggers reuse detection and logs the user out at random.)* |
| The `_retry` flag | `client/src/api/axiosClient.js` | "How do you prevent an infinite refresh loop?" |
| **Manual fetch race condition** | `client/src/hooks/useFetch.js` | "Type 'a' then 'ab'. The slow 'a' response lands last. What now?" |
| `AbortController` | `client/src/hooks/useFetch.js` | "How do you cancel an in-flight request?" |
| Unstable dep arrays | `client/src/hooks/useFetch.js` | "Why is my API called 400 times?" |
| **React Query vs manual fetching** | `client/src/pages/ReactQueryPage.jsx` | "What does React Query give you that `useEffect` doesn't?" |
| `queryKey` as cache key | `client/src/pages/ReactQueryPage.jsx` | "How does React Query know what to cache and invalidate?" |
| `staleTime` vs `gcTime` | `client/src/pages/ReactQueryPage.jsx` | "Difference? Why does mine refetch constantly?" |
| `isLoading` vs `isFetching` | `client/src/pages/ReactQueryPage.jsx` | "Why does my page flash a spinner on tab focus?" |
| **Optimistic updates + rollback** | `client/src/pages/ReactQueryPage.jsx`, `client/src/context/TaskContext.jsx` | "How do you make a delete feel instant but stay correct?" |
| **Server state vs client state** ⭐ | `client/src/pages/ReactQueryPage.jsx`, `client/src/hooks/useFetch.js` | "What belongs in Redux?" *(Usually far less than people think.)* |
| **Protected routes are NOT security** | `client/src/routes/ProtectedRoute.jsx` | "Your route guard checks `isAdmin`. Is that secure?" |
| The loading state in a guard | `client/src/routes/ProtectedRoute.jsx` | "Why does refreshing a protected page flash the login screen?" |
| **StrictMode double-invoke** | `client/src/main.jsx`, `client/src/context/AuthContext.jsx` | "Why does my `useEffect` run twice?" *(And why removing StrictMode is the wrong fix.)* |
| `createRoot` / concurrent React | `client/src/main.jsx` | "What changed in React 18?" |
| SPA vs SSR trade-offs | `client/index.html` | "Why is my React site bad for SEO?" |
| Vite vs CRA | `client/vite.config.js` | "Why is Vite's dev server so much faster?" |
| Vendor chunk splitting | `client/vite.config.js` | "How do you stop every deploy busting your users' cache?" |
| Build-time env vars | `client/.env.example`, `client/Dockerfile` | "Why can't one frontend build serve staging and prod?" |

### Testing

| Concept | File | Likely interview question |
|---|---|---|
| **Unit tests on pure functions** | `server/tests/unit.tokens.test.js` | "What makes code easy to test?" |
| Testing that tampering fails | `server/tests/unit.tokens.test.js` | "How do you test that your JWT verification actually verifies?" |
| **Integration tests with Supertest** | `server/tests/integration.auth.test.js` | "What does an integration test catch that a unit test can't?" |
| In-memory MongoDB | `server/tests/setup.js` | "How do you test database code? Mock it or use a real DB?" |
| Test isolation | `server/tests/setup.js` | "Your tests pass alone and fail together. Why?" |
| **The IDOR test** ⭐ | `server/tests/integration.tasks.test.js` | "Write one security test. Which one?" |
| Testing RBAC both ways | `server/tests/integration.tasks.test.js` | "How do you test authorization?" |
| **Mocking: when and when not** | `server/tests/mocking.test.js` | "When do you mock? What's the risk of over-mocking?" |
| Stub vs spy vs mock vs fake | `server/tests/mocking.test.js` | "Define them." |
| Mocking a chainable query | `server/tests/mocking.test.js` | "How do you mock `Model.find().select().lean()`?" |
| **Fake timers** | `server/tests/mocking.test.js`, `client/src/test/TaskForm.test.jsx` | "How do you test a 7-day expiry without waiting 7 days?" |
| Coverage thresholds & limits | `server/jest.config.js` | "Is 100% coverage a good goal?" *(No — it measures execution, not assertions.)* |
| `--runInBand` / worker isolation | `server/jest.config.js` | "Why do parallel integration tests go flaky?" |
| **RTL query priority** | `client/src/test/setup.js`, `client/src/test/TaskForm.test.jsx` | "Why query by role instead of class name?" |
| `renderHook` | `client/src/test/TaskForm.test.jsx` | "How do you test a custom hook?" |
| **Rate limiters break test suites** ⭐ | `server/middleware/rateLimiter.js` | "Your suite fails after the 10th test with a weird undefined error. Why?" *(Real bug hit while building this — every test shares one IP bucket.)* |

### DevOps

| Concept | File | Likely interview question |
|---|---|---|
| **Multi-stage builds** | `server/Dockerfile` | "How do you get a Node image from 1.2 GB to 180 MB?" |
| **Layer caching** ⭐ | `server/Dockerfile` | "Why copy `package.json` before the source?" |
| `npm ci` vs `npm install` | `server/Dockerfile` | "Which in CI, and why?" |
| Build targets | `server/Dockerfile`, `docker-compose.yml` | "One Dockerfile for dev and prod — how?" |
| **`dumb-init` / PID 1** | `server/Dockerfile` | "Your SIGTERM handler never fires in Docker. Why?" |
| exec vs shell form `CMD` | `server/Dockerfile` | "Why is `CMD ["node","server.js"]` better than `CMD node server.js`?" |
| Compose service DNS | `docker-compose.yml` | "Why `mongo:27017` and not `localhost:27017`?" |
| `depends_on: service_healthy` | `docker-compose.yml` | "Your API crash-loops on startup because Mongo isn't ready. Fix it." |
| Volumes & the node_modules trap | `docker-compose.yml` | "Bind-mounting your source breaks `node_modules`. Why?" |
| **Frontend ≠ backend container** | `client/Dockerfile` | "How do you containerise a React app?" *(Build with Node, serve with nginx — or don't containerise it at all.)* |
| **SPA `try_files` fallback** ⭐ | `client/Dockerfile` | "Navigating to /tasks works, refreshing gives 404. Why?" |
| Asset caching strategy | `client/Dockerfile` | "Cache `/assets` forever but never `index.html`. Why?" |
| Compose vs Kubernetes | `docker-compose.yml` | "Would you use compose in production?" |

---

## How this app would scale horizontally

A standard interview question, and this codebase is built to answer it concretely.

### What already works

**Stateless auth is the enabler.** Access tokens are verified by signature alone (`server/middleware/auth.js`), so **any instance can serve any request**. No sticky sessions, no shared session store, no session replication. Put ten instances behind a load balancer with plain round-robin and it works.

```
                    ┌─────────────┐
   Internet ───────▶│ Load balancer│ (ALB / nginx / Cloudflare)
                    └──────┬───────┘
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐   ┌────────┐   ┌────────┐
         │ Node 1 │   │ Node 2 │   │ Node N │   ← stateless, disposable
         └───┬────┘   └───┬────┘   └───┬────┘
             └────────────┼────────────┘
                 ┌────────┴────────┐
                 ▼                 ▼
          ┌────────────┐    ┌───────────┐
          │  MongoDB   │    │   Redis   │   ← ALL shared state lives here
          │ (replica   │    │ (cache,   │
          │   set)     │    │  locks)   │
          └────────────┘    └───────────┘
```

### What must move out of the process

This is the recurring lesson of the whole codebase — **any state shared between requests must live outside the process.** Each of these is commented in place:

| Per-process state | Breaks how | Fix |
|---|---|---|
| In-memory cache fallback | N divergent caches; invalidation hits one process (`config/redis.js`) | Redis |
| `express-rate-limit` default store | "5 attempts" becomes 5 × N (`middleware/rateLimiter.js`) | `rate-limit-redis` |
| `EventEmitter` listeners | An event on instance A never reaches instance B (`utils/activityLogger.js`) | Redis pub/sub or a real queue |
| Socket.io connections | A client on instance A misses events emitted on B (`server.js`) | `@socket.io/redis-adapter` |
| In-process cron | The job fires N times (`jobs/cleanupJob.js`) | Distributed lock, or a dedicated scheduler |
| Uploaded files on local disk | Invisible to other instances; lost on redeploy (`middleware/upload.js`) | S3 + pre-signed URLs |

### Then, in order of cost

1. **Vertical + cluster first.** `cluster.js` uses all cores on one box. Cheapest win — do this before adding machines.
2. **Read scaling.** MongoDB replica set with `readPreference: secondaryPreferred` for analytics-style reads. ⚠️ Replication lag means a read straight after a write may not see it.
3. **Connection-pool arithmetic.** N instances × `maxPoolSize` is your total connection count. 10 pods × 100 = 1,000 connections, which will exhaust a small Atlas tier. Tune it (`config/db.js`).
4. **CDN for static assets.** The React bundle should never be served by Node.
5. **Move heavy work off the request path.** CSV exports and reports → a queue (BullMQ/SQS) with workers, so a big export can't affect request latency.
6. **Sharding, last.** Only when one primary can no longer hold the write volume. Choosing a shard key is hard to undo — a low-cardinality key creates hotspots.

### The bottleneck order in practice

Database → cache → app CPU. Almost always. Which is why the N+1 and indexing demos matter more than any amount of Node micro-optimisation.

---

## Project structure

```
/server
  /config          env (validated, fail-fast), db (pooling), redis (fail-open)
  /models          User (hooks, select:false), Task (indexes/ESR), RefreshToken (TTL, rotation)
  /controllers     auth, task (pagination/cache/streams/aggregation),
                   queryDemo (slow vs fast), admin (RBAC, worker threads)
  /routes          wiring only — no logic
  /middleware      auth (AuthN/AuthZ/IDOR), errorHandler (4-arg), rateLimiter,
                   validate (injection/mass-assignment), requestLogger, upload
  /utils           tokens (JWT internals), asyncHandler, activityLogger (EventEmitter),
                   cache (cache-aside), logger, ApiError,
                   eventLoopDemo / bufferDemo / callbackDemo  ← runnable
  /jobs            cleanupJob (cron + distributed lock)
  /workers         reportWorker (worker thread)
  /tests           unit, integration (auth + tasks/IDOR), mocking
  app.js           Express wiring — middleware order matters, read top to bottom
  server.js        HTTP server, Socket.io, graceful shutdown
  cluster.js       multi-core entry point
  seed.js          bulk data generator

/client/src
  /api             axiosClient — interceptors, single-flight refresh
  /context         AuthContext, TaskContext (useReducer)
  /store           taskStore — Zustand, with selectors
  /hooks           useAuth, useFetch (race conditions), useDebounce
  /components      ErrorBoundary (the only class), TaskForm (controlled vs
                   uncontrolled), TaskList (memo), Navbar
  /pages           Login, Register, Tasks (Context), ReactQuery, Zustand,
                   QueryDemo, Admin
  /routes          ProtectedRoute + PublicRoute
  /test            Vitest + React Testing Library
```

---

## Notes on deliberate choices

- **CommonJS on the server, ESM on the client.** So the repo demonstrates both. The full comparison table is at the top of `server/app.js`.
- **`bcryptjs` not `bcrypt`.** Pure JS, so it installs anywhere without a compiler toolchain. Same algorithm and hash format; ~30% slower. `server/models/User.js` explains when you'd want the native one.
- **`legacyTag` is deliberately unindexed.** It's the control group that makes the COLLSCAN demo real.
- **Rate limiting is disabled when `NODE_ENV=test`.** Not a shortcut — see the concept block in `server/middleware/rateLimiter.js`. It's a genuine lesson about middleware keyed on values that are constant in tests.
- **No `.escape()` on stored fields.** Escaping belongs at output, in the render context. A test in this repo caught the data-corruption bug that input-escaping causes; the reasoning is in `server/middleware/validate.js`.
- **Business logic is intentionally thin.** It's a task manager. The code exists to demonstrate concepts, not to be a product.
