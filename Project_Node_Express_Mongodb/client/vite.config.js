// ============================================================
// 🧠 CONCEPT: Vite, and why it replaced Create React App
// WHY IT MATTERS (interview angle): a common "tell me about your tooling"
//   question. The difference is architectural, not incremental:
//   • CRA/webpack BUNDLES your entire app before the dev server can serve
//     anything. On a large codebase that is 30-60 seconds of startup and a
//     multi-second wait on every save.
//   • Vite serves your source over NATIVE ESM. The browser requests
//     modules individually, so dev startup is near-instant regardless of
//     project size, and HMR only re-processes the ONE file you changed.
//     Dependencies are pre-bundled once with esbuild (Go, ~100x faster
//     than a JS bundler).
//   ⚠️ The nuance worth knowing: Vite is NOT unbundled in production. It
//   builds with Rollup, because shipping thousands of unbundled ES modules
//   over HTTP would mean thousands of round-trips. Dev and prod use
//   different strategies — which is also why "it works in dev" is not proof
//   the build is fine.
// ============================================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,

    // ============================================================
    // 🧠 CONCEPT: The dev proxy — sidestepping CORS in development
    // WHY IT MATTERS (interview angle): the frontend runs on :5173 and the
    //   API on :5000. Different PORT = different ORIGIN, so every request
    //   is cross-origin and subject to CORS. Two ways to handle it:
    //   1. Configure CORS on the server (we do — see app.js).
    //   2. PROXY in the dev server, as below. The browser only ever talks
    //      to :5173; Vite forwards /api to :5000 SERVER-SIDE, and
    //      server-to-server requests have no CORS at all.
    //   ⭐ The proxy also makes dev match production more closely: in prod
    //   the frontend and API are usually behind one domain (nginx routing
    //   /api to the backend), so there is no cross-origin request there
    //   either. Cookies "just work" in both, which is the practical win —
    //   SameSite cookie behaviour differs across origins and is a common
    //   source of "auth works locally but not deployed".
    // ============================================================
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // Set to true if the backend ever runs HTTPS with a self-signed cert.
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Emit a manifest and source maps so you can actually inspect what
    // React.lazy produced.
    sourcemap: true,

    rollupOptions: {
      output: {
        // ============================================================
        // 🧠 CONCEPT: Manual chunking / vendor splitting
        // WHY IT MATTERS (interview angle): react + react-dom barely change
        //   between your deploys. If they sit in the same chunk as your app
        //   code, every single deploy invalidates that cache and users
        //   re-download ~140KB they already had. Splitting vendor code into
        //   its own hash-named chunk means it stays cached across releases
        //   and only your (much smaller) app chunk is re-fetched.
        //   ⚠️ Don't overdo it: too many small chunks means more HTTP
        //   requests and worse compression ratios (gzip works better on
        //   larger inputs). Split along CHANGE FREQUENCY, not arbitrarily.
        // ============================================================
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query', 'axios'],
        },
      },
    },
  },

  test: {
    globals: true,
    environment: 'jsdom', // React needs a DOM; the server tests use 'node'
    setupFiles: './src/test/setup.js',
    css: false,
  },
});
