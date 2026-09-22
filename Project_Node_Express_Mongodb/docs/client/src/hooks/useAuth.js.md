# `client/src/hooks/useAuth.js`

> An 11-line re-export. The smallest file in the project, and it exists for one deliberate reason.

**Lines:** 11 · **Concept blocks:** 1

## The whole file

```js
export { useAuth, default as AuthContext } from '../context/AuthContext';
export { useAuth as default } from '../context/AuthContext';
```

## Why it exists

The hook itself lives next to the Context it reads ([`context/AuthContext.jsx`](../context/AuthContext.jsx.md)), because they're **coupled** — the hook is meaningless without the provider, and splitting them would mean editing two files for one change.

But consumers should import from a **consistent `hooks/` location**. So if the implementation later moves to Zustand, Redux, or a completely different auth library, **every component keeps importing `useAuth` from the same path and none of them change.**

⭐ **A small thing that makes a large refactor cheap.** It's the abstraction-boundary idea applied to imports rather than to code.

## The pattern generalised

This is a **barrel / facade** at the module level:

```
components import ──▶ hooks/useAuth  ──▶ context/AuthContext  (today)
                              └────────▶ store/authStore      (hypothetically, tomorrow)
```

The indirection costs one file and buys the freedom to change what's behind it. The same reasoning appears elsewhere in the project:

| Facade | Hides |
|---|---|
| `hooks/useAuth.js` | Whether auth is Context, Zustand or Redux |
| [`api/axiosClient.js`](../api/axiosClient.js.md) | Whether HTTP is axios or fetch, and the error envelope shape |
| [`utils/logger.js`](../../../server/utils/logger.js.md) | Whether logging is hand-rolled, Winston or Pino |
| [`routes/index.js`](../../../server/routes/index.js.md) | Where the API-version seam goes |

## Both named and default export

```js
import useAuth from '../hooks/useAuth';          // default
import { useAuth } from '../hooks/useAuth';      // named
```

Both work, so neither import style breaks. ⚠️ In a larger codebase you'd pick **one** — mixed conventions make grep and codemods harder, and a default export can be renamed silently at the import site (`import whatever from ...`), which hurts searchability.

## ⚠️ Would I add this file again?

Honestly: it's borderline. The argument against is that it's **indirection with no current benefit** — one more hop when you're reading the code, and a second place to look.

The argument for is that `useAuth` is consumed by seven files, so the day the implementation changes, this file is the difference between one edit and seven.

⭐ **Worth knowing both sides.** "I added a facade for a refactor that might never happen" is a fair criticism of speculative abstraction; the counter is that this one costs 11 lines and the seam is genuinely likely (auth implementations get replaced).

## Interview questions

- **"Why re-export instead of importing directly?"** → A stable import path, so the implementation can change without touching consumers.
- **"Isn't that speculative abstraction?"** → Sometimes. Justified when the number of consumers is high and the implementation is genuinely likely to change. Not justified as a blanket habit.
- **"Named or default exports?"** → Pick one per codebase. Named are better for grep, refactoring tools and tree-shaking clarity; defaults are briefer.

## Related

- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — the real implementation
- [`hooks/README.md`](./README.md) — the folder's purpose
