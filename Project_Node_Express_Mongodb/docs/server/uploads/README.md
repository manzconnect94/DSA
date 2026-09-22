# `server/uploads/`

> Multer's destination directory. Gitignored except for a `.gitkeep` placeholder.

## Contents

| File | Purpose |
|---|---|
| `.gitkeep` | A zero-byte placeholder so the empty directory exists on clone |

## The `.gitkeep` trick

Git tracks **files, not directories**. An empty folder cannot be committed. `.gitkeep` is a conventional zero-byte placeholder — there's nothing special about the name — that makes the directory exist after a clone, so multer has somewhere to write before the app's `mkdirSync` runs.

[`.gitignore`](../../gitignore.md) excludes the contents but re-includes the placeholder:

```
server/uploads/*
!server/uploads/.gitkeep
```

## What lands here

Files uploaded via `POST /api/tasks/:id/attachment`, named by [`middleware/upload.js`](../middleware/upload.js.md) as:

```
<timestamp>-<16 random hex bytes><validated extension>
```

⚠️ **Never the user's filename** — that's [path traversal](../middleware/upload.js.md). The original name is kept in the database for display only.

## How it's served

[`app.js`](../app.js.md) mounts it with deliberate headers:

```js
app.use('/uploads',
  (_req, res, next) => {
    res.setHeader('Content-Disposition', 'attachment');   // download, don't render
    res.setHeader('X-Content-Type-Options', 'nosniff');   // don't guess the type
    next();
  },
  express.static(UPLOAD_DIR, { maxAge: '1d', index: false, dotfiles: 'deny' })
);
```

| Setting | Why |
|---|---|
| `Content-Disposition: attachment` | ⚠️ Forces a download instead of rendering — **critical**, because an uploaded `.html` or `.svg` served from your origin can run JavaScript **in your origin's context** and steal sessions. SVG is the forgotten one: it's XML and can contain `<script>`. |
| `nosniff` | Stops the browser guessing a type and rendering it anyway |
| `index: false` | No directory listing |
| `dotfiles: 'deny'` | No serving `.env`-style files if one ever appeared here |

## ⚠️ Why this directory shouldn't exist in production

Local disk storage breaks on multiple counts:

| Problem | Consequence |
|---|---|
| **Invisible to other instances** | User uploads to pod A, then requests it and gets routed to pod B → 404 |
| **Lost on redeploy** | Container filesystems are ephemeral. Every deploy wipes uploads. |
| **Unbounded disk growth** | Nothing prunes it; eventually the volume fills and *everything* fails |
| **Same origin as the app** | The XSS risk the headers above are working around |

⭐ **The production answer:** a **pre-signed S3/GCS URL** so the browser uploads **directly** to object storage. Your API never touches the bytes — no bandwidth cost, no memory cost, no disk to fill, works with any number of stateless instances, and the files are served from a separate origin (killing the XSS vector) behind a CDN.

This is the [same per-process-state lesson](../cluster.js.md) as the cache, the rate limiter and the event emitter.

## Interview questions

- **"Where do uploaded files go?"** → Object storage, via a pre-signed URL. Local disk only for single-instance or dev.
- **"Why is local disk wrong for uploads?"** → Not shared between instances, lost on redeploy, unbounded growth.
- **"How do you safely serve user-uploaded files?"** → Separate origin or bucket, `Content-Disposition: attachment`, `nosniff`, no execution, and re-encode images.

## Related

- [`middleware/upload.js`](../middleware/upload.js.md) — multer config, path traversal, MIME validation
- [`app.js`](../app.js.md) — the static-serving headers
- [`.gitignore`](../../gitignore.md) — the exclusion rule
