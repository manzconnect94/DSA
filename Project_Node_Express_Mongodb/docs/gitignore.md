# `.gitignore`

> Keeps secrets, dependencies, build output and user uploads out of version control.

**Type:** config · **Lines:** ~25 · **Concept blocks:** 1

## What it does

Four categories of exclusion:

| Pattern | Why |
|---|---|
| `.env`, `.env.local`, `.env.*.local` | Real secrets. Never committed. |
| `!.env.example` | The negation *re-includes* the template, so a new developer knows which variables exist without ever seeing values. |
| `node_modules/` | Reproducible from the lockfile; also platform-specific native binaries. |
| `dist/`, `build/`, `coverage/` | Generated artifacts. |
| `server/uploads/*` + `!server/uploads/.gitkeep` | User files aren't source, but the empty directory must exist. |

## Concepts in this file

| Concept | Takeaway |
|---|---|
| Keeping secrets out of version control | **Anything in git history is effectively public forever** — even after a later delete commit. `git rm` does not remove it from history; you need `filter-repo` or BFG, plus rotating the leaked credential. |

## The `.gitkeep` trick

Git tracks *files*, not directories. An empty folder cannot be committed. `.gitkeep` is a conventional zero-byte placeholder (there's nothing special about the name — `.gitignore` inside the folder would work too) that makes the directory exist on clone, so `multer` has somewhere to write before the app creates it.

## Interview questions

- **"How do you manage secrets?"** → Environment variables, never committed. Only a `.env.example` template lives in git. In production, config comes from the platform (Kubernetes Secrets, AWS Secrets Manager, Vault), not a file.
- **"You accidentally committed an API key. What now?"** → Rotate the key *first* — assume it's compromised. Then purge history. Removing it in a new commit is not enough; it's still in the object store and in every clone.
- **"Why not commit `node_modules` for reproducibility?"** → The lockfile already guarantees that, and native modules are compiled per-platform, so a macOS `node_modules` won't run in a Linux container.

## Related

- [`server/.env.example`](./server/env.example.md) — the committed template
- [`server/.dockerignore`](./server/dockerignore.md) — the *same* concern for Docker images, where the failure is worse (`.env` and all of `.git` get baked into a distributable artifact)
- [`config/env.js`](./server/config/env.js.md) — the only place `process.env` is read
