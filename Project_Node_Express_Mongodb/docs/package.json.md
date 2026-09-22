# `package.json` (root)

> Workspace-level convenience scripts that delegate into `server/` and `client/`.

**Type:** config · **Concept blocks:** 0 (pure plumbing)

## What it does

This is a thin orchestration layer — it has **no dependencies of its own**. Every script forwards to one of the two real packages using npm's `--prefix` flag.

| Script | Runs | Purpose |
|---|---|---|
| `install:all` | install in both packages | One-command onboarding |
| `dev:server` | `npm run dev --prefix server` | nodemon on :5000 |
| `dev:client` | `npm run dev --prefix client` | Vite on :5173 |
| `seed` | `npm run seed --prefix server` | 10k tasks |
| `test` | `npm test --prefix server` | 80 backend tests |
| `test:client` | `npm test --prefix client` | 6 frontend tests |
| `cluster` | `npm run cluster --prefix server` | Multi-core mode |

`"private": true` prevents accidental publication to npm.

## Why not npm workspaces?

A reasonable question, and a deliberate choice. Real workspaces (`"workspaces": ["server", "client"]`) would hoist dependencies into a single root `node_modules`. That is genuinely better for a monorepo with shared code — but for this project it would:

- **Obscure which dependency belongs to which side.** Part of the point here is that the server uses CommonJS and the client uses ESM, with separate dependency sets. Hoisting blurs that.
- **Complicate the Dockerfiles.** Each `Dockerfile` copies only its own `package*.json` to get [layer caching](./server/Dockerfile.md). With hoisting, the build context would need the root lockfile and both manifests.

`--prefix` keeps the two packages genuinely independent at the cost of a slightly larger install.

## `engines`

```json
"engines": { "node": ">=18.0.0" }
```

Node 18 is the floor because the code uses `crypto.randomUUID()`, `os.availableParallelism()` (18.14+, see [`cluster.js`](./server/cluster.js.md)), and native `fetch`. Note this is **advisory by default** — npm only warns unless `engine-strict=true` is set in `.npmrc`.

## Interview questions

- **"How do you structure a monorepo?"** → Workspaces (npm/pnpm/yarn) for shared code and a single lockfile; separate packages when the halves are genuinely independent. Turborepo/Nx once build caching matters.
- **"What's the difference between `dependencies` and `devDependencies`?"** → devDependencies are omitted by `npm ci --omit=dev`, which is exactly what the production [Dockerfile](./server/Dockerfile.md) stage does. Getting this wrong ships jest and nodemon to production.

## Related

- [`server/package.json`](./server/package.json.md) · [`client/package.json`](./client/package.json.md)
- [`docker-compose.yml`](./docker-compose.yml.md) — the alternative entry point that needs no local Node at all
