// ============================================================
// 🧠 CONCEPT: useMemo and useCallback — when they HELP and when they HURT
// WHY IT MATTERS (interview angle): the most over-applied optimisation in
//   React. Both memoise, but they memoise different things:
//     • useMemo(fn, deps)     -> caches the RESULT of calling fn
//     • useCallback(fn, deps) -> caches the FUNCTION ITSELF
//   In fact useCallback(fn, d) is exactly useMemo(() => fn, d).
//
//   ⭐ THEY ARE NOT FREE. Both must:
//     1. allocate and keep the dependency array,
//     2. run a comparison loop over it on EVERY render,
//     3. hold the cached value in memory for the component's lifetime.
//   For a cheap computation, that overhead COSTS MORE than just redoing
//   the work. `useMemo(() => a + b, [a, b])` is strictly slower than
//   `a + b`. Saying that out loud is what separates "I've read the docs"
//   from "I've profiled React".
//
//   ✅ useMemo IS WORTH IT WHEN:
//     • The computation is genuinely expensive — sorting/filtering
//       thousands of items, parsing, heavy derivation. Rule of thumb: if
//       it is not >1ms in the profiler, skip it.
//     • The result is an OBJECT or ARRAY passed to a memoised child or
//       used in a dependency array — here you are stabilising IDENTITY,
//       not saving computation, and that is often the real reason.
//
//   ✅ useCallback IS WORTH IT WHEN:
//     • The function goes to a React.memo'd child (a new identity would
//       defeat the memo entirely).
//     • The function is in a useEffect dependency array (a new identity
//       would re-run the effect every render — sometimes infinitely).
//     • The function goes into a context value.
//
//   ❌ SKIP BOTH FOR: simple arithmetic, string building, handlers on
//      plain DOM elements (<button onClick={...}> — the DOM node is not a
//      React component and cannot be "defeated"), and anything you have
//      not measured.
//
//   ⚠️ AND THE BIGGEST TRAP: React.memo + an inline object/arrow prop
//      cancels itself out.
//        <MemoChild style={{ color: 'red' }} onClick={() => x()} />
//      Both props are new references every render, so memo always sees a
//      change and re-renders anyway. You paid for the comparison and got
//      nothing. Memoising a child is pointless unless EVERY prop is stable.
//
//   (React 19's compiler auto-memoises, which is itself an admission that
//   doing this by hand was error-prone.)
//
// HOW IT WORKS HERE: an expensive sort/filter that genuinely benefits, and
//   a memoised row component with stable callbacks.
// ============================================================

import { useMemo, useCallback, useState, memo } from 'react';

// ============================================================
// 🧠 CONCEPT: React.memo — skip re-rendering when props are unchanged
// WHY IT MATTERS (interview angle): by default, when a parent re-renders,
//   ALL its children re-render — even ones whose props did not change.
//   React.memo adds a shallow prop comparison and bails out if nothing
//   changed.
//   ⚠️ "Shallow" is the catch: it compares with Object.is, so a new object
//   or array literal always looks different. That is precisely why the
//   parent below wraps its handlers in useCallback — without that, this
//   memo would do nothing at all.
// ============================================================
const TaskRow = memo(function TaskRow({ task, onToggle, onDelete }) {
  const id = task.id || task._id;

  return (
    <li className={`task-row status-${task.status}`}>
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={() => onToggle(id, task.status)}
        aria-label={`Mark "${task.title}" as done`}
      />
      <span className="task-title">{task.title}</span>
      <span className={`pill priority-${task.priority}`}>{task.priority}</span>
      <span className={`pill status-${task.status}`}>{task.status}</span>
      {task.dueDate && <span className="due">{new Date(task.dueDate).toLocaleDateString()}</span>}
      <button type="button" onClick={() => onDelete(id)} aria-label={`Delete "${task.title}"`}>
        ✕
      </button>
    </li>
  );
});

