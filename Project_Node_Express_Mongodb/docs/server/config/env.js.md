# `server/config/env.js`

> The only file in the project that reads `process.env`. Validates at boot and exports a plain config object.

**Lines:** 142 · **Concept blocks:** 6

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Centralised, validated config** | ⭐ "What happens if a required env var is missing?" — weak answer: the app boots and crashes later. Strong answer: **fail fast at boot** ("crash early, crash loud"), because a misconfigured process that *looks* healthy will pass a load-balancer health check and serve broken traffic. |
| **dotenv load order** | dotenv **does not overwrite** variables already in the real environment. That's deliberate: in production the platform injects real values and there is no `.env` file at all, so the same code works everywhere with the real environment always winning. Loaded via an explicit path, so running from the repo root still finds the file. |
| **Separate secrets for access vs refresh** | ⚠️ If both token types share a secret, an attacker holding a long-lived **refresh** token can send it as an **access** token — the signature verifies and `verifyAccessToken` trusts it. Instant privilege escalation. |
| **CORS allowlist, not wildcard** | Parsed from a comma-separated string. `origin: '*'` + `credentials: true` is rejected by browsers per spec. |
| **bcrypt salt rounds trade-off** | It's a **cost factor, and exponential** — rounds=12 is ~4× slower than 10. Higher = slower for an offline attacker brute-forcing a leaked dump, but also slower for your login endpoint, and bcrypt is CPU-bound so it blocks a worker. 10–12 is the production answer. Forced to 4 in tests. |
| **Fail fast on insecure production config** | If `NODE_ENV=production` and the secrets still look like dev placeholders (or are under 32 chars), **refuse to start**. Shipping dev defaults to production is one of the most common real incidents. |

## Exported shape

```js
{
  env, isTest, isProd, isDev,
  port,
  mongoUri,                          // switches to MONGO_URI_TEST when NODE_ENV=test
  jwt: { accessSecret, refreshSecret,
         accessExpiresIn, refreshExpiresIn, refreshExpiresMs },
  redis: { url, ttlSeconds },
  clientOrigins: [...],              // parsed array, not a string
  security: { bcryptSaltRounds, rateLimitWindowMs,
              rateLimitMax, loginRateLimitMax },
  features: { socketIo, cronJobs },  // both force-false in test
  logLevel,
}
```

## Helpers

| Function | Behaviour |
|---|---|
| `required(key, fallback)` | **Throws** if absent. Used for production secrets. |
| `optional(key, fallback)` | Returns the fallback. |
| `toInt` / `toBool` | Coercion — env vars are always strings, so `PORT` would otherwise be `"5000"` and `ENABLE_X=false` would be **truthy**. |

That last point is a real bug source: `if (process.env.ENABLE_CRON_JOBS)` is `true` for the string `"false"`.

## Why `required()` throws instead of returning an error

It's a synchronous pure function called at module load. There's no caller to hand an error to and no request to fail — throwing at import time is exactly the "crash at boot" behaviour you want. Contrast with the [error-first callback convention](../utils/callbackDemo.js.md), which applies to *asynchronous* operations.

## Dev defaults, deliberately

In non-production the JWT secrets fall back to `dev-only-...` placeholders so the project runs with zero setup. The production guard at the bottom is what makes that safe:

```js
if (isProd) {
  const weak = [accessSecret, refreshSecret].some(
    s => s.startsWith('dev-only-') || s.startsWith('replace_me') || s.length < 32
  );
  if (weak) throw new Error('Refusing to boot in production with weak/default JWT secrets.');
}
```

Convenience in dev, a hard stop in prod.

## Interview questions

- **"How do you validate configuration?"** → At boot, in one module, failing loudly. Never lazily on first use.
- **"What if access and refresh tokens shared a secret?"** → A refresh token would validate as an access token. Privilege escalation.
- **"What are bcrypt salt rounds and what's the trade-off?"** → An exponential work factor. Higher resists offline cracking but costs login latency and CPU on a single-threaded runtime.
- **"Why is `ENABLE_X=false` not working?"** → Env vars are strings; `"false"` is truthy. You must coerce.

## Related

- [`.env.example`](../env.example.md) — the contract this validates
- [`utils/tokens.js`](../utils/tokens.js.md) — consumes the JWT config
- [`models/User.js`](../models/User.js.md) — consumes `bcryptSaltRounds`
- [`utils/logger.js`](../utils/logger.js.md) — the one module that *doesn't* import this, to avoid a cycle
