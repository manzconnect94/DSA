# `client/src/test/TaskForm.test.jsx`

> 5 component tests + 1 custom-hook test. All 6 pass.

**Lines:** 101 · **Concept blocks:** 2 · **Tests:** 6

## ⭐ Testing the way a USER interacts

**None of these tests reference a CSS class, a component name, or internal state.** They find elements by their **accessible label** and drive them with **real keyboard and click events**.

⭐ **That means the tests survive any refactor that keeps the BEHAVIOUR the same** — which is precisely the property you want. Rename a class, restructure the JSX, switch from a `div` to a `section`: the tests still pass, because none of that changes what a user experiences.

```js
screen.getByRole('button', { name: /add task/i })   // ✅ what a user sees
screen.getByLabelText(/title/i)                     // ✅ the accessible label
// NOT: container.querySelector('.task-form input')  ❌
```

## The component tests

| Test | Asserts | Concept |
|---|---|---|
| Submit disabled until a title is entered | `toBeDisabled()` → `toBeEnabled()` | ⭐ **Only possible because the title is CONTROLLED** — the disabled state derives from React state on every keystroke |
| Submits both controlled **and** uncontrolled values | `onSubmit` called with `{ title, description, priority }` | ⭐ Proves the **`ref` read worked** — `description` is uncontrolled and read from the DOM at submit time |
| Trims whitespace | `title: 'padded'` from `'   padded   '` | |
| Clears the form on success | `toHaveValue('')` | |
| ⭐ **Shows the error and does NOT clear on failure** | Error text appears, `toHaveValue('Duplicate')` | |

### ⭐ The failure test is the interesting one

```js
const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: 'Title already exists' });
// ...
expect(await screen.findByText(/title already exists/i)).toBeInTheDocument();
expect(titleInput).toHaveValue('Duplicate');   // ← the assertion that matters
```

⭐ **Keeping the user's input on failure is basic courtesy — wiping a form because the server said no is a genuinely infuriating bug.** It's also the kind of thing that only gets noticed in production, because nobody tests the sad path manually.

Note `findByText` (async) rather than `getByText` — the error appears after a promise resolves, so the query must wait. ⚠️ Using `getByText` here would fail intermittently, which is how flaky tests are born.

## ⭐ Testing a custom hook with `renderHook`

```js
vi.useFakeTimers();

const { result, rerender } = renderHook(({ value }) => useDebounce(value, 400),
                                         { initialProps: { value: 'a' } });

rerender({ value: 'ab' });
rerender({ value: 'abc' });
rerender({ value: 'abcd' });          // three rapid "keystrokes"

expect(result.current).toBe('a');     // ⭐ nothing settled — cleanup cancelled each timer

act(() => { vi.advanceTimersByTime(400); });

expect(result.current).toBe('abcd');  // ⭐ only the LAST value survives
```

A hook is just a function, but it can **only run inside a component**. `renderHook` provides a minimal host component so you can test the hook **alone** — no UI, no mocking of unrelated things.

⭐ **Combined with fake timers, you test time-based behaviour instantly** instead of actually waiting 400ms per assertion. The test runs in under a millisecond.

**And it proves the [cleanup function](../hooks/useDebounce.js.md) works:** the mid-test assertion that `result.current` is still `'a'` after three rerenders is only true because each `clearTimeout` cancelled the previous timer. ⭐ **That's testing the mechanism, not just the outcome.**

⚠️ `act()` is required around `advanceTimersByTime` — the timer callback calls `setState`, and React needs to know a state update is happening so it can flush and re-render before you assert. Without it you get a warning and a stale `result.current`.

## `userEvent.setup()`

```js
const user = userEvent.setup();
await user.type(screen.getByLabelText(/title/i), 'Write the README');
```

The v14 API. `user.type` simulates the **full** interaction per character — focus, keydown, keypress, input, keyup — which catches bugs `fireEvent.change` (one synthetic event) would miss.

⚠️ It's **async**, hence `await`. Forgetting the `await` is a common source of "my assertion ran before the typing finished".

## Why this file, and what's missing

`TaskForm` is the highest-value component to test: it has real branching logic (validation, success/failure paths, reset behaviour) and it demonstrates both input styles. [`TaskList`](../components/TaskList.jsx.md) is mostly derived rendering; [`ErrorBoundary`](../components/ErrorBoundary.jsx.md) is better verified by using it.

⚠️ ⭐ **The biggest genuine gap is [the axios interceptor](../api/axiosClient.js.md)** — the single-flight refresh is the most subtle logic on the client and it's **untested**. The test to write: mock the 401/refresh sequence with `msw` and assert that **ten concurrent 401s produce exactly one refresh call.** See the [folder doc](./README.md).

## Interview questions

- **"How do you test a React component?"** → Render it, interact as a user, assert on accessible output. Never on classes or internals.
- **"How do you test a custom hook?"** → `renderHook`, plus fake timers for anything time-based.
- **"Why `act()` around a timer advance?"** → The callback sets state; React must flush before you assert.
- **"`findBy` or `getBy`?"** → `findBy` (async) when the element appears after a promise. Using `getBy` there is a classic flake.
- **"Should a failed submit clear the form?"** → No — and it's worth a test, because nobody checks the sad path by hand.
- **"What would you test next?"** → The interceptor's single-flight refresh, with `msw`.

## Related

- [`components/TaskForm.jsx`](../components/TaskForm.jsx.md) — the component under test
- [`hooks/useDebounce.js`](../hooks/useDebounce.js.md) — the hook under test
- [`setup.js`](./setup.js.md) — matchers and cleanup
- [`server/tests/mocking.test.js`](../../../server/tests/mocking.test.js.md) — fake timers on the backend
