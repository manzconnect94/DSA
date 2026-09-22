# `client/.dockerignore`

> Excludes files from the Docker build context. The same three concerns as the server's, plus `dist`.

## What's excluded

| Pattern | Reason |
|---|---|
| `node_modules` | Reinstalled inside the image for the right platform; also hundreds of MB across the daemon boundary |
| **`dist`** | ⭐ Frontend-specific — see below |
| `.env`, `.env.*` (but `!.env.example`) | Even though [nothing here is secret](./env.example.md), the habit matters |
| `.git`, `.gitignore` | History = any secret ever committed; also large |
| `coverage` | Not needed at runtime |
| `Dockerfile`, `.dockerignore` | Not needed inside |

## ⭐ Why excluding `dist` matters specifically

This one is unique to a frontend build, and it's a genuine correctness issue rather than just speed.

The [`Dockerfile`](./Dockerfile.md) runs `npm run build` **inside** the image. If your **host** `dist/` were copied in, you'd have a stale directory sitting there during the build. Consequences:

- ⚠️ **Confusing, unreproducible builds** — was the image built from your source, or from whatever `dist/` you happened to have locally?
- Wasted context transfer on every build
- Worse: if a build step ever skipped or partially failed, nginx could end up serving your **stale local build** with old asset hashes — and you'd be debugging a deployment that doesn't match the code.

⭐ **The principle: the build context should contain only inputs, never outputs.** Anything generated must be generated inside the image, so the image is a pure function of your source plus the lockfile.

## The three reasons, restated

| # | Concern | Detail |
|---|---|---|
| 1 | **Build speed** | Everything in the context is uploaded to the Docker daemon *before* the build starts |
| 2 | ⚠️ **Security** | Without it, `COPY . .` bakes `.env` and **all of `.git`** into a distributable artifact |
| 3 | **Correctness** | Host `node_modules` contains platform-specific native binaries; host `dist` is a stale output |

## Interview questions

- **"Why exclude `dist` when you're building it anyway?"** → Precisely because you're building it. Outputs in the context make builds unreproducible and can mask a failed build step.
- **"What ends up in your image without a `.dockerignore`?"** → `.env` and the full git history.
- **"Your deployed app doesn't match your code. Where do you look?"** → Stale build artifacts in the context is one candidate — along with a cached `index.html`.

## Related

- [`Dockerfile`](./Dockerfile.md) — the `COPY . .` this protects
- [`server/.dockerignore`](../server/dockerignore.md) — the backend equivalent
- [`.gitignore`](../gitignore.md) — the same concern for git
