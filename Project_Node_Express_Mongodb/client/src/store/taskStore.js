// ============================================================
// 🧠 CONCEPT: Zustand — the same state as TaskContext, for direct comparison
// WHY IT MATTERS (interview angle): "Context API or Redux?" is a standard
//   question, and the strong answer names the ACTUAL differences rather
//   than repeating "Redux is for big apps".
//
//   ── CONTEXT API ────────────────────────────────────────────────────
//   ✅ Built in — zero dependencies, zero bundle cost.
//   ✅ Perfect for LOW-FREQUENCY, GLOBAL values: theme, locale, the
//      current user, feature flags.
//   ❌ ⭐ RE-RENDER GRANULARITY IS ALL-OR-NOTHING. Any change to the
//      context value re-renders EVERY consumer, even one that only reads
//      an unrelated field. React.memo cannot save you — useContext
//      subscribes the component directly, and memo only compares props.
//   ❌ No built-in devtools, middleware, or persistence.
//   ❌ Provider nesting gets deep fast ("provider hell").
//   ❌ It is a DEPENDENCY INJECTION mechanism, not a state manager. It has
//      no opinion about how state is updated — that is still useState or
//      useReducer.
//
//   ── REDUX TOOLKIT ──────────────────────────────────────────────────
//   ✅ ⭐ SELECTOR-BASED SUBSCRIPTIONS: useSelector(s => s.tasks.length)
//      re-renders ONLY when that derived value changes. This is the core
//      technical reason to leave Context.
//   ✅ Superb devtools: time-travel, action log, state diffs.
//   ✅ Middleware for async, logging, analytics; RTK Query for caching.
//   ✅ A strict, enforced structure — a real advantage on a large team,
//      because everyone writes state code the same way.
//   ❌ Boilerplate (much reduced by RTK, but slices/reducers/actions are
//      still ceremony) and ~12KB gzipped.
//
//   ── ZUSTAND (this file) ────────────────────────────────────────────
//   ✅ Selector subscriptions like Redux — the key performance property.
//   ✅ ~1KB. NO PROVIDER NEEDED (the store lives outside React).
//   ✅ Almost no boilerplate: the store is just a function returning state
//      and the functions that change it.
//   ✅ Callable from OUTSIDE React (useTaskStore.getState()) — genuinely
//      useful in an axios interceptor or a websocket handler, where you
//      have no hooks available.
//   ❌ Less structure, so a large team can drift into inconsistent
//      patterns. Devtools are decent but not Redux-grade.
//
//   ⭐ MY ACTUAL RECOMMENDATION, and the shape of a good answer:
//   First ask "is this SERVER state or CLIENT state?" Most of what people
//   put in Redux is server state — data that lives in a database and is
//   cached in the browser. React Query / RTK Query handle that FAR better
//   (caching, refetching, invalidation, dedup). Once you remove server
//   state, what is genuinely left is small: UI state, filters, a wizard's
//   progress, an auth session. For that: Context for rarely-changing
//   values, Zustand for anything updating frequently, Redux when you need
//   its devtools/middleware ecosystem or the team structure.
//   ⭐ That reframing — "you probably don't need a global store, you need
//   a server-cache library" — is the answer that stands out.
//
// HOW IT WORKS HERE: this store manages exactly the same task state as
//   src/context/TaskContext.jsx. Run both pages side by side and compare.
// ============================================================

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

