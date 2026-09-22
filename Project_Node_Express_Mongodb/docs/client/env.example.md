# `client/.env.example`

> ⚠️ The template for frontend environment variables — **where nothing is secret.**

**Concept blocks:** 1

## ⚠️ Two differences from the backend that matter a lot

### 1. NOTHING HERE IS SECRET

Vite **inlines every `VITE_*` variable into the JavaScript bundle at build time**, and every visitor downloads that bundle. Putting an API key, a database URL, or a private token here **publishes it**.

⭐ **This has leaked a lot of credentials in real projects** — "but it's an environment variable" is not a defence when the value is compiled into a file served to the public.

**If a value must stay secret, it belongs on the SERVER**, with the frontend calling an endpoint that uses it. That's not a workaround; it's the only correct architecture. A third-party API key used from the browser means *anyone* can use your quota.

### 2. Values are BAKED IN AT BUILD TIME

| | Backend | Frontend |
|---|---|---|
| Read | `process.env` **at runtime** | Substituted **at build time** |
| One artifact, many environments? | ✅ Yes | ❌ **No** |

⭐ So the same built artifact **cannot** serve staging and production with different API URLs. You either **build once per environment**, or **load config at runtime** from something like a `/config.json` the container serves. The second keeps one artifact and is what mature setups do.

See the [`Dockerfile`](./Dockerfile.md), where this is an `ARG`.

## The `VITE_` prefix

Only variables prefixed with `VITE_` are exposed to client code. ⭐ That prefix requirement is a **deliberate guard** — so a stray `AWS_SECRET_ACCESS_KEY` in your shell environment is **not** accidentally bundled. (CRA used `REACT_APP_`; same idea.)

It's a safety net, not a security boundary: it stops accidents, not decisions.

## Variables

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `/api` | **Not needed for local development** — [`vite.config.js`](./vite.config.js.md) proxies `/api` to `:5000`, which also avoids CORS entirely. Set this only if pointing at a deployed API on a different origin. |

One variable, because the dev proxy and the production nginx `/api` route both make the API **same-origin**. ⭐ That's the design worth noting: keeping the API same-origin means there's no URL to configure, no CORS to negotiate, and no cross-origin cookie problems.

## Accessing them

```js
import.meta.env.VITE_API_URL      // ✅ ESM — Vite's way
process.env.VITE_API_URL          // ❌ doesn't exist in the browser
```

`import.meta.env` also provides `MODE`, `DEV`, `PROD` and `BASE_URL`. Note `import.meta` is **ESM-only syntax** — another consequence of the [module-system split](../server/app.js.md) in this repo.

## Interview questions

- **"Can you store an API key in a frontend env var?"** → No. It's compiled into the bundle and served to everyone. Proxy through your backend.
- **"Why can't one frontend build serve staging and prod?"** → Env vars are substituted at build time, not read at runtime. Build per environment, or fetch config at runtime.
- **"What's the `VITE_`/`REACT_APP_` prefix for?"** → An allowlist so unrelated shell variables aren't bundled. It prevents accidents, not deliberate leaks.
- **"How do you configure a deployed SPA without rebuilding?"** → Serve a `config.json` the app fetches on boot, or inject values into `index.html` at container start.

## Related

- [`Dockerfile`](./Dockerfile.md) — the build-time `ARG`
- [`vite.config.js`](./vite.config.js.md) — the dev proxy that makes this mostly unnecessary
- [`server/.env.example`](../server/env.example.md) — ⚠️ where things **are** secret
