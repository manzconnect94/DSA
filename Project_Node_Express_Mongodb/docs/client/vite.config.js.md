# `client/vite.config.js`

> Build config: dev proxy, vendor chunking, and the Vitest setup.

**Lines:** 85 · **Concept blocks:** 3

## ⭐ Vite vs Create React App

The difference is **architectural, not incremental**:

| | CRA / webpack | Vite |
|---|---|---|
| Dev startup | **Bundles your entire app first** — 30–60s on a large codebase | Serves source over **native ESM**; near-instant regardless of size |
| On save | Re-bundles (multi-second wait) | HMR re-processes **only the changed file** |
| Dependencies | Bundled by webpack | Pre-bundled **once** with esbuild (Go, ~100× faster than a JS bundler) |

⚠️ **The nuance worth knowing: Vite is NOT unbundled in production.** It builds with **Rollup**, because shipping thousands of unbundled ES modules over HTTP would mean thousands of round-trips.

⭐ **Dev and prod use different strategies** — which is also why "it works in dev" is not proof the build is fine. Hence `npm run preview` before deploying.

## ⭐ The dev proxy

```js
proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } }
```

The frontend runs on `:5173`, the API on `:5000`. **Different port = different origin**, so every request is cross-origin and subject to CORS. Two ways to handle it:

1. Configure CORS on the server ([done](../server/app.js.md))
2. **Proxy in the dev server** — the browser only ever talks to `:5173`; Vite forwards `/api` to `:5000` **server-side**, and server-to-server requests have **no CORS at all**

⭐ **The proxy also makes dev match production more closely.** In production the frontend and API usually sit behind one domain (nginx routing `/api` to the backend), so there's no cross-origin request there either. **Cookies "just work" in both** — which is the practical win, because `SameSite` behaviour differs across origins and is a very common source of "auth works locally but not deployed".

## ⭐ Vendor chunk splitting

```js
manualChunks: {
  'react-vendor': ['react', 'react-dom', 'react-router-dom'],
  'query-vendor': ['@tanstack/react-query', 'axios'],
}
```

**The problem it solves:** `react` + `react-dom` barely change between your deploys. If they sit in the same chunk as your app code, **every single deploy invalidates that cache** and users re-download ~160KB they already had.

Splitting vendor code into its own hash-named chunk means it **stays cached across releases**, and only your (much smaller) app chunk is re-fetched.

⚠️ **Don't overdo it:** too many small chunks means more HTTP requests and **worse compression ratios** (gzip works better on larger inputs). ⭐ **Split along change frequency, not arbitrarily.**

**Verified output:**

```
react-vendor-DceMbKGn.js   163.83 kB │ gzip: 53.46 kB   ← rarely changes
query-vendor-L5i9bQL3.js    93.35 kB │ gzip: 31.81 kB   ← rarely changes
index-Cg7xnLqb.js           27.10 kB │ gzip:  9.02 kB   ← your code
```

## `sourcemap: true`

Enabled so you can actually inspect what [`React.lazy`](./src/App.jsx.md) produced, and debug production issues with real line numbers.

⚠️ In a real product, consider whether to **serve** them publicly — source maps expose your original source. Common practice: generate them, upload to your error tracker (Sentry), but don't deploy them to the CDN.

## The Vitest block

```js
test: {
  globals: true,
  environment: 'jsdom',        // React needs a DOM; the server tests use 'node'
  setupFiles: './src/test/setup.js',
  css: false,
}
```

⭐ Vitest lives in **the same config file**, so it inherits the JSX transform, aliases and plugins automatically. That's the main practical reason to prefer it over Jest in a Vite project — no duplicated Babel/transform pipeline.

`css: false` skips CSS processing in tests, which is faster and harmless since [RTL queries by role and text](./src/test/setup.js.md), never by class.

## Interview questions

- **"Why is Vite's dev server so much faster than CRA's?"** → Native ESM in dev (no bundling step) plus esbuild dependency pre-bundling. Then the nuance: it *does* bundle with Rollup for production.
- **"How do you avoid CORS in development?"** → A dev proxy, so requests are same-origin from the browser's perspective. Note it also mirrors production topology.
- **"How do you stop every deploy busting your users' cache?"** → Split vendor code into its own hash-named chunk. Split by change frequency.
- **"Why not split every route into its own tiny chunk?"** → More requests, worse compression. Diminishing returns below a few KB.

## Related

- [`src/App.jsx`](./src/App.jsx.md) — `React.lazy`, which produces the per-route chunks
- [`server/app.js`](../server/app.js.md) — the CORS config the proxy sidesteps
- [`Dockerfile`](./Dockerfile.md) — the nginx `/api` proxy, production's equivalent
- [`src/test/setup.js`](./src/test/setup.js.md) — the setup file referenced here
