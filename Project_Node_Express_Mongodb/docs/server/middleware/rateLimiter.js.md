# `server/middleware/rateLimiter.js`

> Brute-force and abuse protection. Four limiters with deliberately different strictness.

**Lines:** 199 · **Concept blocks:** 8

## Why it matters

Without it, an attacker can try 10,000 passwords per second against `/login`. bcrypt makes each guess expensive **for you** as well as for them, so an unthrottled login endpoint is simultaneously a credential-stuffing target **and a DoS amplifier** — each request costs ~100ms of CPU on a single-threaded runtime.

## The exports

| Limiter | Window | Max | Applied |
|---|---|---|---|
| `globalLimiter` | 15 min | 100 | App-level on `/api` |
| `loginLimiter` | 15 min | **5** | Route-level on `/login` |
| `registerLimiter` | 1 hour | 10 | Route-level on `/register` |
| `expensiveLimiter` | 1 min | 10 | `/tasks/export`, all of `/api/demo` |

## ⭐ The three algorithms

| | How it works | Trade-off |
|---|---|---|
| **Fixed window** | A counter that resets at the boundary. Simplest and cheapest. | ⚠️ **The edge-burst flaw:** a client can send 100 requests at 14:59 and 100 more at 15:01 — **200 in two minutes**, while never technically breaking the limit. |
| **Sliding window** | Counts requests in the trailing N minutes from *now*, so there's no boundary to exploit. | More accurate, more expensive — you track timestamps, not just a counter. |
| **Token bucket** | A bucket holds N tokens, refills at a fixed rate; each request spends one. | Allows short **bursts** while capping the sustained average. **What most APIs and CDNs actually use**, because bursty traffic is normal and legitimate. *(Leaky bucket is the sibling: smooths output to a constant rate.)* |

`express-rate-limit` uses fixed window by default, which is what's here.

## ⚠️ In-memory store — THE production gotcha

`express-rate-limit` defaults to an **in-memory** store. Run 4 instances behind a load balancer and each keeps its **own** counter, so your "5 attempts" limit is really **20** — and it resets on every deploy.

**This is the single most common rate-limiting mistake in production, and it's invisible in dev** where you run one process. The fix is a shared store (`rate-limit-redis`), shown commented in the file.

⭐ Note this is the **same argument** as [Redis vs a Map](../config/redis.js.md): per-process state does not survive horizontal scaling. Collected in [`cluster.js`](../cluster.js.md).

## ⭐ What to key the limit on

The default key is the IP address, and IP alone fails in **opposite directions**:

| Failure | Detail |
|---|---|
| **Too broad** | An entire office, university or mobile carrier shares one NAT'd IP. Limiting by IP **locks out hundreds of innocent users** when one misbehaves. Same with corporate VPNs. |
| **Too narrow** | IPv6 hands a single user a whole **/64**. Rotate addresses within it and the limit is free to bypass. (Key on the /64 prefix.) |

**Better keys:** the authenticated user id, an API key, or — for login specifically — **IP + submitted email**, so an attacker hammering one account can't lock out everyone on their IP, and distributed attacks on one account are still caught. That's what `loginLimiter` does.

## `skipSuccessfulRequests`

Only **failed** logins count. A user who logs in successfully five times (tabs, devices) shouldn't be locked out — they've clearly proven they know the password. Counting only failures **targets the limiter precisely at guessing behaviour**.

## 429 + `Retry-After`

429 is the correct status, and a well-behaved API also sends `Retry-After` (seconds) and the `RateLimit-*` headers so clients can back off intelligently. **A client that retries immediately on 429 turns a throttle into an outage.**

`standardHeaders: true` sends `RateLimit-Limit`/`Remaining`/`Reset`; `legacyHeaders: false` suppresses the deprecated `X-RateLimit-*`.

## Cost-based limiting

Not all requests cost the same: a cached GET is microseconds; the [demo query](../controllers/queryDemoController.js.md) scans 50,000 documents and the [CSV export](../controllers/taskController.js.md) streams the whole collection. A flat limit is **simultaneously too strict for cheap endpoints and far too lax for expensive ones**. Mature APIs assign a cost/weight per endpoint and deduct from a shared budget — GitHub's GraphQL API is the canonical public example. `expensiveLimiter` is a simple version.

## ⭐ Disabled in tests — a real bug from this project

**The test suite failed with 27 errors until this was added.** Every Supertest request originates from `127.0.0.1`, so the whole suite shares **one bucket**. `registerLimiter` allows 10/hour; the 11th test that registers a user got a **429**, and every assertion after it failed with a confusing "cannot read property of undefined" rather than an obvious "you were rate limited".

⚠️ **The general principle:** middleware keyed on a request attribute that is **constant in tests** (IP, user agent) will **silently couple your tests together**. The same applies to caches. Either disable it in the test env or make the key include a per-test identifier.

Also note the counters are in-memory, so they don't reset between test *files* in one Jest process either.

## ⚠️ What rate limiting does NOT protect you from

Naming the limits of your own defence is a strong signal. Application-level rate limiting runs **inside** your Node process — so a volumetric DDoS has already consumed a socket, a TLS handshake and event-loop time before the limiter says no.

**Real DDoS protection lives upstream:** Cloudflare, AWS WAF/Shield, or the load balancer. App-level limiting is for **API abuse, brute force and runaway clients** — layer 7 fairness, not layer 3/4 volume.

⚠️ Also: `req.ip` is only trustworthy if [`trust proxy`](../app.js.md) is configured correctly. Behind a misconfigured proxy every request appears to come from the load balancer, and your per-IP limit becomes **one global limit for all users**.

## Interview questions

- **"Fixed window vs sliding window vs token bucket?"** → The table. Lead with the edge-burst flaw — that's what shows you've thought about it.
- **"You run 4 instances. Is your 5-attempt limit still 5?"** → No, it's 20. Needs a shared store.
- **"Why is keying on IP both too broad and too narrow?"** → NAT vs IPv6 /64.
- **"Does rate limiting stop a DDoS?"** → No. It's inside your process; the damage is already done. DDoS defence is upstream.
- **"Should successful logins count toward the limit?"** → No — only failures. Otherwise you punish legitimate multi-device users.
- **"Your test suite fails after the 10th test with a weird undefined error."** → The rate limiter. Every test shares one IP bucket.

## Related

- [`config/redis.js`](../config/redis.js.md) — the identical per-process problem
- [`cluster.js`](../cluster.js.md) — where it becomes concrete
- [`app.js`](../app.js.md) — `trust proxy`, without which `req.ip` is wrong
- [`routes/authRoutes.js`](../routes/authRoutes.js.md) — why the limiter is first in the chain
- [`jest.config.js`](../jest.config.js.md) — `NODE_ENV=test`, which is load-bearing here
