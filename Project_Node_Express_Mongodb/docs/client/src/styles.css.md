# `client/src/styles.css`

> A minimal dark theme. Deliberately the least interesting file in the project.

**Lines:** 400 · **Concept blocks:** 0

## Why there are no concept blocks here

The project's stated design principle is that **the code exists to demonstrate concepts**. CSS architecture is a real topic, but it isn't a *Node/React interview* topic — so this file is plain, hand-written CSS with no framework, no preprocessor and no CSS-in-JS.

That's a deliberate choice with a cost: the styling is basic. In exchange, there's no build-tooling complexity, no extra dependency, and nothing competing for attention with the files that matter.

## Structure

| Section | Contents |
|---|---|
| `:root` custom properties | Colour palette, radius |
| Base | `body`, `code`, `pre`, `a` |
| Navbar | Layout, active-link styling |
| Layout | `main`, `.page`, `.subtitle`, `.muted` |
| Forms | Inputs, buttons, `.form-error`, `.form-meta` |
| Badges & pills | `.badge.controlled` / `.uncontrolled`, `.pill.cached`, `.render-badge` |
| Task list | `.task-row`, status variants, `.list-controls` |
| Perf & stats | `.perf-bar`, `.stat-card`, `.stat-row` |
| Callouts & tables | `.callout`, `.concept-note`, `.data-table` |
| States | `.route-loading`, `.forbidden`, `.error-boundary` |

## Classes that carry meaning

A few exist specifically to make concepts **visible in the UI** rather than just readable in comments:

| Class | Purpose |
|---|---|
| `.badge.controlled` / `.badge.uncontrolled` | Labels the two input styles in [`TaskForm`](./components/TaskForm.jsx.md) — blue vs amber, side by side |
| `.render-badge` | The live render counters in [`ZustandPage`](./pages/ZustandPage.jsx.md) that demonstrate selector subscriptions |
| `.pill.cached` / `.pill.uncached` | Green vs amber cache status in [`TasksPage`](./pages/TasksPage.jsx.md) — you can *see* cache-aside working |
| `.perf-bar.good` / `.bad` | Colours the [blocked-event-loop](./pages/AdminPage.jsx.md) result by how bad it is |
| `.stat-card.warn` | Flags the "no selector" anti-pattern component |

## CSS custom properties

```css
:root {
  --bg: #0f1117;  --panel: #171a23;  --border: #272b38;
  --text: #e6e8ee; --muted: #8b90a0;
  --accent: #6aa3ff; --good: #3fb950; --warn: #d29922; --bad: #f85149;
}
```

Semantic names (`--good`, `--warn`, `--bad`) rather than colour names, so the meaning survives a palette change. Unlike Sass variables, custom properties are **resolved at runtime**, so a theme switch would be a one-line change on `:root` with no rebuild.

## ⚠️ One accessibility note

The palette is dark-only with no `prefers-color-scheme` handling, and contrast ratios haven't been formally checked against WCAG AA. `--muted: #8b90a0` on `--bg: #0f1117` is comfortable but shouldn't be used for essential small text.

The markup **is** reasonably accessible — semantic elements, real `<label for>` associations, `role="alert"` on errors, and `aria-label` on icon buttons. That's not incidental: [RTL queries by role and label](./test/setup.js.md), so inaccessible markup would make the tests fail to find elements.

⭐ That's a genuinely useful side effect worth knowing: **testing by role nudges you toward accessible markup**, because `getByRole` can't find a button with no accessible name.

## Not covered here

CSS-in-JS (emotion, styled-components), utility-first (Tailwind), CSS Modules, BEM, cascade layers, container queries. All real topics — none of them Node/React interview material, so they're out of scope by design.

## Interview questions

Genuinely few for this file. If CSS architecture comes up:

- **"CSS Modules, Tailwind, or CSS-in-JS?"** → Scoping is the real problem each solves. Modules give build-time scoping with zero runtime; Tailwind trades readability for no unused CSS and no naming; CSS-in-JS gives dynamic styling at a runtime cost (and complicates SSR). For a project this size, plain CSS with custom properties is fine.
- **"Why custom properties over Sass variables?"** → Runtime resolution, so theming works without a rebuild.

## Related

- [`components/TaskForm.jsx`](./components/TaskForm.jsx.md) · [`pages/ZustandPage.jsx`](./pages/ZustandPage.jsx.md) — the classes that visualise concepts
- [`test/setup.js`](./test/setup.js.md) — `css: false` in the test config, and why queries ignore classes
