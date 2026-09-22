# `server/.dockerignore`

> Excludes files from the Docker build context. A performance optimisation **and** a security control.

**Concept blocks:** 1

## Concept

| Concept | Takeaway |
|---|---|
| **`.dockerignore` — not just a tidiness file** | Three distinct problems it solves, in increasing severity. |

### 1. Build speed

Everything in the build context is uploaded to the Docker daemon *before the build starts*. Leave `node_modules` in and you ship hundreds of megabytes across that boundary on every build — making even a fully-cached build slow.

### 2. ⚠️ Security

Without it, `COPY . .` copies into the image:

- **`.env`** — your real secrets, now readable by anyone who can pull the image
- **`.git`** — the *entire history*, including any secret ever committed and later "removed"

This is a real and frequent leak. An image is a distributable artifact; treat it like a public one.

### 3. Correctness

A host `node_modules` built on Windows or macOS contains platform-specific native binaries that **will not run** in a Linux container. Even if you wanted to copy it, you shouldn't.

## What's excluded

| Pattern | Reason |
|---|---|
| `node_modules` | Reinstalled inside the image, for the right platform |
| `.env`, `.env.*` (but `!.env.example`) | Secrets |
| `.git`, `.gitignore` | History = secrets; also large |
| `coverage`, `tests`, `*.test.js` | Not needed at runtime; smaller image, smaller attack surface |
| `uploads/*` (but `!uploads/.gitkeep`) | User data isn't part of the image |
| `Dockerfile`, `.dockerignore`, `README.md` | Not needed inside |

## Interview questions

- **"What ends up in your image without a `.dockerignore`?"** → `.env` and all of `.git`. Both are credential leaks in a distributable artifact.
- **"Why exclude tests from a production image?"** → Size and attack surface. Tests may also contain fixtures with credential-shaped data.
- **"Why not just copy `node_modules` to skip `npm ci`?"** → Native modules are compiled per-platform, so a host build won't run in the container. And it defeats layer caching.

## Related

- [`Dockerfile`](./Dockerfile.md) — the `COPY . .` this protects
- [`.gitignore`](../gitignore.md) — the same concern for git
- [`client/.dockerignore`](../client/dockerignore.md) — additionally excludes `dist`
