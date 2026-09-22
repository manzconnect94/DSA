// ============================================================
// 🧠 CONCEPT: React Testing Library setup
// WHY IT MATTERS (interview angle): RTL's guiding principle is
//   "the more your tests resemble the way your software is used, the more
//   confidence they give you". In practice that means:
//   ✅ Query by what a USER perceives: role, label text, visible text,
//      placeholder. `getByRole('button', { name: /log in/i })`
//   ❌ Don't query by CSS class or component internals. Those are
//      implementation details — rename a class and a passing test breaks
//      even though the app works perfectly. That is a test that costs you
//      money without catching bugs.
//   ⭐ The practical benefit people miss: querying by ROLE means your
//      tests fail when the UI is inaccessible. A button with no
//      accessible name cannot be found by getByRole, so RTL nudges you
//      toward accessible markup.
// ============================================================

import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount components between tests so no DOM state leaks — the client-side
// equivalent of clearing collections in server/tests/setup.js.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom does not implement matchMedia, and any component using it would
// throw. Stubbing browser APIs jsdom lacks is routine setup.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
