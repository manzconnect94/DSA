// ============================================================
// 🧠 CONCEPT: File uploads with Multer (multipart/form-data)
// WHY IT MATTERS (interview angle): `express.json()` cannot parse a file
//   upload. Browsers send files as `multipart/form-data`, a completely
//   different encoding in which the body is split into parts with boundary
//   markers. Multer is the middleware that parses it and exposes `req.file`
//   / `req.files`, plus the text fields as `req.body`.
//
//   ⚠️ ORDERING GOTCHA: `req.body` is EMPTY until multer has run. If you
//   put a validation middleware that reads req.body BEFORE upload.single(),
//   it sees nothing. Multer must come first in the chain for that route.
//
// HOW IT WORKS HERE: disk storage with a randomised filename, a size cap,
//   and a MIME allowlist — mounted route-level, not app-level.
// ============================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const ApiError = require('../utils/ApiError');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Boot-time sync fs is fine — this runs once, before the server listens.
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ============================================================
// 🧠 CONCEPT: diskStorage vs memoryStorage
// WHY IT MATTERS (interview angle): a real architectural choice.
//   • memoryStorage — the file lands in a Buffer in RAM. Fast, convenient
//     for small files you immediately forward to S3. ⚠️ But it is a trivial
//     DoS: ten concurrent 100MB uploads is 1GB of RAM, and buffers are
//     off-heap so you get OOM-killed rather than a clean V8 error.
//   • diskStorage — streamed to a temp file. Slower but bounded memory.
//   • In production you usually do NEITHER: you issue a PRE-SIGNED S3 URL
//     and have the browser upload DIRECTLY to object storage. Your API never
//     touches the bytes — no bandwidth cost, no memory cost, no disk to fill,
//     and it works with multiple stateless instances. That last point is the
//     one to say out loud: files written to local disk are invisible to your
//     other instances and vanish when the container restarts.
// HOW IT WORKS HERE: diskStorage, because it needs no cloud credentials.
// ============================================================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Note the error-first callback signature — multer predates promises
    // and uses the classic Node convention throughout.
    cb(null, UPLOAD_DIR);
  },

  filename: (_req, file, cb) => {
    // ============================================================
    // 🧠 CONCEPT: NEVER trust the uploaded filename — PATH TRAVERSAL
    // WHY IT MATTERS (interview angle): `file.originalname` is entirely
    //   attacker-controlled. Use it as the destination filename and you have
    //   handed over your filesystem:
    //     • "../../../../etc/cron.d/backdoor" — writes outside the upload
    //       directory (path traversal).
    //     • "index.js" — overwrites your application code.
    //     • "shell.php" / "app.jsp" — if the upload dir is ever served by a
    //       web server that executes those, it is remote code execution.
    //     • A 5000-character name, or one with a NUL byte, to break naive
    //       downstream parsing.
    //   ✅ THE FIX: generate the stored filename yourself from random bytes
    //   and keep the user's original name in the DATABASE only, for display.
    //   Also sanitise the extension against an allowlist rather than
    //   trusting path.extname() on hostile input.
    // ============================================================
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const safeExt = /^\.[a-z0-9]{1,9}$/.test(ext) ? ext : '';
    const random = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${random}${safeExt}`);
  },
});

// ============================================================
// 🧠 CONCEPT: MIME type filtering, and why it is NOT enough
// WHY IT MATTERS (interview angle): `file.mimetype` comes from the
//   Content-Type header the CLIENT sent. It is a claim, not a fact — an
//   attacker sets it to "image/png" while uploading a PHP script, and multer
//   believes them. Checking it blocks honest mistakes, not attacks.
//
//   ✅ REAL DEFENCES, layered:
//   1. Verify the MAGIC NUMBER — read the first bytes and check the actual
//      file signature (PNG = 89 50 4E 47). See utils/bufferDemo.js, which
//      demonstrates exactly this. Libraries: file-type.
//   2. Serve uploads from a SEPARATE DOMAIN or a storage bucket, never from
//      your app's origin — so even a stored HTML/SVG file cannot run
//      JavaScript in your origin's context and steal sessions. (SVG is the
//      forgotten one: it is XML and CAN contain <script>.)
//   3. Set `Content-Disposition: attachment` and a strict
//      `X-Content-Type-Options: nosniff` so browsers download rather than
//      render.
//   4. Never store uploads inside a directory the web server will execute.
//   5. Run an antivirus scan (ClamAV) for user-to-user file sharing.
//   6. RE-ENCODE images (sharp) — this strips EXIF (which leaks GPS
//      location) and destroys any embedded payload.
// ============================================================
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']);

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    // cb(error) rejects the file. cb(null, false) skips it silently —
    // prefer the explicit error so the user knows why nothing uploaded.
    return cb(ApiError.badRequest(`File type "${file.mimetype}" is not allowed`));
  }
  return cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    // ============================================================
    // 🧠 CONCEPT: Limits are a DoS control, not a UX nicety
    // WHY IT MATTERS (interview angle): without `fileSize`, one request can
    //   fill your disk or exhaust RAM. Without `files`, an attacker sends
    //   10,000 parts in a single request. Without `fields`/`parts`, a
    //   multipart body with a million tiny fields burns CPU in the parser
    //   before any of your code runs. Set all of them.
    //   Exceeding a limit throws MulterError('LIMIT_FILE_SIZE'), which
    //   middleware/errorHandler.js translates into a 413.
    // ============================================================
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
    fields: 10,
    parts: 15,
  },
});

module.exports = { upload, UPLOAD_DIR, ALLOWED_MIME_TYPES };