export default function TaskList({ tasks = [], onToggle, onDelete, isLoading = false }) {
  const [sortBy, setSortBy] = useState('createdAt');
  const [hideCompleted, setHideCompleted] = useState(false);

  // ============================================================
  // 🧠 CONCEPT: ✅ A JUSTIFIED useMemo
  // WHY IT MATTERS (interview angle): this filters AND sorts the whole
  //   list. With 10,000 tasks that is a real O(n log n) cost, and WITHOUT
  //   useMemo it would re-run on EVERY render — including renders caused
  //   by something completely unrelated, like typing in a search box
  //   elsewhere on the page.
  //   The dependency array says: only redo this when the tasks, the sort,
  //   or the filter actually change. That is the correct use — the work is
  //   expensive AND the inputs change rarely relative to render frequency.
  //   (Contrast with `useMemo(() => tasks.length, [tasks])`, which would
  //   be pure overhead.)
  // ============================================================
  const visibleTasks = useMemo(() => {
    // Uncomment to prove to yourself when this actually runs:
    // console.log('[useMemo] re-sorting', tasks.length, 'tasks');

    const filtered = hideCompleted ? tasks.filter((t) => t.status !== 'done') : tasks;

    const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };

    // ⚠️ .sort() MUTATES the array in place. Sorting `tasks` directly
    // would mutate props — a React anti-pattern that produces stale UI,
    // because React sees the same array reference and may skip the render.
    // Always copy first.
    return [...filtered].sort((a, b) => {
      if (sortBy === 'priority') return (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [tasks, sortBy, hideCompleted]);

  // Cheap derived values — deliberately NOT memoised. Counting an array is
  // microseconds; wrapping these in useMemo would cost more than it saves.
  const completedCount = visibleTasks.filter((t) => t.status === 'done').length;

  // ============================================================
  // 🧠 CONCEPT: ✅ A JUSTIFIED useCallback
  // WHY IT MATTERS (interview angle): these go to the memo'd TaskRow. If
  //   they were inline arrows, each row would receive a NEW function every
  //   render, React.memo's shallow compare would always fail, and all 500
  //   rows would re-render on every parent render — the memo would be pure
  //   overhead. useCallback is what makes React.memo actually work.
  //   ⭐ That pairing is the point: React.memo on the child and
  //   useCallback on the parent's handlers are a MATCHED SET. One without
  //   the other is usually wasted effort.
  // ============================================================
  const handleToggle = useCallback(
    (id, currentStatus) => {
      onToggle(id, currentStatus === 'done' ? 'todo' : 'done');
    },
    [onToggle]
  );

  const handleDelete = useCallback(
    (id) => {
      onDelete(id);
    },
    [onDelete]
  );

  if (isLoading && tasks.length === 0) {
    return <p className="muted">Loading tasks…</p>;
  }

  if (tasks.length === 0) {
    return <p className="muted">No tasks yet. Create one above.</p>;
  }

  return (
    <div className="task-list">
      <div className="list-controls">
        <label>
          Sort by{' '}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="createdAt">Newest</option>
            <option value="priority">Priority</option>
            <option value="title">Title</option>
          </select>
        </label>

        <label>
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed
        </label>

        <span className="muted">
          {visibleTasks.length} shown · {completedCount} done
        </span>
      </div>

      <ul>
        {visibleTasks.map((task) => (
          // ============================================================
          // 🧠 CONCEPT: The `key` prop — and why INDEX IS A BUG
          // WHY IT MATTERS (interview angle): keys let React's
          //   reconciliation match elements between renders. A stable,
          //   unique key means "this is the SAME item, just moved".
          //
          //   ❌ key={index} BREAKS when the list can reorder, filter or
          //   have items inserted/removed at the front. Delete the first
          //   item and every remaining item's index shifts down by one, so
          //   React thinks EVERY item changed content rather than that one
          //   was removed. Two visible consequences:
          //     1. Unnecessary re-renders of every row (performance).
          //     2. ⚠️ STATE ATTACHES TO THE WRONG ROW. If each row has an
          //        input or a checkbox, its internal state stays with the
          //        POSITION, not the item. Delete row 1 and row 2's typed
          //        text jumps to row 1. This is a real, confusing bug that
          //        looks like data corruption.
          //   Note this list has BOTH a delete button and a sort control,
          //   so it is exactly the case where index keys would break.
          //
          //   ⚠️ Also never use Math.random() as a key: it changes every
          //   render, so React unmounts and remounts every item — the
          //   worst possible outcome.
          //
          //   Index IS acceptable when the list is static, never reordered,
          //   never filtered, and the items have no state. That is rarer
          //   than people assume, so the habit should be a stable id.
          // ============================================================
          <TaskRow key={task.id || task._id} task={task} onToggle={handleToggle} onDelete={handleDelete} />
        ))}
      </ul>
    </div>
  );
}
