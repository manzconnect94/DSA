# `docker-compose.yml`

> Brings up MongoDB, Redis, the API and the React dev server with one command. The easiest way to run this project.

**Type:** infrastructure · **Lines:** ~155 · **Concept blocks:** 5

## What it does

Four services on a shared Docker network:

```
client (:5173) ──▶ api (:5000) ──┬──▶ mongo (:27017)  [volume: mongo-data]
  Vite dev          Express       └──▶ redis (:6379)   [volume: redis-data]
```

```bash
docker compose up -d
docker compose exec api npm run seed
docker compose logs -f api
docker compose down -v          # -v also drops the data volumes
```

## Concepts in this file

| Concept | Takeaway |
|---|---|
| **docker-compose — "how would you deploy this?"** | Compose solves reproducibility, dependency isolation, dev/prod parity and one-command onboarding. ⚠️ But it is **single-host** — no multi-node scheduling, no rolling updates, no self-healing. "Compose for dev and CI, Kubernetes for prod" is the right answer. |
| **Named volumes = persistence** | Containers are ephemeral; their filesystem dies with them. Without a volume, every `down` wipes the database. This is also exactly why [local-disk uploads](./server/middleware/upload.js.md) are a bad idea. |
| **Healthchecks + `depends_on: service_healthy`** | Plain `depends_on` only waits for the container to *start*, not to be *ready*. Mongo takes seconds to accept connections, so the API would crash-loop. |
| **Service names are DNS hostnames** | `mongo:27017`, **not** `localhost:27017`. Each container has its own network namespace, so `localhost` means the container itself. The most common Docker networking mistake. |
| **Redis `maxmemory` + eviction policy** | `allkeys-lru` is correct for a pure cache. ⚠️ If Redis also holds a job queue or sessions, LRU will **silently delete** them — use `noeviction` and separate instances. |

## Two details worth noting

**`target: dev`** on both build steps. The Dockerfiles are multi-stage; compose deliberately builds the *development* stage, which includes nodemon and dev dependencies. Pointing compose at the production stage and then running `npm run dev` fails with a confusing `nodemon: not found`. See [Dockerfile](./server/Dockerfile.md).

**The anonymous `node_modules` volume:**

```yaml
volumes:
  - ./server:/app          # bind-mount source for live reload
  - /app/node_modules      # ...but keep the container's own modules
```

Without the second line, the host bind-mount **shadows** `/app/node_modules` and the container finds no dependencies. A classic and very confusing Docker + Node problem — made worse because a host `node_modules` built on Windows contains binaries that won't run in Linux.

## Development conveniences that are production mistakes

| Here | In production |
|---|---|
| Mongo port published to the host | Database not reachable from outside the app network at all |
| JWT secrets inline in the compose file | A secrets manager (Vault, AWS SM, K8s Secrets) |
| `target: dev`, source bind-mounted | The slim `runtime` stage, code baked into the image |

## Interview questions

- **"Would you use docker-compose in production?"** → No for anything that needs to scale — it's single-host with no orchestration. Yes for local dev, CI, and arguably a small single-server deployment.
- **"Your API container crash-loops on startup. Why?"** → It's connecting to a database that isn't accepting connections yet. Fix with a healthcheck plus `condition: service_healthy` — but the app should *also* tolerate a temporarily unreachable DB, because orchestration narrows the window, it doesn't close it.
- **"Why can't my container reach the database on localhost?"** → Separate network namespaces. Use the compose service name, which Docker's embedded DNS resolves.

## Related

- [`server/Dockerfile`](./server/Dockerfile.md) — multi-stage, layer caching, non-root, `dumb-init`
- [`client/Dockerfile`](./client/Dockerfile.md) — why a frontend container is fundamentally different
- [`config/db.js`](./server/config/db.js.md) · [`config/redis.js`](./server/config/redis.js.md)
- [`routes/index.js`](./server/routes/index.js.md) — the health endpoints the healthchecks call
