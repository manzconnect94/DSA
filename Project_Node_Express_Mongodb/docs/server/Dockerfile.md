# `server/Dockerfile`

> Multi-stage build: `deps` → `dev` → `runtime`. Produces a ~180MB production image instead of 1.2GB.

**Concept blocks:** 7

## The three stages

```
┌─ deps ──────────┐   npm ci --omit=dev
│  node:20-alpine │   (production dependencies only)
└────────┬────────┘
         │ COPY --from=deps
         ▼
┌─ runtime ───────┐   dumb-init, non-root, healthcheck
│  node:20-alpine │   CMD ["node", "server.js"]        ← production
└─────────────────┘

┌─ dev ───────────┐   npm ci (ALL deps, incl. nodemon + jest)
│  node:20-alpine │   CMD ["npm", "run", "dev"]        ← docker-compose
└─────────────────┘
```

`docker compose` builds `target: dev`; a production build stops at `runtime`.

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **Multi-stage build** | Compile in a fat stage, copy only artifacts into a slim one. Build tools (gcc, python, headers) never reach production. Size matters as deploy speed, registry cost, cold start, and **attack surface** — every package is a potential CVE. |
| **⭐ Layer caching** | The highest-value trick. Copy `package*.json` **before** the source. Otherwise any source change — even a typo fix in a comment — invalidates the copy layer, so `npm ci` re-runs and re-downloads everything. Often the difference between a 2-minute and a 10-second rebuild. |
| **`npm ci` vs `npm install`** | `npm install` may *update* the lockfile to satisfy ranges, so two builds a week apart can install different versions — the opposite of what an image is for. `npm ci` installs exactly the lockfile, errors on mismatch, and is faster. |
| **Build targets** | `--target dev` stops at a named stage, so one Dockerfile produces both images with no duplicated file to drift out of sync. ⚠️ Necessary here because `runtime` installs with `--omit=dev`, so nodemon isn't in it — pointing compose at the production image fails with `nodemon: not found`. |
| **`dumb-init` as PID 1** | ⚠️ A process running as PID 1 doesn't get default signal handlers and must reap zombies. **Symptom: your SIGTERM handler never fires**, so graceful shutdown never happens and Docker waits the full timeout before SIGKILL on every deploy — killing in-flight requests each time. `dumb-init` forwards signals correctly, which is what makes the [draining logic](./middleware/errorHandler.js.md) actually work. |
| **Run as non-root** | Containers run as root by default. RCE in your app then means root *inside* the container — and a container escape means root on the **host**. The `node` image ships a `node` user (uid 1000). Costs nothing; standard audit requirement. |
| **Container HEALTHCHECK** | Distinguishes "the process is running" from "the app works" — a Node process can be alive with a wedged event loop. ⚠️ Point it at **liveness**, not readiness: a healthcheck that pings the database will restart every container during a brief DB blip, turning a hiccup into an outage. |
| **exec vs shell form `CMD`** | Use the JSON array. The shell form wraps the process in `/bin/sh -c`, making the **shell** PID 1 — which doesn't forward SIGTERM to node, breaking graceful shutdown again. |

## Ordering detail

```dockerfile
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
```

The directory is created and chowned **before** dropping privileges — the non-root user can't `mkdir` in a root-owned WORKDIR.

## Interview questions

- **"How do you get a Node image from 1.2GB to under 200MB?"** → Multi-stage build, alpine base, `--omit=dev`, `.dockerignore`. Name them in impact order.
- **"Why copy `package.json` before the source?"** → Layer caching. Dependencies change rarely; source changes constantly.
- **"Your SIGTERM handler never fires in Docker. Why?"** → PID 1 signal semantics, or the shell-form CMD swallowing it. Fix with `dumb-init`/`--init` and the exec form.
- **"Why not run as root in a container?"** → Defence in depth against container escape. Also blocked by most cluster security policies.
- **"What should a container healthcheck check?"** → Liveness only. Never a dependency, or one dependency blip restarts your whole fleet.

## Related

- [`.dockerignore`](./dockerignore.md) — build speed *and* keeping `.env`/`.git` out of the image
- [`docker-compose.yml`](../docker-compose.yml.md) — which targets `dev`
- [`client/Dockerfile`](../client/Dockerfile.md) — why a frontend container is fundamentally different
- [`middleware/errorHandler.js`](./middleware/errorHandler.js.md) — the SIGTERM handling `dumb-init` enables
