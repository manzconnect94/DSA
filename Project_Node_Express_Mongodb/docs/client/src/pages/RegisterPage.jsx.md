# `client/src/pages/RegisterPage.jsx`

> Registration with live validation feedback. Demonstrates derived state and the one-state-object pattern.

**Lines:** 110 · **Concept blocks:** 3 · **Route:** `/register` (wrapped in `PublicRoute`)

## One state object vs one `useState` per field

```js
const [form, setForm] = useState({ name: '', email: '', password: '' });

const handleChange = (event) => {
  const { name, value } = event.target;
  setForm(prev => ({ ...prev, [name]: value }));   // ⚠️ note the spread
};
```

A single object plus a generic handler scales better than five `useState`s and five handlers.

### ⚠️ Two gotchas

**You MUST spread the previous state**, because `setState` **replaces** rather than merges — unlike the old class-component `this.setState`, **which DID merge shallowly.** ⭐ A real source of confusion when converting classes to hooks. Forget the spread and typing in `email` **wipes `name`**.

**Use the functional form** `setForm(prev => ...)`. Reading `form` directly closes over a possibly-**stale** value if two updates batch together — and [React 18 batches in more places](../main.jsx.md) than 17 did.

## ⭐ Derived state should be COMPUTED, not stored

A frequent design mistake:

```js
❌ const [isValid, setIsValid] = useState(false);
   useEffect(() => { setIsValid(checkForm(form)); }, [form]);
```

That's a **second source of truth** which can **drift out of sync** with the first — and it costs an extra render.

⭐ **The rule: if a value can be calculated from existing state, do not store it. Calculate it during render.**

```js
✅ const validation = useMemo(() => { /* ...issues, isValid */ }, [form]);
```

Only reach for `useMemo` when the calculation is genuinely expensive — **this one is not.** It's memoised here because the object feeds a child prop, so the reason is **identity stability**, not computation cost. ([The distinction that matters.](../components/TaskList.jsx.md))

## ⭐ Client validation is UX; server validation is security

The same point as [`ProtectedRoute`](../routes/ProtectedRoute.jsx.md), and the page says it in the UI:

> ⚠️ *These checks are duplicated in `server/middleware/validate.js`. The client version is for feedback; the server version is the one that actually protects the database.*

**Anyone can bypass the client with curl**, which is why [`server/middleware/validate.js`](../../../server/middleware/validate.js.md) re-validates every field.

⭐ **Client validation that is not duplicated server-side is not validation.** It's a hint.

The inverse also holds: server-only validation works but gives a poor experience (a round-trip per mistake). ⭐ **You want both, for different reasons** — and that's the complete answer rather than picking a side.

## Live feedback

```jsx
{form.password.length > 0 && validation.issues.length > 0 && (
  <ul className="validation-hints">{validation.issues.map(i => <li key={i}>{i}</li>)}</ul>
)}
```

Issues appear as you type, but **only once you've started** — showing "password too short" on an untouched empty field is noise, not help. The submit button is disabled until `validation.isValid`.

⚠️ Note the validation rules here are deliberately mild and **mirror the server's**, which are themselves [not best practice](../../../server/middleware/validate.js.md) — NIST recommends *against* composition rules. They exist to show the shape of the trade-off.

## Interview questions

- **"One state object or several `useState`s?"** → Either; the object scales better with a generic handler. Then name both gotchas: the spread and the functional form.
- **"Why doesn't `setState` merge like `this.setState` did?"** → It replaces. A genuine class-to-hooks trap.
- **"Should you store `isValid` in state?"** → No — derive it. Two sources of truth can drift.
- **"Is client-side validation enough?"** → No. It's UX. The server must re-validate everything.
- **"Then why do it at all?"** → Instant feedback and fewer round-trips. Both layers, different purposes.

## Related

- [`server/middleware/validate.js`](../../../server/middleware/validate.js.md) — the rules that actually matter
- [`context/AuthContext.jsx`](../context/AuthContext.jsx.md) — the `register` action
- [`LoginPage.jsx`](./LoginPage.jsx.md) — the sibling
- [`components/TaskForm.jsx`](../components/TaskForm.jsx.md) — controlled vs uncontrolled
