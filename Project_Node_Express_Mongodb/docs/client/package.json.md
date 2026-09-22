# `client/package.json`

> Frontend dependencies. Note `"type": "module"` — this half of the repo is ESM.

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `vite` | Dev server on :5173 with HMR |
| `build` | `vite build` | Production bundle to `dist/` |
| `preview` | `vite preview` | Serve the built output locally — **worth doing before deploying**, since dev and prod use different strategies |
| `test` | `vitest run` | 6 tests, once |
| `test:watch` | `vitest` | Watch mode |
| `analyze` | `vite build` + a hint | Inspect `dist/assets` to see the code-split chunks |

## Dependencies

| Package | Purpose | Doc |
|---|---|---|
| `react` ^18.3 | `createRoot`, concurrent rendering | [main.jsx](./src/main.jsx.md) |
| `react-dom` ^18.3 | DOM renderer | " |
| `react-router-dom` ^6.26 | Routing, `Navigate`, `Outlet` | [App.jsx](./src/App.jsx.md) |
| `axios` ^1.7 | HTTP + **interceptors** | [axiosClient](./src/api/axiosClient.js.md) |
| `zustand` ^4.5 | Store with selectors | [taskStore](./src/store/taskStore.js.md) |
| `@tanstack/react-query` ^5.51 | **Server-state cache** | [ReactQueryPage](./src/pages/ReactQueryPage.jsx.md) |

Six runtime dependencies — deliberately small. No UI kit, no CSS framework, no form library: the point is the concepts, not the component library.

**Why axios over `fetch`:** interceptors. `fetch` has no equivalent, so the [single-flight refresh](./src/api/axiosClient.js.md) would mean wrapping every call site or monkey-patching `window.fetch`. Axios also gives automatic JSON parsing, `withCredentials`, and request cancellation via `AbortController`.

## devDependencies

| Package | Purpose |
|---|---|
| `vite` ^5.4 + `@vitejs/plugin-react` | Build tooling and Fast Refresh |
| `vitest` ^2.0 | Test runner — **Vite-native**, so it shares the same config and transform pipeline |
| `@testing-library/react` ^16 | Component testing |
| `@testing-library/user-event` ^14.5 | ⭐ Realistic interaction simulation |
| `@testing-library/jest-dom` ^6.4 | Matchers like `toBeDisabled()` |
| `jsdom` ^24 | A DOM for Node |

## Vitest vs Jest

The server uses Jest; the client uses Vitest. Not inconsistency — Vitest reuses [`vite.config.js`](./vite.config.js.md), so JSX transforms, aliases and plugins are configured **once**. With Jest you'd need Babel config and a transform chain duplicating what Vite already does. Vitest's API is intentionally Jest-compatible (`describe`/`test`/`expect`, `vi` instead of `jest`), so knowledge transfers.

## `user-event` vs `fireEvent`

⭐ Worth knowing the difference:

| | Behaviour |
|---|---|
| `fireEvent.change(input, {...})` | Dispatches **one** synthetic event |
| `userEvent.type(input, 'abc')` | Simulates the **full** interaction: focus, keydown, keypress, input, keyup **per character** |

`user-event` catches bugs `fireEvent` misses — a handler that only listens for `keydown`, or a field that behaves differently when focused. It's async (returns promises), hence `await user.type(...)`.

## ⚠️ `"type": "module"`

Makes every `.js` file in this package ESM. Consequences: no `require()`, no `__dirname`, and a CommonJS-only config file must be renamed `.cjs`. The server package deliberately omits this.

## Interview questions

- **"Why axios instead of `fetch`?"** → Interceptors, primarily. Everything else is convenience.
- **"Jest or Vitest?"** → Vitest for a Vite project — shared config, no duplicated transform pipeline. API-compatible either way.
- **"`fireEvent` or `userEvent`?"** → `userEvent`. It simulates the real event sequence and catches bugs a single synthetic event doesn't.

## Related

- [Root `package.json`](../package.json.md) · [`vite.config.js`](./vite.config.js.md) · [`Dockerfile`](./Dockerfile.md)
