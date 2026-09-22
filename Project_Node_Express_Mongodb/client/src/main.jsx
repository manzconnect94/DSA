// ============================================================
// 🧠 CONCEPT: ES Modules on the client (contrast with the server's CJS)
// WHY IT MATTERS (interview angle): this file uses `import`; every server
//   file uses `require`. That is deliberate, so the repo demonstrates both
//   — the full comparison table lives at the top of server/app.js.
//   The short version of why the client uses ESM: bundlers need STATIC
//   analysis to tree-shake unused code and to split bundles at dynamic
//   `import()` boundaries (which is what React.lazy relies on in App.jsx).
//   CommonJS's runtime `require()` makes both impossible.
// ============================================================

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// ============================================================
// 🧠 CONCEPT: createRoot — the React 18 concurrent renderer
// WHY IT MATTERS (interview angle): React 18 replaced
//   `ReactDOM.render(<App/>, el)` with `createRoot(el).render(<App/>)`.
//   It is not cosmetic — the new root opts you into CONCURRENT RENDERING:
//   • AUTOMATIC BATCHING everywhere. In React 17, multiple setState calls
//     inside a promise or setTimeout each caused a separate render. In 18
//     they are batched, so you get one render. This is the change most
//     likely to alter behaviour in an upgraded app.
//   • INTERRUPTIBLE RENDERING — React can pause a low-priority render to
//     handle urgent user input, then resume. That is what makes
//     useTransition and useDeferredValue possible.
//   • Full <Suspense> support for streaming SSR.
//   Calling the old render() in React 18 still works but logs a warning
//   and silently keeps you in legacy mode with none of the above.
// ============================================================
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  // ============================================================
  // 🧠 CONCEPT: StrictMode DOUBLE-INVOKES things in development
  // WHY IT MATTERS (interview angle): a question that trips people up
  //   constantly — "why does my useEffect run twice?"
  //
  //   In DEVELOPMENT ONLY, StrictMode deliberately:
  //   • Renders components twice, to surface impure render logic.
  //   • MOUNTS, UNMOUNTS, THEN REMOUNTS every component, running each
  //     effect -> cleanup -> effect.
  //
  //   ⭐ It is not a bug and not something to "fix" by removing
  //   StrictMode. It is a detector: it finds effects with MISSING OR
  //   BROKEN CLEANUP. An effect that opens a subscription without closing
  //   it will leak in production; StrictMode makes that leak visible
  //   immediately, in development, instead of in a week-old production
  //   session.
  //
  //   ⚠️ IT DOES NOT HAPPEN IN PRODUCTION BUILDS. So if double-invocation
  //   breaks something, the correct response is to make the effect
  //   idempotent, not to disable the check. A concrete example of getting
  //   this right is in src/context/AuthContext.jsx: the boot refresh is
  //   guarded by a useRef flag, because calling /auth/refresh twice would
  //   trip the server's refresh-token REUSE DETECTION and log the user
  //   straight back out. That is a real bug StrictMode caught.
  // ============================================================
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
