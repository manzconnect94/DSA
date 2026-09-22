// ============================================================
// 🧠 CONCEPT: Buffers — Node's raw binary data type
// WHY IT MATTERS (interview angle): JavaScript in the browser historically
//   had no way to hold raw bytes. Node needed one (files, TCP packets,
//   images, crypto), so it added Buffer — a fixed-length chunk of memory
//   allocated OUTSIDE the V8 heap. That "outside V8" detail matters:
//   • Buffers are not subject to V8's ~1.5GB default heap limit.
//   • They are not moved by the garbage collector, so they can be handed
//     straight to the OS for I/O with zero copying.
//   • A Buffer IS a Uint8Array subclass, so every TypedArray method works.
//   Run this file:  node utils/bufferDemo.js
// HOW IT WORKS HERE: seven small, printed experiments.
// ============================================================

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(64));
console.log('BUFFER DEMO — node utils/bufferDemo.js');
console.log('='.repeat(64));

// ------------------------------------------------------------------
// 1. Creating buffers — and why Buffer.allocUnsafe is named that way
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: alloc vs allocUnsafe (a genuine past CVE)
// WHY IT MATTERS (interview angle): `Buffer.allocUnsafe(n)` grabs memory
//   WITHOUT zeroing it, so it may contain whatever was there before —
//   fragments of other requests, passwords, private keys. It is faster
//   precisely because it skips the zero-fill. If you allocUnsafe and then
//   send the buffer without fully overwriting it, you LEAK MEMORY CONTENTS
//   to the client. The old `new Buffer(number)` constructor did this by
//   default, which caused real CVEs and is why it is deprecated.
//   Rule: use Buffer.alloc() unless you are about to overwrite every byte
//   and have measured that the zero-fill matters.
// ============================================================
const zeroed = Buffer.alloc(8); // zero-filled, SAFE
const fast = Buffer.allocUnsafe(8); // NOT zero-filled, may contain old memory
const fromStr = Buffer.from('Hello Node', 'utf8');

console.log('\n1. Creating buffers');
console.log('   Buffer.alloc(8)       ->', zeroed, '(guaranteed zeros)');
console.log('   Buffer.allocUnsafe(8) ->', fast, '(⚠️ uninitialised memory)');
console.log('   Buffer.from("Hello Node") ->', fromStr);
console.log('   length in BYTES:', fromStr.length);

// ------------------------------------------------------------------
// 2. Encodings — the bug that bites everyone
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: string.length !== Buffer.byteLength
// WHY IT MATTERS (interview angle): a JS string's .length counts UTF-16 code
//   units, not bytes. "café" is 4 characters but 5 BYTES in UTF-8 (é takes
//   two). An emoji is 1 visible character, 2 JS "characters" (a surrogate
//   pair), and 4 UTF-8 bytes. If you size a buffer or enforce a DB column
//   limit using string.length, you will truncate multi-byte characters and
//   produce mojibake (�). Always use Buffer.byteLength() for byte counts.
//   This is also why slicing a buffer at an arbitrary offset can split a
//   character in half — the single most common cause of corrupted output
//   when manually chunking a stream.
// ============================================================
const unicode = 'café 🚀';
console.log('\n2. Encodings and byte length');
console.log(`   string "${unicode}"`);
console.log('   .length (UTF-16 units):', unicode.length);
console.log('   Buffer.byteLength (UTF-8 bytes):', Buffer.byteLength(unicode, 'utf8'));
console.log('   as hex   :', Buffer.from(unicode).toString('hex'));
console.log('   as base64:', Buffer.from(unicode).toString('base64'));

// ============================================================
// 🧠 CONCEPT: base64 is encoding, not encryption (again)
// WHY IT MATTERS (interview angle): ties straight back to JWTs. base64 is a
//   reversible transform with no key. Anyone can decode it. Also note the
//   ~33% size increase — base64ing an image into a JSON response makes it a
//   third larger on the wire.
// ============================================================
const secretish = Buffer.from('not-actually-secret').toString('base64');
console.log('   base64 round-trip:', secretish, '->', Buffer.from(secretish, 'base64').toString('utf8'));

// ------------------------------------------------------------------
// 3. Reading a real file as a raw buffer, and sniffing its type
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Magic numbers / file signatures
// WHY IT MATTERS (interview angle): a security question in disguise. When a
//   user uploads "invoice.pdf", the filename and the Content-Type header are
//   BOTH attacker-controlled and mean nothing. The only trustworthy check is
//   reading the first few bytes and comparing them to the format's magic
//   number (PNG = 89 50 4E 47, PDF = 25 50 44 46 "%PDF", JPEG = FF D8 FF).
//   That requires raw Buffer access — you cannot do it with strings.
// HOW IT WORKS HERE: we read this source file and inspect its leading bytes.
// ============================================================
console.log('\n3. Reading a file as a Buffer');
const selfBuf = fs.readFileSync(__filename);
console.log('   file:', path.basename(__filename));
console.log('   total bytes:', selfBuf.length);
console.log('   first 16 bytes (hex) :', selfBuf.subarray(0, 16).toString('hex'));
console.log('   first 16 bytes (utf8):', JSON.stringify(selfBuf.subarray(0, 16).toString('utf8')));

