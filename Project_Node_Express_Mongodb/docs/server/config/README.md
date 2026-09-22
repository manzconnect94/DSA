# `server/config/`

> Infrastructure connections and configuration. Three files, each owning exactly one external concern.

## Files

| File | Doc | Owns | Lines |
|---|---|---|---|
| `env.js` | [→](./env.js.md) | **Every** `process.env` read in the codebase | 142 |
| `db.js` | [→](./db.js.md) | The MongoDB connection and its pool | 88 |
| `redis.js` | [→](./redis.js.md) | The cache client, with an in-memory fallback | 127 |

## The organising rule

> **One place per external dependency, and one place for configuration.**

`env.js` is the only file in the project that touches `process.env`. Everything else imports a plain object. That gives you:

- **One place to audit** what the app is configured by
- **No `process.env.TYPO`** silently returning `undefined` in some far-away module
- **One place to validate**, so misconfiguration fails at boot rather than on the first request

## Load order and the circular-require trap

```
utils/logger.js   ← reads process.env.LOG_LEVEL DIRECTLY
      ▲
      │ required by
      │
config/env.js     ← validates everything else
      ▲
      ├── config/db.js
      ├── config/redis.js
      └── everything else
```

⚠️ `logger.js` deliberately reads `process.env.LOG_LEVEL` itself instead of importing `env.js`. If it imported `env.js`, and `env.js` imports `logger.js` to report problems, you'd have a **circular require** — and in CommonJS that doesn't error, it silently returns a partially-populated module. The result would be `logger.info is not a function` at boot, with a confusing stack. Breaking the cycle at the logger is the fix.

This is worth knowing as a general CJS property: circular imports resolve to a *partial* object rather than throwing, so the failure appears far from the cause. ESM handles this differently (hoisted bindings, throws on TDZ access) — see the comparison in [`app.js`](../app.js.md).

## Environment-dependent behaviour

`NODE_ENV=test` changes all three files at once:

| | dev/prod | test |
|---|---|---|
| Database | `MONGO_URI` | `MONGO_URI_TEST` (and [tests](../tests/setup.js.md) override it entirely with an in-memory server) |
| bcrypt rounds | 10 | 4 (so hashing doesn't dominate the suite) |
| Redis | Real client, fallback on failure | Always the in-memory client — **tests must never depend on an external service** |
| Socket.io / cron | Per flag | Force-disabled |
| Log level | `debug` | `error` |

## Interview questions

- **"Where should configuration live?"** → In the environment, read and validated in exactly one module, consumed as a typed object. Not scattered `process.env` reads.
- **"What happens if a required env var is missing?"** → It should crash at boot, loudly. A process that boots misconfigured will pass a health check and serve broken traffic.
- **"You have a circular require. What does Node do?"** → Returns the partially-initialised module rather than erroring, so you get a confusing `undefined is not a function` far from the cause.

## Related

- [`server/README.md`](../README.md) — how config fits the layering
- [`.env.example`](../env.example.md) — the variable contract
- [`utils/logger.js`](../utils/logger.js.md) — the one deliberate exception to the rule
