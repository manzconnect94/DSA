# `client/Dockerfile`

> Three stages: `dev` (Vite server) · `build` (static bundle) · `runtime` (nginx, ~25MB).

**Concept blocks:** 4

## ⭐ A frontend container is fundamentally different

A common interview trap. People containerise a React app the same way they containerise an API — **and it's wrong**.

⭐ **A React SPA compiles to static files.** `vite build` produces HTML, JS and CSS. Those need a **web server**, not a Node runtime. Shipping Node to serve static files means:

| Cost | Detail |
|---|---|
| Size | ~180MB instead of **~25MB** (`nginx:alpine`) |
| Performance | Node's single thread serving bytes instead of nginx's optimised `sendfile` path |
| Security | A much larger attack surface for **zero** benefit |

So: **build with Node (stage 2), serve with nginx (stage 3).** The Node toolchain never reaches the final image.

## ⭐ And the bigger point: usually don't containerise it at all

In most real deployments you upload `dist/` to **S3 + CloudFront**, or Vercel/Netlify/Cloudflare Pages. A CDN serves static assets from an **edge location near the user** — faster and cheaper than any container you can run.

Containerising the frontend makes sense when you need it **colocated with the API behind one ingress**, or in an air-gapped environment.

⭐ **Knowing when NOT to use a container is the better answer.**

## The three stages

| Stage | Base | Purpose |
|---|---|---|
| `dev` | `node:20-alpine` | Vite dev server with HMR — what [docker-compose](../docker-compose.yml.md) targets |
| `build` | `node:20-alpine` | `npm ci` + `npm run build` → `dist/` |
| `runtime` | `nginx:1.27-alpine` | Copies **only** `dist/`. No Node, no npm, no `node_modules`. |

## ⚠️ `--host 0.0.0.0` in the dev stage

```dockerfile
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

**Required in a container.** Vite binds to `localhost` by default, which is only reachable from inside the container's own network namespace — so **the port mapping appears to do nothing.** A very common "why can't I reach my dev server?" moment.

## Build-time env vars

```dockerfile
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build
```

The `ARG` must come **before** the build, because Vite substitutes the value into the bundle at that moment. See [`.env.example`](./env.example.md) for why this means one image per environment.

## ⭐ `try_files` — the SPA routing requirement

**A classic deployment bug that only appears AFTER you deploy.**

React Router handles `/tasks` entirely in the browser, so navigating there **via a link works perfectly**. But if the user **refreshes** on `/tasks`, the browser asks the **server** for `/tasks` — and there is no such file on disk. nginx returns **404**.

**The fix:**

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Serve the real file if it exists, otherwise fall back to `index.html` and let React Router read the URL. **Every SPA needs this rewrite** — in nginx, CloudFront (a custom error response mapping 404 → `/index.html` with a 200), or whatever fronts it.

## ⭐ The caching strategy

Two rules that must go together:

| Path | Header | Why |
|---|---|---|
| `/assets/*` | `expires 1y; Cache-Control: public, immutable` | Filenames are **content-hashed**, so a changed file gets a **new name**. The old name can safely be cached forever. |
| `/index.html` | `Cache-Control: no-cache, no-store, must-revalidate` | ⚠️ **The one unhashed file.** A cached copy references **deleted asset hashes** — so users keep loading an old bundle, or get white-screen 404s on chunks after a deploy. |

⭐ Getting the second one wrong is the cause of "users need to hard-refresh after every deploy". It also breaks [lazy-loaded chunks](./src/App.jsx.md) specifically: a stale `index.html` asks for a chunk hash that no longer exists, the dynamic import rejects, and the app blanks — which is exactly why an [ErrorBoundary wraps Suspense](./src/App.jsx.md).

## The `/api` proxy

```nginx
location /api/ {
  proxy_pass http://api:5000;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

⭐ Keeps the frontend and API on the **same origin** in production — **no CORS and no cross-origin cookie problems.** This mirrors what the [Vite dev proxy](./vite.config.js.md) does locally, so behaviour is consistent in both.

The `X-Forwarded-*` headers are what [`trust proxy`](../server/app.js.md) on the Express side reads to recover the real client IP and protocol.

## Interview questions

- **"How do you containerise a React app?"** → Build with Node, serve with nginx. Then the better answer: often don't — use a CDN.
- **"Navigating to /tasks works but refreshing gives 404."** → Missing SPA fallback. `try_files … /index.html`.
- **"How do you cache a SPA's assets?"** → Hashed assets forever, `index.html` never. Explain what breaks if you get it backwards.
- **"Why is your frontend image 25MB and your backend 180MB?"** → Static files need a web server, not a runtime.
- **"Users have to hard-refresh after every deploy."** → `index.html` is being cached.

## Related

- [`docker-compose.yml`](../docker-compose.yml.md) — targets the `dev` stage
- [`server/Dockerfile`](../server/Dockerfile.md) — multi-stage, layer caching, `dumb-init`
- [`index.html`](./index.html.md) — the file being cached (or not)
- [`src/App.jsx`](./src/App.jsx.md) — the lazy chunks a stale HTML breaks