// ============================================================
// 🧠 CONCEPT: The store lives OUTSIDE the React tree
// WHY IT MATTERS (interview angle): note the absence of a <Provider>.
//   `create()` builds a store in module scope; components subscribe to it
//   with a hook. Consequences:
//   ✅ No provider nesting, and no "must be used within a Provider" errors.
//   ✅ You can read and write it from non-React code —
//      `useTaskStore.getState().reset()` works in an axios interceptor.
//   ⚠️ But it is a MODULE SINGLETON. In SSR that is a real problem: the
//      store is shared across all concurrent requests on the server, so
//      one user's data can leak into another's render. SSR needs a
//      per-request store (which means... a provider after all). Context
//      does not have this problem, because it is created per tree.
// ============================================================
const useTaskStore = create(
  // devtools middleware wires into the Redux DevTools browser extension —
  // you get the same action log and time travel without Redux itself.
  devtools(
    (set, get) => ({
      // ---- STATE ----
      tasks: [],
      pagination: null,
      status: 'idle',
      error: null,
      selectedId: null,
      filter: { status: '', search: '' },

      // ---- ACTIONS ----
      // ============================================================
      // 🧠 CONCEPT: set() merges shallowly by default
      // WHY IT MATTERS (interview angle): `set({ status: 'loading' })` does
      //   NOT replace the whole state — Zustand shallow-merges it, so the
      //   other fields are preserved. That is why there is no `...state`
      //   spread, unlike a Redux reducer. Note it is a SHALLOW merge: to
      //   update a nested object you still spread it yourself, as
      //   setFilter does below.
      // ============================================================
      fetchTasks: async (params = {}) => {
        set({ status: 'loading', error: null }, false, 'tasks/fetchStart');
        try {
          const res = await axiosClient.get('/tasks', { params });
          set(
            { tasks: res.data.data, pagination: res.data.pagination, status: 'success' },
            false,
            'tasks/fetchSuccess' // the third arg names the action in devtools
          );
        } catch (err) {
          set({ status: 'error', error: extractErrorMessage(err) }, false, 'tasks/fetchError');
        }
      },

      createTask: async (payload) => {
        try {
          const res = await axiosClient.post('/tasks', payload);
          // ⚠️ Use the FUNCTIONAL form when the next state depends on the
          // current one. Reading `get().tasks` and then setting it works,
          // but the functional form is atomic and avoids a stale read if
          // two updates race.
          set((state) => ({ tasks: [res.data.data, ...state.tasks] }), false, 'tasks/create');
          return { ok: true };
        } catch (err) {
          return { ok: false, error: extractErrorMessage(err) };
        }
      },

      updateTask: async (id, payload) => {
        try {
          const res = await axiosClient.patch(`/tasks/${id}`, payload);
          set(
            (state) => ({
              tasks: state.tasks.map((t) => ((t.id || t._id) === id ? res.data.data : t)),
            }),
            false,
            'tasks/update'
          );
          return { ok: true };
        } catch (err) {
          return { ok: false, error: extractErrorMessage(err) };
        }
      },

      deleteTask: async (id) => {
        // The same optimistic-update-with-rollback pattern as TaskContext.
        const snapshot = get().tasks;
        set((state) => ({ tasks: state.tasks.filter((t) => (t.id || t._id) !== id) }), false, 'tasks/deleteOptimistic');

        try {
          await axiosClient.delete(`/tasks/${id}`);
          return { ok: true };
        } catch (err) {
          set({ tasks: snapshot }, false, 'tasks/deleteRollback');
          return { ok: false, error: extractErrorMessage(err) };
        }
      },

      setFilter: (patch) =>
        set((state) => ({ filter: { ...state.filter, ...patch } }), false, 'tasks/setFilter'),

      select: (id) => set({ selectedId: id }, false, 'tasks/select'),

      reset: () => set({ tasks: [], pagination: null, status: 'idle', error: null }, false, 'tasks/reset'),
    }),
    { name: 'TaskStore' }
  )
);

// ============================================================
// 🧠 CONCEPT: SELECTORS — the actual performance advantage
// WHY IT MATTERS (interview angle): this is the mechanism that Context
//   lacks, and being able to state it precisely is the point.
//
//   ❌ const { tasks, status, error, filter } = useTaskStore();
//      With no selector, the component subscribes to the WHOLE store and
//      re-renders on ANY change — exactly Context's behaviour.
//
//   ✅ const count = useTaskStore(s => s.tasks.length);
//      This component re-renders ONLY when tasks.length changes. Change
//      the `filter` and it does not re-render at all. Zustand runs the
//      selector after each update and compares the RESULT with Object.is.
//
//   ⚠️ THE CLASSIC ZUSTAND FOOTGUN: a selector returning a NEW OBJECT
//      every time.
//        ❌ useTaskStore(s => ({ tasks: s.tasks, status: s.status }))
//      That object literal is a new reference on every store change, so
//      Object.is always says "different" and you re-render constantly —
//      worse than no selector. THE FIX: either select primitives with
//      separate calls (simplest and usually best), or pass a shallow
//      equality comparator as the second argument.
//
// HOW IT WORKS HERE: exported selector hooks so components subscribe to
//   the narrowest slice they need.
// ============================================================
export const useTaskList = () => useTaskStore((s) => s.tasks);
export const useTaskStatus = () => useTaskStore((s) => s.status);
export const useTaskError = () => useTaskStore((s) => s.error);

// A DERIVED value. Because it resolves to a number, the component using it
// re-renders only when that number changes — not when a task's title is
// edited. That is granular subscription in one line.
export const useTaskCount = () => useTaskStore((s) => s.tasks.length);
export const useCompletedCount = () => useTaskStore((s) => s.tasks.filter((t) => t.status === 'done').length);

// Actions never change identity, so selecting them individually gives a
// component a stable reference that never triggers a re-render.
export const useTaskActions = () =>
  useTaskStore((s) => ({
    fetchTasks: s.fetchTasks,
    createTask: s.createTask,
    updateTask: s.updateTask,
    deleteTask: s.deleteTask,
  }));

export default useTaskStore;
