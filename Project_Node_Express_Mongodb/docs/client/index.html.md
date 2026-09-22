# `client/index.html`

> The SPA shell. Almost empty — React builds everything else.

**Lines:** 36 · **Concept blocks:** 1

## ⭐ What an SPA actually is

The server sends this **almost-empty** HTML file. React then builds the **entire page in JavaScript** and injects it into `<div id="root">`.

| | |
|---|---|
| ✅ | Navigation **after** the first load is instant — no full page fetch |
| ❌ | **First** load is slow-ish: a blank page until the JS downloads, parses and executes |
| ❌ | **SEO** — a crawler that doesn't execute JS sees an empty div. Googlebot renders JS now, but **many crawlers and social-media link previewers do not**, so your Slack/Twitter link previews are blank |

## The fixes, and when

| Approach | Gives you | Cost |
|---|---|---|
| **SSR** (Next.js, Remix) | HTML rendered on the server → fast first paint + SEO | Server cost and complexity; you now need a Node runtime in production, not a CDN |
| **SSG** | Pre-rendered at build time | Only works for content that rarely changes |
| **Plain SPA** *(this project)* | Simplest; deployable as static files to any CDN | The two ❌ rows above |

⭐ **Why a plain SPA is right here:** it's an **authenticated internal dashboard**. SEO is irrelevant — Google can't log in — and every user pays the JS cost exactly once, then gets instant navigation. **Choosing SSR for an app behind a login is complexity with no payoff**, and saying that is a better answer than "Next.js is better".

## `<script type="module">`

```html
<script type="module" src="/src/main.jsx"></script>
```

`type="module"` is what makes **native ESM** work in the browser, and it's the foundation [Vite's dev server](./vite.config.js.md) is built on — the browser requests modules individually instead of waiting for a bundle.

Note it also implies `defer`, so the script runs after the document is parsed. That's why `document.getElementById('root')` in [`main.jsx`](./src/main.jsx.md) always finds the element without a `DOMContentLoaded` listener.

## What `vite build` does to this file

It becomes the production entry point with hashed asset references injected:

```html
<script type="module" crossorigin src="/assets/index-Cg7xnLqb.js"></script>
<link rel="modulepreload" crossorigin href="/assets/react-vendor-DceMbKGn.js">
<link rel="stylesheet" crossorigin href="/assets/index-DLfxK4hO.css">
```

Two things worth noticing:

- **Hashed filenames** are what make [aggressive asset caching](./Dockerfile.md) safe — the name changes when the content does.
- **`modulepreload`** tells the browser to start fetching the vendor chunk immediately rather than discovering it after parsing the entry module. A free waterfall improvement.

⚠️ **Which is also why `index.html` itself must never be cached** — it's the only file whose name doesn't change, and a stale copy references deleted asset hashes. See the [nginx config](./Dockerfile.md).

## Interview questions

- **"Why is my React site bad for SEO?"** → The served HTML is empty; content requires JS execution. Then give the SSR/SSG options *and* when they're unnecessary.
- **"SSR or SPA?"** → Depends on whether unauthenticated crawlers and first-paint speed matter. Behind a login, usually not.
- **"What does `type="module"` do?"** → Enables native ESM and implies `defer`.
- **"Why hash asset filenames?"** → Content-addressed names let you cache them forever and invalidate by changing the name.
- **"Why must `index.html` not be cached?"** → It's the one unhashed file; a stale copy points at assets that no longer exist.

## Related

- [`src/main.jsx`](./src/main.jsx.md) — what mounts into `#root`
- [`vite.config.js`](./vite.config.js.md) — dev server and build
- [`Dockerfile`](./Dockerfile.md) — the caching strategy and the SPA fallback
