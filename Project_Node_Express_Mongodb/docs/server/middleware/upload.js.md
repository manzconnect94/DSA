# `server/middleware/upload.js`

> Multer configuration for file uploads. Mounted **route-level**, on exactly one route.

**Lines:** 124 · **Concept blocks:** 5

## Why multer at all

`express.json()` **cannot parse a file upload**. Browsers send files as `multipart/form-data`, a completely different encoding where the body is split into parts with boundary markers. Multer parses it and exposes `req.file` / `req.files`, plus text fields as `req.body`.

⚠️ **Ordering gotcha:** `req.body` is **empty** until multer has run. Put a validation middleware that reads `req.body` *before* `upload.single()` and it sees nothing. Multer must come first — see [`taskRoutes.js`](../routes/taskRoutes.js.md).

## Exports

| Export | Purpose |
|---|---|
| `upload` | The configured multer instance (`upload.single('file')`) |
| `UPLOAD_DIR` | Absolute path, created at boot |
| `ALLOWED_MIME_TYPES` | The allowlist Set |

## diskStorage vs memoryStorage vs neither

| | Behaviour | Trade-off |
|---|---|---|
| **memoryStorage** | File lands in a Buffer in RAM | Fast and convenient for small files you forward straight to S3. ⚠️ **A trivial DoS**: ten concurrent 100MB uploads is 1GB of RAM, and [Buffers are off-heap](../utils/bufferDemo.js.md) so you get **OOM-killed** rather than a clean V8 error. |
| **diskStorage** *(used here)* | Streamed to a temp file | Slower but bounded memory. Needs no cloud credentials, which is why it's here. |
| ⭐ **Neither** | Issue a **pre-signed S3 URL** and have the browser upload **directly** to object storage | **What production actually does.** Your API never touches the bytes — no bandwidth, no memory, no disk to fill, and it works with multiple stateless instances. |

⭐ **That last point is the one to say out loud:** files written to local disk are **invisible to your other instances and vanish when the container restarts.** Same lesson as the [cache](../config/redis.js.md) and the [rate limiter](./rateLimiter.js.md) — see [`cluster.js`](../cluster.js.md).

## ⭐ Path traversal — never trust the filename

`file.originalname` is **entirely attacker-controlled**. Use it as the destination filename and you've handed over your filesystem:

| Payload | Effect |
|---|---|
| `../../../../etc/cron.d/backdoor` | Writes **outside** the upload directory |
| `index.js` | **Overwrites your application code** |
| `shell.php`, `app.jsp` | If the upload dir is ever served by a web server that executes those → **remote code execution** |
| A 5,000-character name, or one with a NUL byte | Breaks naive downstream parsing |

### ✅ The fix

**Generate the stored filename yourself** from random bytes (`Date.now()-<16 random hex>`), and keep the user's original name **in the database only**, for display. Also sanitise the extension against a pattern rather than trusting `path.extname()` on hostile input — done here with `/^\.[a-z0-9]{1,9}$/`.

## ⭐ MIME filtering, and why it is NOT enough

`file.mimetype` comes from the `Content-Type` header **the client sent**. It is a **claim, not a fact** — an attacker sets it to `image/png` while uploading a PHP script, and multer believes them.

**Checking it blocks honest mistakes, not attacks.** Real defences, layered:

| # | Defence |
|---|---|
| 1 | **Verify the magic number** — read the first bytes and check the actual file signature (PNG = `89 50 4E 47`). [Demonstrated in `bufferDemo.js`](../utils/bufferDemo.js.md). Library: `file-type`. |
| 2 | **Serve from a separate domain or bucket**, never your app's origin — so a stored HTML/SVG file can't run JavaScript in your origin's context and steal sessions. ⚠️ **SVG is the forgotten one:** it's XML and **can contain `<script>`**. |
| 3 | `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` so browsers download rather than render. Set in [`app.js`](../app.js.md). |
| 4 | Never store uploads in a directory the web server will execute. |
| 5 | Antivirus scan (ClamAV) for user-to-user sharing. |
| 6 | **Re-encode images** (sharp) — strips EXIF (which leaks **GPS location**) and destroys any embedded payload. |

## Limits are a DoS control

| Limit | Value | Without it |
|---|---|---|
| `fileSize` | 5MB | One request can fill your disk or exhaust RAM |
| `files` | 1 | An attacker sends 10,000 parts in a single request |
| `fields` / `parts` | 10 / 15 | A multipart body with a million tiny fields **burns CPU in the parser before any of your code runs** |

Exceeding a limit throws `MulterError('LIMIT_FILE_SIZE')`, which [`errorHandler`](./errorHandler.js.md) translates to a **413**.

## Note on the error-first callbacks

```js
destination: (_req, _file, cb) => cb(null, UPLOAD_DIR)
```

Multer predates promises and uses the classic Node convention throughout — a live example of the [error-first pattern](../utils/callbackDemo.js.md) in a modern dependency.

## Interview questions

- **"What's wrong with using `file.originalname` as the filename?"** → Path traversal, overwriting code, potential RCE. Generate the name; store theirs for display only.
- **"How do you validate an uploaded file's type?"** → Magic numbers, not the MIME header. Then name the layered defences, especially serving from a separate origin.
- **"diskStorage or memoryStorage?"** → Usually neither — pre-signed URLs direct to object storage. Explain why local disk breaks multi-instance deployments.
- **"Why is SVG dangerous?"** → It's XML and can contain `<script>`, so serving it from your origin is stored XSS.
- **"Why limit `fields` and `parts`, not just `fileSize`?"** → A million tiny fields burns parser CPU before your handler runs.

## Related

- [`routes/taskRoutes.js`](../routes/taskRoutes.js.md) — the ordering requirement
- [`controllers/taskController.js`](../controllers/taskController.js.md) — `uploadAttachment`
- [`utils/bufferDemo.js`](../utils/bufferDemo.js.md) — magic-number checking, runnable
- [`middleware/errorHandler.js`](./errorHandler.js.md) — MulterError → 413
- [`app.js`](../app.js.md) — the `Content-Disposition` headers on `/uploads`
