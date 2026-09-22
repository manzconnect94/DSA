// ============================================================
// 🧠 CONCEPT: Zustand in practice — SELECTIVE subscriptions
// WHY IT MATTERS (interview angle): this page exists to make the Context
//   re-render problem OBSERVABLE rather than theoretical. Each panel below
//   counts its own renders. Type in the search box and watch:
//     • The Context-based TasksPage re-renders EVERY consumer.
//     • Here, only the components whose SELECTED SLICE changed re-render.
//   That is the whole argument, demonstrated in about 30 lines.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import useTaskStore, { useTaskCount, useCompletedCount, useTaskList, useTaskStatus } from '../store/taskStore';
import TaskList from '../components/TaskList';
import TaskForm from '../components/TaskForm';

// A tiny helper to make re-renders visible.
function useRenderCount(label) {
  const count = useRef(0);
  count.current += 1;
  return (
    <span className="render-badge" title={`${label} has rendered ${count.current} times`}>
      {label}: {count.current} renders
    </span>
  );
}

// ============================================================
// 🧠 CONCEPT: This component subscribes to ONE derived number
// WHY IT MATTERS (interview angle): `useTaskCount` is
//   `useTaskStore(s => s.tasks.length)`. Zustand runs that selector after
//   every store change and compares the RESULT with Object.is. Editing a
//   task's title changes the store but NOT the length — so this component
//   does not re-render at all.
//   With Context, this component would re-render on every single change
//   to the context value, because Context has no concept of "which part
//   did you read?". That is the difference, in one component.
// ============================================================
function TaskCounter() {
  const count = useTaskCount();
  const badge = useRenderCount('TaskCounter');
  return (
    <div className="stat-card">
      <strong>{count}</strong> tasks {badge}
      <small>subscribes to: tasks.length only</small>
    </div>
  );
}

function CompletedCounter() {
  const completed = useCompletedCount();
  const badge = useRenderCount('CompletedCounter');
  return (
    <div className="stat-card">
      <strong>{completed}</strong> completed {badge}
      <small>subscribes to: the count of done tasks only</small>
    </div>
  );
}

// ============================================================
// 🧠 CONCEPT: ❌ The ANTI-PATTERN, shown deliberately
// WHY IT MATTERS (interview angle): calling the store hook with NO
//   selector subscribes to the ENTIRE store, so this component re-renders
//   on every change — exactly like a Context consumer. It is here as the
//   control group: compare its render count with the two above after
//   changing a filter. Same store, completely different behaviour, purely
//   because of the selector.
// ============================================================
function WholeStoreConsumer() {
  const store = useTaskStore(); // ⚠️ no selector = subscribe to everything
  const badge = useRenderCount('WholeStoreConsumer ⚠️');
  return (
    <div className="stat-card warn">
      status: <strong>{store.status}</strong> {badge}
      <small>⚠️ no selector — re-renders on ANY store change (this is Context behaviour)</small>
    </div>
  );
}

export default function ZustandPage() {
  const tasks = useTaskList();
  const status = useTaskStatus();

  // Actions never change identity, so selecting them individually gives a
  // stable reference that never causes a re-render.
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const [submitting, setSubmitting] = useState(false);
  const pageBadge = useRenderCount('ZustandPage');

  useEffect(() => {
    fetchTasks({ limit: 20 });
  }, [fetchTasks]);

  return (
    <div className="page">
      <h1>Tasks — Zustand</h1>
      <p className="subtitle">
        The same data as the Tasks page, but stored in Zustand with <strong>selector-based subscriptions</strong>.
        Watch the render counters below: only the components whose selected slice changed will re-render.
      </p>

      <div className="stat-row">
        <TaskCounter />
        <CompletedCounter />
        <WholeStoreConsumer />
      </div>
      <div className="perf-bar">{pageBadge}</div>

      <details className="concept-note" open>
        <summary>What to try</summary>
        <ol>
          <li>Add a task — every counter changes, so all of them re-render. Expected.</li>
          <li>
            Now toggle a task from <em>todo</em> to <em>done</em>. <code>TaskCounter</code> should NOT re-render (the
            length didn&apos;t change) but <code>CompletedCounter</code> will.
          </li>
          <li>
            <code>WholeStoreConsumer</code> re-renders every time regardless — that is what a missing selector (and
            what Context) costs you.
          </li>
        </ol>
      </details>

      <TaskForm
        onSubmit={async (payload) => {
          setSubmitting(true);
          const result = await createTask(payload);
          setSubmitting(false);
          return result;
        }}
        isSubmitting={submitting}
      />

      <TaskList
        tasks={tasks}
        isLoading={status === 'loading'}
        onToggle={(id, nextStatus) => updateTask(id, { status: nextStatus })}
        onDelete={(id) => deleteTask(id)}
      />

      <details className="concept-note">
        <summary>Context vs Zustand vs Redux — the short version</summary>
        <table>
          <thead>
            <tr>
              <th />
              <th>Context</th>
              <th>Zustand</th>
              <th>Redux Toolkit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Bundle cost</td>
              <td>0 (built in)</td>
              <td>~1KB</td>
              <td>~12KB</td>
            </tr>
            <tr>
              <td>Selective subscriptions</td>
              <td>❌ all consumers re-render</td>
              <td>✅ via selectors</td>
              <td>✅ via useSelector</td>
            </tr>
            <tr>
              <td>Provider required</td>
              <td>Yes</td>
              <td>No</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Usable outside React</td>
              <td>❌</td>
              <td>✅ getState()</td>
              <td>✅ store.dispatch()</td>
            </tr>
            <tr>
              <td>Devtools</td>
              <td>❌</td>
              <td>✅ (via middleware)</td>
              <td>✅ best in class</td>
            </tr>
            <tr>
              <td>Boilerplate</td>
              <td>Low</td>
              <td>Lowest</td>
              <td>Moderate</td>
            </tr>
            <tr>
              <td>SSR-safe by default</td>
              <td>✅ (per-tree)</td>
              <td>⚠️ module singleton</td>
              <td>✅ (per-request store)</td>
            </tr>
          </tbody>
        </table>
        <p>
          ⭐ But first ask whether it is <strong>server state</strong>. If it lives in a database, React Query is
          usually the better answer than any of these three.
        </p>
      </details>
    </div>
  );
}
