# `server/.env.example`

> The committed template listing every environment variable — keys only, never values.

**Concept blocks:** 1 · **Setup:** `cp server/.env.example server/.env` (works as-is for local dev)

## Concept

| Concept | Takeaway |
|---|---|
| **Environment configuration** | 12-factor style: config lives in the environment, not in code. Secrets are never committed, because **anything in git history is effectively public forever** — even after a later delete commit. This file is committed *precisely so* a new developer knows which variables exist without ever seeing the secrets. |

## Variables

### Runtime
| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | Load-bearing — `test` changes DB, bcrypt rounds, Redis, rate limiting |
| `PORT` | `5000` | |

### Database
| Variable | Notes |
|---|---|
| `MONGO_URI` | Pool size is set in [`config/db.js`](./config/db.js.md), not here |
| `MONGO_URI_TEST` | Used when `NODE_ENV=test` |

### JWT
| Variable | Default | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | dev placeholder | ⚠️ **Must differ from the refresh secret** |
| `JWT_REFRESH_SECRET` | dev placeholder | " |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Your maximum exposure window for a stolen access token |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Revocable via the DB, so a long life is acceptable |

> **Why two different secrets:** if they were the same, an attacker holding a long-lived refresh token could send it as an access token — the signature would verify and `verifyAccessToken` would trust it. Instant privilege escalation. Different secrets make the two token families cryptographically non-interchangeable. Enforced in [`config/env.js`](./config/env.js.md) and [tested](./tests/unit.tokens.test.js.md).

### Redis
| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | If unreachable, falls back to an in-memory Map and says so loudly |
| `CACHE_TTL_SECONDS` | `60` | Jittered ±10% to avoid [synchronised expiry](./utils/cache.js.md) |

### CORS
| Variable | Notes |
|---|---|
| `CLIENT_ORIGIN` | Comma-separated allowlist. **Not a wildcard** — `origin: '*'` and `credentials: true` are mutually exclusive per the CORS spec. |

### Security & limits
| Variable | Default | Notes |
|---|---|---|
| `BCRYPT_SALT_ROUNDS` | `10` | **Exponential** cost factor — 12 is ~4× slower than 10. Forced to 4 in tests. |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | |
| `RATE_LIMIT_MAX` | `100` | Global backstop |
| `LOGIN_RATE_LIMIT_MAX` | `5` | Strict — guards credentials |

### Feature flags
| Variable | Default | Notes |
|---|---|---|
| `ENABLE_SOCKET_IO` | `true` | Auto-disabled in tests |
| `ENABLE_CRON_JOBS` | `false` | ⚠️ Off by default because [in-process cron fires N times](./jobs/cleanupJob.js.md) when you scale |
| `LOG_LEVEL` | `debug` | `error` in tests to keep output readable |

## Why dotenv doesn't overwrite real env vars

`dotenv` deliberately never overrides a variable that already exists in the process environment. In production (Docker/Kubernetes/Heroku) the platform injects real values and there is no `.env` file at all — so the same code works in both places, with the real environment always winning.

## Interview questions

- **"How do you handle config across dev/staging/prod?"** → Environment variables, validated at boot. A committed `.env.example` documents the contract; real values come from the platform's secret store.
- **"What happens if a required variable is missing?"** → Weak answer: the app boots and crashes later. Strong answer: **fail fast at boot**, because a misconfigured process that looks healthy will pass a load-balancer health check and serve broken traffic. See [`config/env.js`](./config/env.js.md).
- **"Why commit an example file at all?"** → It's the contract. Without it, onboarding is archaeology through `process.env` references.

## Related

- [`config/env.js`](./config/env.js.md) — the only file that reads `process.env`
- [`.gitignore`](../gitignore.md) · [`.dockerignore`](./dockerignore.md) — the two places `.env` must be excluded
- [`client/.env.example`](../client/env.example.md) — ⚠️ where nothing is secret
