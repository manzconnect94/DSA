# `client/src/pages/TasksPage.jsx`

> The main page, using the "classic" stack: Context + `useReducer` + manual `useEffect` fetching.

**Lines:** 155 · **Concept blocks:** 4 · **Route:** `/tasks`

## Why this page exists in this form

It deliberately uses the pattern **everyone writes first**, so it can be compared directly against [`ReactQueryPage`](./ReactQueryPage.jsx.md) (same data, React Query) and [`ZustandPage`](./ZustandPage.jsx.md) (same data, selectors).

⭐ Open all three and watch the Network tab. **The comparison is the point.**

## ⭐ Debounced search — visible in the UI

```js
const [searchInput, setSearchInput] = useState('');
const debouncedSearch = useDebounce(searchInput, 400);
```

| Value | Updates | Purpose |
|---|---|---|
| `searchInput` | Every keystroke | Instant UI feedback (controlled input) |
| `debouncedSearch` | 400ms after typing stops | ⭐ **The only one in the effect's dependency array** |

**Result:** typing "backend" gives **7 instant UI updates but exactly 1 API call.** Watch the Network tab to see it.

Without this, each keystroke triggers an [unindexed regex query](../../../server/controllers/taskController.js.md) on the server — ⭐ **you'd be multiplying database load by the user's typing speed.**

A nice touch: a "typing… (no request yet)" pill renders while `searchInput !== debouncedSearch`, so **the gap is observable** rather than theoretical.

## ⚠️ The dependency-array mistake

```js
useEffect(() => { ... }, [fetchTasks, debouncedSearch, statusFilter, page, mode, cursor]);
                          //          ^^^^^^^^^^^^^^^ NOT searchInput
```

⭐ **Swapping `debouncedSearch` for `searchInput` would refetch on every keystroke and make the debounce pointless** — a subtle mistake that's easy to make and easy to miss, because the UI still *looks* correct.

The dependency array isn't bookkeeping — ⭐ **it's the specification of when this data should be re-synchronised.**

## Resetting pagination on filter change

```js
useEffect(() => { setPage(1); setCursor(null); }, [debouncedSearch, statusFilter, mode]);
```

Without it you end up on "page 5" of a result set with only 2 pages and see an **empty list** — which looks like a broken search.

## The pagination toggle

A `<select>` switches `?mode=offset` / `?mode=cursor`, and the controls change to match:

| Mode | Controls | Hint shown |
|---|---|---|
| **Offset** | Previous / Next + "Page 3 of 12 (240 total)" | ⚠️ *Jumping to a deep page is O(offset): MongoDB walks and discards every skipped document.* |
| **Cursor** | Back to start / Load next | ✅ *Constant time at any depth — but no page numbers and no jumping, because there is no total.* |

⭐ The **absence of a total in cursor mode is the honest demonstration**: you can't show "page 7 of 240" because computing it requires the count query that cursor pagination exists to avoid. Full comparison: [`taskController`](../../../server/controllers/taskController.js.md).

## ⭐ Surfacing performance numbers

```jsx
<span>query: <strong>{lastQueryMs}ms</strong></span>
<span className={wasCached ? 'pill cached' : 'pill uncached'}>
  {wasCached ? '✅ served from cache' : '⟳ from MongoDB'}
</span>
```

⭐ **This turns an abstract discussion into an observation.** Hit the same page twice:

| Request | Result |
|---|---|
| First | `cached=false`, ~20ms |
| Second | `cached=true`, ~1ms |

**That's [cache-aside](../../../server/utils/cache.js.md), visible.** Create a task and the pill flips back to uncached — that's **invalidation**, also visible.

## What this page doesn't have

Everything in the [manual-fetching gap list](../hooks/useFetch.js.md): no cache across navigations, no dedup, no background revalidation, no retry. Navigate away and back and it refetches from scratch with a spinner.

⭐ **Noticing that while using the app is more convincing than reading it in a comment** — which is exactly why the React Query page exists next door.

## Interview questions

- **"How do you stop a search box hammering your API?"** → Debounce the value, and put only the debounced value in the dependency array.
- **"Why debounce the value rather than the callback?"** → It composes with React's render model — instant UI, delayed effect.
- **"What goes in a `useEffect` dependency array?"** → Everything the effect reads — and it's a specification of when to re-sync, not a formality.
- **"Why reset the page number when filters change?"** → Otherwise you're on a page that no longer exists.
- **"Why can't cursor pagination show page numbers?"** → No total; getting one needs the count query it avoids.

## Related

- [`context/TaskContext.jsx`](../context/TaskContext.jsx.md) — the state
- [`hooks/useDebounce.js`](../hooks/useDebounce.js.md) — the debounce
- [`ReactQueryPage.jsx`](./ReactQueryPage.jsx.md) · [`ZustandPage.jsx`](./ZustandPage.jsx.md) — the comparisons
- [`server/controllers/taskController.js`](../../../server/controllers/taskController.js.md) — pagination and caching
