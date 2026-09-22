# `server/app.js`

> Builds and exports the Express app. Deliberately never calls `listen()` — that belongs to [`server.js`](./server.js.md).

**Lines:** 345 · **Concept blocks:** 10

## What it does

This file *is* the request lifecycle, expressed as an ordered list of `app.use()` calls. Reading it top to bottom tells you exactly what happens to every request, in order.

```
1.  trust proxy           ← how to interpret X-Forwarded-For
2.  requestId + logger    ← observability FIRST, so even a 429 is traceable
3.  helmet                ← security headers
4.  cors                  ← origin allowlist
5.  compression           ← response gzip
6.  express.json + cookies← now req.body and req.cookies exist
7.  sanitizeMongo         ← strip $ and __proto__ keys
8.  globalLimiter         ← throttle /api
9.  /uploads static       ← with Content-Disposition: attachment
10. /api routes           ← the actual application
11. notFoundHandler       ← 3-arg: converts "no match" into an error
12. errorHandler          ← 4-arg: MUST be last
```

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **CommonJS vs ESM** | A full comparison table. The key insight: ESM's *static* structure is what enables tree-shaking and code splitting; `require()` can take a computed path, so nothing can be proven and nothing dropped. Interop is one-way — ESM can import CJS, not vice versa. |
| **Middleware order** | The ordering principle: identity/observability → security → parsing → throttling → routes → 404 → errors. |
| **`trust proxy`** | Behind a proxy, `req.ip` is the proxy. ⚠️ But `trust proxy: true` lets **any client spoof `X-Forwarded-For`**, bypassing per-IP rate limits and poisoning audit logs. Set a hop count or subnet, never blanket `true`. |
| **helmet** | Know what the headers *do*: CSP (last line against XSS), HSTS (kills SSL-stripping), `nosniff`, `X-Frame-Options` (clickjacking), `Referrer-Policy`. ⚠️ helmet sets response headers — it cannot stop injection, broken access control, or IDOR. |
| **CORS — what it does NOT protect** | ⭐ **CORS is not a server-side security control.** It's browser-enforced; curl ignores it. It protects *your users from other sites*, not your API from attackers. And for "simple" requests the browser **still sends** the request — it only blocks reading the response, which is why CSRF is a separate problem. |
| **compression — when it's a net loss** | Skip below ~1KB, skip already-compressed formats, and skip it entirely if a CDN does it (Node is single-threaded, so that CPU *is* your request capacity). Security angle: **BREACH/CRIME** — don't gzip responses mixing secrets with reflected input. |
| **Body parsing with a size limit** | The 100kb default is a DoS control. `verify` gives raw bytes for webhook signature verification — you must hash exactly what was sent. |
| **cookie-parser** | Without it `req.cookies` doesn't exist. Must be registered before the auth routes that read the refresh cookie. |
| **Static files, and uploads as a special case** | `Content-Disposition: attachment` + `nosniff` because an uploaded `.html` or `.svg` served from your origin can run JS in your origin's context. SVG is the forgotten one — it's XML and can contain `<script>`. |
| **404 then error handler, LAST** | `notFoundHandler` is a *normal* 3-arg middleware that only runs if nothing matched; it converts that into an error for the 4-arg handler. |

## The four classic ordering bugs

| Mistake | Symptom |
|---|---|
| `express.json()` after routes | `req.body` is `undefined` everywhere |
| `helmet()` after routes | No security headers on any API response |
| Error handler before routes | It never fires — errors go to Express's default HTML handler |
| `cors()` after a route | That route's preflight fails while others work |

## Exports

```js
module.exports = app;   // an Express app, not a server
```

That single line is what lets Supertest do `request(app)` with no port binding. See [`server.js`](./server.js.md).

## Interview questions

- **"What breaks if you register `express.json()` after your routes?"** → `req.body` is undefined in every handler. Middleware runs in registration order.
- **"Does CORS protect your API?"** → No. It's enforced by the browser to protect users from *other sites* reading your responses with their credentials. A non-browser client ignores it completely.
- **"Why is `origin: '*'` with `credentials: true` rejected?"** → The CORS spec forbids it — a wildcard plus credentials would let any site make authenticated requests. You must echo a specific origin, which forces an explicit allowlist.
- **"When is gzip a bad idea?"** → Small payloads (overhead exceeds saving), already-compressed formats, and when a CDN already does it. Plus the BREACH attack on responses mixing secrets with attacker-influenced content.
- **"Behind a load balancer all requests appear to come from one IP. Fix it, and what's the risk?"** → `app.set('trust proxy', n)`. The risk of `true` is header spoofing defeating your rate limiter.

## Related

- [`server.js`](./server.js.md) — why this file doesn't listen
- [`middleware/errorHandler.js`](./middleware/errorHandler.js.md) — the 4-arg handler registered last
- [`middleware/requestLogger.js`](./middleware/requestLogger.js.md) — registered first
- [`middleware/rateLimiter.js`](./middleware/rateLimiter.js.md) — and why `trust proxy` matters to it
- [`client/src/main.jsx`](../client/src/main.jsx.md) — the ESM counterpart
