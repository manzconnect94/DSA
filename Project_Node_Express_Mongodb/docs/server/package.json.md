# `server/package.json`

> Backend dependencies and scripts. CommonJS (no `"type": "module"`).

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `start` | `node server.js` | Production |
| `dev` | `nodemon server.js` | Auto-restart on change |
| `cluster` | `node cluster.js` | [Multi-core mode](./cluster.js.md) |
| `seed` / `seed:big` | `node seed.js [--tasks=50000]` | [Test data](./seed.js.md) |
| `demo:eventloop` | `node utils/eventLoopDemo.js` | [Runnable demo](./utils/eventLoopDemo.js.md) |
| `demo:buffer` | `node utils/bufferDemo.js` | [Runnable demo](./utils/bufferDemo.js.md) |
| `demo:callback` | `node utils/callbackDemo.js` | [Runnable demo](./utils/callbackDemo.js.md) |
| `test` | `cross-env NODE_ENV=test jest --runInBand --forceExit` | [80 tests](./jest.config.js.md) |

## Dependencies, and what each demonstrates

| Package | Used for | Doc |
|---|---|---|
| `express` ^4.19 | HTTP framework | [app.js](./app.js.md) |
| `mongoose` ^8.5 | ODM — schemas, hooks, indexes | [models/](./models/README.md) |
| `bcryptjs` ^2.4 | Password hashing | [models/User.js](./models/User.js.md) |
| `jsonwebtoken` ^9.0 | JWT sign/verify | [utils/tokens.js](./utils/tokens.js.md) |
| `ioredis` ^5.4 | Cache client | [config/redis.js](./config/redis.js.md) |
| `helmet` ^7.1 | Security headers | [app.js](./app.js.md) |
| `cors` ^2.8 | Origin allowlist | [app.js](./app.js.md) |
| `compression` ^1.7 | Response gzip | [app.js](./app.js.md) |
| `cookie-parser` ^1.4 | Reads the refresh cookie | [app.js](./app.js.md) |
| `express-rate-limit` ^7.4 | Brute-force protection | [middleware/rateLimiter.js](./middleware/rateLimiter.js.md) |
| `express-validator` ^7.1 | Input validation | [middleware/validate.js](./middleware/validate.js.md) |
| `multer` ^1.4 | multipart/form-data | [middleware/upload.js](./middleware/upload.js.md) |
| `node-cron` ^3.0 | Scheduled jobs | [jobs/cleanupJob.js](./jobs/cleanupJob.js.md) |
| `socket.io` ^4.7 | Real-time | [server.js](./server.js.md) |
| `dotenv` ^16.4 | Loads `.env` | [config/env.js](./config/env.js.md) |

**Deliberately absent:** Winston (hand-rolled in [`utils/logger.js`](./utils/logger.js.md) so the concept is visible), `express-mongo-sanitize` (hand-rolled in [`validate.js`](./middleware/validate.js.md) for the same reason), and `rate-limit-redis` (shown commented, to make the in-memory-store problem explicit).

## devDependencies

| Package | Purpose |
|---|---|
| `jest` ^29.7 | Test runner |
| `supertest` ^7.0 | Drives the Express app without a port |
| `mongodb-memory-server` ^10.0 | **Real** mongod against RAM — see [tests/setup.js](./tests/setup.js.md) |
| `nodemon` ^3.1 | Dev auto-restart |
| `cross-env` | ⚠️ Windows: `NODE_ENV=test jest` is bash syntax and fails in cmd.exe |

## Why `bcryptjs` and not `bcrypt`

| | `bcrypt` (native) | `bcryptjs` (pure JS) |
|---|---|---|
| Speed | Faster | ~30% slower |
| Install | Needs node-gyp + a compiler | Works anywhere |
| Hash format | **Identical** — fully interchangeable | |

For a study repo that must install on Windows and in slim Docker images, `bcryptjs` is the pragmatic call. In a high-traffic production login path you'd use native `bcrypt` or `argon2`. Either way, bcrypt is CPU-bound and blocks the event loop — a genuine reason to run [multiple workers](./cluster.js.md).

## Interview questions

- **"`npm ci` or `npm install` in CI?"** → `npm ci`. It installs exactly what the lockfile says, errors if the manifest and lock disagree, and is faster. `npm install` may silently update the lock, making builds non-deterministic.
- **"What's the risk of a dependency like `express-mongo-sanitize`?"** → Not the package itself, but that it hides the mechanism. Knowing it strips `$`-prefixed and dotted keys means you can reason about what it does and doesn't cover.

## Related

- [Root `package.json`](../package.json.md) · [`Dockerfile`](./Dockerfile.md) · [`jest.config.js`](./jest.config.js.md)
