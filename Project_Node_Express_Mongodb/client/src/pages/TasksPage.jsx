// ============================================================
// 🧠 CONCEPT: The main page — Context + manual fetching + debounce
// WHY IT MATTERS (interview angle): this page deliberately uses the
//   "classic" stack (Context + useEffect fetching) so it can be compared
//   directly against ReactQueryPage.jsx (same data, React Query) and
//   ZustandPage.jsx (same data, a store with selectors). Open all three
//   and watch the network tab and the render counts.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useTasks } from '../context/TaskContext';
import { useDebounce } from '../hooks/useDebounce';
import TaskForm from '../components/TaskForm';
import TaskList from '../components/TaskList';

export default function TasksPage() {
  const { tasks, status, error, pagination, lastQueryMs, wasCached, fetchTasks, createTask, updateTask, deleteTask } =
    useTasks();

  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState('offset'); // 'offset' | 'cursor'
  const [cursor, setCursor] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // ============================================================
  // 🧠 CONCEPT: Debouncing the search input
  // WHY IT MATTERS (interview angle): `searchInput` updates on every
  //   keystroke (controlled input, instant UI feedback). But
  //   `debouncedSearch` only updates 400ms after typing STOPS — and only
  //   THAT value is in the effect's dependency array below.
  //   Result: typing "backend" gives 7 instant UI updates but exactly ONE
  //   API call. Watch the network tab while typing to see it.
  //   Without this, each keystroke triggers an unindexed regex query on
  //   the server (see the $regex note in taskController.js) — you would be
  //   multiplying database load by the user's typing speed.
  // ============================================================
  const debouncedSearch = useDebounce(searchInput, 400);

  // ============================================================
  // 🧠 CONCEPT: useEffect dependencies drive the refetch
  // WHY IT MATTERS (interview angle): the dependency array is not
  //   bookkeeping — it is the SPECIFICATION of when this data should be
  //   re-synchronised. Note `debouncedSearch` is listed, NOT `searchInput`.
  //   Swapping them would refetch on every keystroke and make the debounce
  //   pointless — a subtle mistake that is easy to make and easy to miss.
  // ============================================================
  useEffect(() => {
    const params = { mode, limit: 20 };
    if (statusFilter) params.status = statusFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    if (mode === 'cursor') {
      if (cursor) params.cursor = cursor;
    } else {
      params.page = page;
    }

    fetchTasks(params);
  }, [fetchTasks, debouncedSearch, statusFilter, page, mode, cursor]);

  // Reset pagination whenever the filters change, or you end up on "page 5"
  // of a result set with only 2 pages and see an empty list.
  useEffect(() => {
    setPage(1);
    setCursor(null);
  }, [debouncedSearch, statusFilter, mode]);

  const handleCreate = useCallback(
    async (payload) => {
      setSubmitting(true);
      const result = await createTask(payload);
      setSubmitting(false);
      return result;
    },
    [createTask]
  );

  const handleToggle = useCallback((id, nextStatus) => updateTask(id, { status: nextStatus }), [updateTask]);
  const handleDelete = useCallback((id) => deleteTask(id), [deleteTask]);

  return (
    <div className="page">
      <h1>Tasks</h1>
      <p className="subtitle">
        State via <strong>Context + useReducer</strong>, data fetched manually in <code>useEffect</code>. Compare with
        the React Query and Zustand pages.
      </p>

      <TaskForm onSubmit={handleCreate} isSubmitting={submitting} />

      <div className="filters">
        <input
          type="search"
          placeholder="Search titles… (debounced 400ms)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {/* Showing both values makes the debounce visible. */}
        {searchInput !== debouncedSearch && <span className="pill">typing… (no request yet)</span>}

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="todo">To do</option>
          <option value="in-progress">In progress</option>
          <option value="done">Done</option>
          <option value="archived">Archived</option>
        </select>

        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="offset">Offset pagination (skip/limit)</option>
          <option value="cursor">Cursor pagination (keyset)</option>
        </select>
      </div>

      {/* ============================================================
          🧠 CONCEPT: Surfacing performance numbers in the UI
          WHY IT MATTERS (interview angle): showing query time and cache
            status turns an abstract discussion into an observation. Hit
            the same page twice: the first says cached=false and ~20ms, the
            second cached=true and ~1ms. That is cache-aside, visible.
          ============================================================ */}
      <div className="perf-bar">
        {lastQueryMs !== null && (
          <>
            <span>
              query: <strong>{lastQueryMs}ms</strong>
            </span>
            <span className={wasCached ? 'pill cached' : 'pill uncached'}>
              {wasCached ? '✅ served from cache' : '⟳ from MongoDB'}
            </span>
          </>
        )}
        {pagination?.mode && <span className="pill">{pagination.mode} mode</span>}
      </div>

      {error && <p className="form-error">{error}</p>}

      <TaskList tasks={tasks} onToggle={handleToggle} onDelete={handleDelete} isLoading={status === 'loading'} />

      {/* ---- Pagination controls ---- */}
      {mode === 'offset' && pagination && (
        <div className="pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <button type="button" disabled={!pagination.hasMore} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
          <small className="hint">
            ⚠️ Jumping to a deep page is O(offset): MongoDB walks and discards every skipped document.
          </small>
        </div>
      )}

      {mode === 'cursor' && pagination && (
        <div className="pagination">
          <button type="button" onClick={() => setCursor(null)} disabled={!cursor}>
            ⟲ Back to start
          </button>
          <button type="button" disabled={!pagination.hasMore} onClick={() => setCursor(pagination.nextCursor)}>
            Load next →
          </button>
          <small className="hint">
            ✅ Constant time at any depth — but no page numbers and no jumping, because there is no total.
          </small>
        </div>
      )}
    </div>
  );
}