const SIGNATURES = {
  '89504e47': 'PNG',
  '25504446': 'PDF',
  ffd8ffe0: 'JPEG',
  '504b0304': 'ZIP / docx / xlsx',
};
const magic = selfBuf.subarray(0, 4).toString('hex');
console.log(`   magic number ${magic} ->`, SIGNATURES[magic] || 'not a known binary format (this is plain text)');

// ------------------------------------------------------------------
// 4. slice/subarray share memory — a real source of bugs
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Buffer.subarray() does NOT copy
// WHY IT MATTERS (interview angle): unlike Array.prototype.slice, a Buffer
//   subarray is a VIEW over the same underlying memory. Mutate the view and
//   the original changes too. That is a feature (zero-copy parsing of a
//   network packet) and a trap (you hand a "copy" to another module and it
//   corrupts your data). Use Buffer.from(buf) or buf.copy() for a real copy.
//   Note: `.slice()` on a Buffer is the non-copying one too — it is
//   deprecated precisely because it misleads people coming from Arrays.
// ============================================================
console.log('\n4. subarray shares memory');
const original = Buffer.from('ABCDEF');
const view = original.subarray(0, 3);
view[0] = 0x5a; // 'Z'
console.log('   after mutating the view, ORIGINAL is:', original.toString(), '(A became Z!)');

const realCopy = Buffer.from(original);
realCopy[1] = 0x59;
console.log('   after mutating a real copy, original is still:', original.toString());

// ------------------------------------------------------------------
// 5. Concatenation and the naive-string-building trap
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Buffer.concat vs accumulating strings
// WHY IT MATTERS (interview angle): the canonical wrong way to collect a
//   stream is `let data = ''; stream.on('data', c => data += c)`. Two bugs:
//   (1) the implicit toString() on each chunk can SPLIT A MULTI-BYTE
//       CHARACTER across a chunk boundary and corrupt it;
//   (2) repeated string concat allocates a new string every time.
//   The correct pattern is to push Buffers into an array and Buffer.concat
//   once at the end — one allocation, no boundary corruption.
// ============================================================
console.log('\n5. Buffer.concat');
const chunks = [Buffer.from('Streaming '), Buffer.from('data '), Buffer.from('in chunks')];
console.log('   concat ->', Buffer.concat(chunks).toString());
console.log('   (collect chunks in an array, concat ONCE — never `str += chunk`)');

// ------------------------------------------------------------------
// 6. Reading structured binary — a tiny binary protocol parser
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Fixed-width binary reads and endianness
// WHY IT MATTERS (interview angle): if you ever touch a binary protocol,
//   an image header, or a database wire format, you need readUInt32BE /
//   readInt16LE etc. BE = big-endian (most significant byte first — the
//   network standard); LE = little-endian (x86's native order). Reading
//   with the wrong endianness silently gives you a garbage number, not an
//   error — which is why it is such a nasty class of bug.
// ============================================================
console.log('\n6. Structured binary reads');
const packet = Buffer.alloc(8);
packet.writeUInt32BE(42, 0); // bytes 0-3: a message id
packet.writeUInt16BE(7, 4); // bytes 4-5: a payload length
packet.writeUInt8(1, 6); // byte 6: a version flag
console.log('   packet hex:', packet.toString('hex'));
console.log('   id (UInt32BE @0):', packet.readUInt32BE(0));
console.log('   len (UInt16BE @4):', packet.readUInt16BE(4));
console.log('   ver (UInt8 @6)   :', packet.readUInt8(6));
console.log('   same bytes read as LE (WRONG endianness):', packet.readUInt32LE(0), '<- garbage, no error thrown');

// ------------------------------------------------------------------
// 7. Buffers live outside the V8 heap
// ------------------------------------------------------------------
// ============================================================
// 🧠 CONCEPT: Buffer memory is off-heap (external memory)
// WHY IT MATTERS (interview angle): a memory leak involving Buffers will NOT
//   show up in heapUsed. You have to look at `external` and `arrayBuffers`
//   in process.memoryUsage(), or rss. Teams have chased phantom leaks for
//   days because their dashboard only graphed heap. Also: since buffers
//   bypass the V8 heap limit, a runaway buffer allocation gets you OOM-killed
//   by the kernel rather than a clean "JavaScript heap out of memory".
// ============================================================
console.log('\n7. Buffers are off-heap');
const before = process.memoryUsage();
const big = Buffer.alloc(32 * 1024 * 1024); // 32MB
const after = process.memoryUsage();
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
console.log(`   heapUsed delta: ${mb(after.heapUsed - before.heapUsed)}  <- barely moved`);
console.log(`   external delta: ${mb(after.external - before.external)}  <- the 32MB lives here`);
console.log(`   rss total     : ${mb(after.rss)}`);
big.fill(0); // keep a reference so GC doesn't collect it before we print

console.log('\n' + '='.repeat(64));
console.log('Done. Buffers underpin the streaming CSV export — see controllers/taskController.js');
console.log('='.repeat(64));
