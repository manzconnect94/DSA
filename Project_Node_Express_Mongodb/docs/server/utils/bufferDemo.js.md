# `server/utils/bufferDemo.js`

> ▶ **Runnable.** Seven experiments on Node's raw binary type.

**Lines:** 184 · **Concept blocks:** 9

```bash
cd server && npm run demo:buffer
```

## What a Buffer is

JavaScript in the browser historically had no way to hold raw bytes. Node needed one (files, TCP packets, images, crypto), so it added `Buffer` — a fixed-length chunk of memory allocated **outside the V8 heap**.

⭐ **That "outside V8" detail matters:**

| Property | Consequence |
|---|---|
| Not subject to V8's ~1.5GB heap limit | You can allocate more, but you can also get **OOM-killed by the kernel** rather than a clean V8 error |
| Not moved by the garbage collector | Can be handed straight to the OS for I/O with **zero copying** |
| A `Uint8Array` subclass | Every TypedArray method works |

## The seven experiments

### 1. `alloc` vs `allocUnsafe` — a genuine past CVE

`Buffer.allocUnsafe(n)` grabs memory **without zeroing it**, so it may contain whatever was there before — **fragments of other requests, passwords, private keys**. It's faster precisely because it skips the zero-fill.

⚠️ If you `allocUnsafe` and then send the buffer **without fully overwriting it**, you **leak memory contents to the client**. The old `new Buffer(number)` constructor did this **by default**, which caused real CVEs and is why it's deprecated.

**Rule:** use `Buffer.alloc()` unless you're about to overwrite every byte *and* have measured that the zero-fill matters.

### 2. ⭐ `string.length !== Buffer.byteLength`

The bug that bites everyone. A JS string's `.length` counts **UTF-16 code units, not bytes**.

| Value | `.length` | UTF-8 bytes |
|---|---|---|
| `"café"` | 4 | **5** (é takes two) |
| `"🚀"` | **2** (a surrogate pair) | **4** |

⚠️ Size a buffer or enforce a DB column limit using `string.length` and you will **truncate multi-byte characters and produce mojibake (�)**. Always use `Buffer.byteLength()`.

⭐ This is also why **slicing a buffer at an arbitrary offset can split a character in half** — the single most common cause of corrupted output when manually chunking a stream.

### 3. Magic numbers / file signatures

**A security question in disguise.** When a user uploads `invoice.pdf`, the filename and the `Content-Type` header are **both attacker-controlled and mean nothing.**

The only trustworthy check is reading the first few bytes and comparing to the format's signature:

| Format | Magic number |
|---|---|
| PNG | `89 50 4E 47` |
| PDF | `25 50 44 46` (`%PDF`) |
| JPEG | `FF D8 FF` |
| ZIP/docx/xlsx | `50 4B 03 04` |

That requires raw Buffer access — **you cannot do it with strings.** See [`middleware/upload.js`](../middleware/upload.js.md).

### 4. ⚠️ `subarray()` does NOT copy

Unlike `Array.prototype.slice`, a Buffer subarray is a **VIEW over the same underlying memory**. Mutate the view and **the original changes too**.

That's a feature (zero-copy parsing of a network packet) **and a trap** (you hand a "copy" to another module and it corrupts your data). Use `Buffer.from(buf)` or `buf.copy()` for a real copy.

*(`.slice()` on a Buffer is the non-copying one too — deprecated precisely because it misleads people coming from Arrays.)*

### 5. `Buffer.concat` vs accumulating strings

⭐ The canonical **wrong** way to collect a stream:

```js
let data = '';
stream.on('data', c => data += c);   // ❌ two bugs
```

1. The implicit `toString()` on each chunk can **split a multi-byte character across a chunk boundary** and corrupt it
2. Repeated string concat allocates a new string every time

**The correct pattern:** push Buffers into an array and `Buffer.concat` **once** at the end — one allocation, no boundary corruption.

### 6. Endianness

`readUInt32BE` vs `readUInt32LE`. **BE** = big-endian (most significant byte first — the **network standard**); **LE** = little-endian (x86's native order).

⚠️ Reading with the wrong endianness **silently gives you a garbage number, not an error** — which is why it's such a nasty class of bug. The demo prints the same bytes both ways to show it.

Needed for any binary protocol, image header, or database wire format.

### 7. Buffers are off-heap

⭐ **A memory leak involving Buffers will NOT show up in `heapUsed`.** You have to look at **`external`** and `arrayBuffers` in `process.memoryUsage()`, or `rss`.

**Teams have chased phantom leaks for days because their dashboard only graphed heap.** The demo allocates 32MB and prints the deltas — `heapUsed` barely moves, `external` jumps by 32MB.

This is why [`/api/health`](../routes/index.js.md) reports `externalMb` alongside `heapUsedMb`.

## Interview questions

- **"What's a Buffer?"** → Fixed-length raw bytes outside the V8 heap; a `Uint8Array` subclass. Say why off-heap matters.
- **"Why is `allocUnsafe` unsafe?"** → Uninitialised memory can leak other requests' data. Real CVEs.
- **"Why isn't `string.length` the byte length?"** → UTF-16 code units vs UTF-8 bytes. Use `Buffer.byteLength`.
- **"How do you validate an uploaded file's type?"** → Magic numbers, not the MIME header.
- **"What's wrong with `data += chunk` on a stream?"** → Multi-byte corruption at chunk boundaries, plus repeated allocation.
- **"Your RSS grows but heap is flat. Where's the leak?"** → Off-heap: Buffers or native memory. Check `external`.
- **"Does `buf.subarray()` copy?"** → No — it's a view sharing memory.

## Related

- [`middleware/upload.js`](../middleware/upload.js.md) — where magic-number validation belongs
- [`controllers/taskController.js`](../controllers/taskController.js.md) — the streaming CSV export Buffers underpin
- [`routes/index.js`](../routes/index.js.md) — why health reports `external` memory
