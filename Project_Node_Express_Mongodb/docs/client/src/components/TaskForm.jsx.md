# `client/src/components/TaskForm.jsx`

> Controlled **and** uncontrolled inputs in the same form, with a live render counter proving the difference.

**Lines:** 206 · **Concept blocks:** 4

## What's what

| Field | Style | Why |
|---|---|---|
| `title` | **Controlled** | Needs live character count and a disabled submit button |
| `status`, `priority` | **Controlled** | Simple selects |
| `description` | **Uncontrolled** (`ref`) | To show the contrast — watch the render counter stay still |
| file input | ⭐ **Must be uncontrolled** | Browser security — see below |

⭐ **Watch the render counter** as you type in each field. It ticks on every keystroke in the controlled title and **stays still** in the uncontrolled description. **That single observation is the entire lesson of this file.**

## ⭐ Controlled vs uncontrolled

### Controlled

```jsx
<input value={title} onChange={e => setTitle(e.target.value)} />
```

React state is the **single source of truth**. The DOM input merely displays what state says. Every keystroke: `onChange` → `setState` → re-render → new `value` prop.

| ✅ | ❌ |
|---|---|
| Validate/transform on every keystroke (force uppercase, strip characters, live character counts) | **A re-render per keystroke.** Usually irrelevant, but in a large form or a slow tree it's measurable jank |
| Disable submit based on current values | More boilerplate: state + handler per field |
| Easy to reset, prefill, or drive from elsewhere | |
| The value is always available without touching the DOM | |

### Uncontrolled

```jsx
<input defaultValue="" ref={inputRef} />   // read ref.current.value on submit
```

The DOM holds the value; React reads it only when you ask.

| ✅ | ❌ |
|---|---|
| **Zero re-renders while typing** — genuinely faster for big forms | No live validation or derived UI |
| Less code | You must reach into the DOM — less "React-y" |
| ⭐ **Required for file inputs** | |

## ⚠️ The error everyone hits

`value={undefined}` makes an input uncontrolled; later setting a real value makes it controlled, and React warns:

> *A component is changing an uncontrolled input to be controlled.*

**The fix: initialise state to `''`** — never `undefined` or `null`. Done throughout this file.

## ⭐ A file input CANNOT be controlled

The `value` of `<input type="file">` is **read-only by browser security design**. If a page could set it programmatically, **any site could silently upload a file from your disk.**

So file inputs are **always** uncontrolled — you read `ref.current.files`.

⭐ **This is not a React limitation; it's a web platform rule**, and knowing the reason is the good answer.

## ⭐ `useRef` has two distinct jobs

Both are in this file.

### Use #1 — DOM access

```js
const titleInputRef = useRef(null);
useEffect(() => { titleInputRef.current?.focus(); }, []);
```

An escape hatch to a real DOM node. **Legitimate uses:** focus management, text selection, measuring size, triggering media playback, integrating a non-React library (a chart, a map, a rich-text editor) that wants a DOM element.

⚠️ **NOT** for reading or writing content you could hold in state. Reaching into the DOM to change what's displayed fights React's model and produces UI that disagrees with state.

### Use #2 — persist a value WITHOUT re-rendering

```js
const renderCount = useRef(0);
renderCount.current += 1;
```

⭐ **The render counter is the clearest possible demonstration.** If this were `useState`, incrementing it would trigger a render, which would increment it, which would render... **an infinite loop.** Because a ref mutation does **not** re-render, it can safely track render-related data.

| | Re-renders on change? | Survives re-render? |
|---|---|---|
| `useState` | ✅ | ✅ |
| `useRef` | ❌ | ✅ |
| a local variable | — | ❌ reset every render |

## ⭐ react-hook-form, and why this matters

`react-hook-form` is popular **precisely because it uses uncontrolled inputs under the hood (via refs)** to avoid per-keystroke re-renders, while still giving you a validation API.

Mentioning that shows you know **why** the trade-off matters in practice, not just that it exists.

## The asymmetry on reset

```js
setTitle('');                                        // controlled: setState
if (descriptionRef.current) descriptionRef.current.value = '';   // uncontrolled: touch the DOM
```

⭐ That asymmetry **is the practical cost** of uncontrolled inputs — resetting, prefilling and validating all require DOM access rather than a state update.

## Behaviour on failure

```js
} else if (result?.error) { setFormError(result.error); }
```

⭐ The form is **not** cleared on failure. [Asserted in a test](../test/TaskForm.test.jsx.md) — **wiping a form because the server said no is a genuinely infuriating bug.**

## Interview questions

- **"Controlled vs uncontrolled?"** → Source of truth. Then the re-render trade-off, with the counter as the demonstration.
- **"Which is faster?"** → Uncontrolled — no re-render per keystroke. Mention react-hook-form.
- **"Why can't a file input be controlled?"** → Its `value` is read-only for security; otherwise sites could exfiltrate local files.
- **"React warns about changing uncontrolled to controlled."** → `value` started `undefined`. Initialise to `''`.
- **"When do you use `useRef`?"** → Both uses. The render counter shows why `useState` can't do the second.
- **"Should a failed submit clear the form?"** → No.

## Related

- [`TaskList.jsx`](./TaskList.jsx.md) — the memoisation sibling
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — `useRef` use #2 for a StrictMode guard
- [`test/TaskForm.test.jsx`](../test/TaskForm.test.jsx.md) — tests both input styles
- [`server/middleware/upload.js`](../../../server/middleware/upload.js.md) — where the file actually goes
