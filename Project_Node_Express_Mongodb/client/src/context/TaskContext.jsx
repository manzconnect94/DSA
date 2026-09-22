// ============================================================
// 🧠 CONCEPT: useReducer for related state (vs several useStates)
// WHY IT MATTERS (interview angle): "when would you use useReducer over
//   useState?" The answer is about whether pieces of state CHANGE TOGETHER.
//
//   ❌ With separate useStates, one fetch touches four of them:
//       setLoading(true); setError(null); setTasks(data); setLoading(false);
//     Four state updates, four chances to forget one, and it is possible to
//     reach an IMPOSSIBLE STATE (loading: true AND error: set AND data
//     present) because nothing enforces consistency.
//
//   ✅ With useReducer, one dispatch describes one EVENT and the reducer
//     computes the whole next state atomically:
//       dispatch({ type: 'FETCH_SUCCESS', payload: data })
//     Impossible states become unrepresentable, and the transition logic is
//     a pure function you can unit test with zero React involved.
//
//   USE useReducer WHEN: the next state depends on the previous one;
//   several fields update together; the logic is complex enough to be worth
//   testing on its own; or you want to pass a stable `dispatch` down instead
//   of a dozen callbacks (dispatch identity is guaranteed stable by React,
//   so it never needs useCallback).
//
//   ⭐ And note: useReducer IS Redux's core idea — (state, action) => state
//   — built into React. Which raises the obvious question, answered in
//   src/store/taskStore.js: if React has this, why add Redux?
// ============================================================

import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

const TaskContext = createContext(null);

const initialState = {
  tasks: [],
  pagination: null,
  status: 'idle', // 'idle' | 'loading' | 'success' | 'error'
  error: null,
  lastQueryMs: null,
  wasCached: false,
};

// ============================================================
// 🧠 CONCEPT: The reducer is a PURE function
// WHY IT MATTERS (interview angle): (state, action) => newState, with no
//   side effects, no API calls, no Date.now(), no mutation. Two payoffs:
//   • TESTABILITY — call it with a state and an action, assert on the
//     result. No React, no rendering, no mocks. Milliseconds.
//   • PREDICTABILITY — the same state plus the same action always yields
//     the same result, which is what makes time-travel debugging and
//     action replay possible in Redux DevTools.
//   ⚠️ NEVER MUTATE: `state.tasks.push(x); return state;` returns the SAME
//   object reference, so React's Object.is check sees no change and skips
//   the re-render. Your data updated and the screen didn't. Always return a
//   NEW object/array.
// ============================================================
function taskReducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      // Note: we deliberately KEEP the old tasks visible while refetching,
      // rather than blanking the list. That avoids a jarring flash of empty
      // state on every filter change ("stale-while-revalidate" by hand —
      // and note React Query gives you this for free, see ReactQueryPage).
      return { ...state, status: 'loading', error: null };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        status: 'success',
        tasks: action.payload.data,
        pagination: action.payload.pagination,
        lastQueryMs: action.payload.pagination?.queryTimeMs ?? null,
        wasCached: Boolean(action.payload.pagination?.cached),
        error: null,
      };

    case 'FETCH_ERROR':
      return { ...state, status: 'error', error: action.payload };

    case 'ADD_TASK':
      // New array, new object references at the top level.
      return { ...state, tasks: [action.payload, ...state.tasks] };

    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.payload.id || t._id === action.payload.id ? action.payload : t)),
      };

    case 'REMOVE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => (t.id || t._id) !== action.payload) };

    default:
      // Throwing on an unknown action catches typos immediately, rather
      // than silently doing nothing and leaving you debugging the UI.
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

export function TaskProvider({ children }) {
  const [state, dispatch] = useReducer(taskReducer, initialState);

  // ============================================================
  // 🧠 CONCEPT: Data fetching in useEffect — the "manual" way
  // WHY IT MATTERS (interview angle): this is the pattern everyone writes
  //   first, and you should be able to list what it does NOT give you,
  //   because that list IS the argument for React Query:
  //
  //   ❌ NO CACHING — navigate away and back and it refetches from scratch,
  //      showing a spinner for data you had two seconds ago.
  //   ❌ NO DEDUPLICATION — three components needing the same data fire
  //      three identical requests.
  //   ❌ RACE CONDITIONS — type "ab" quickly: request("a") and request("ab")
  //      are both in flight. If "a" resolves SECOND (slower network, larger
  //      result), you render results for "a" while the input shows "ab".
  //      The fix is an AbortController or an ignore-flag in the cleanup —
  //      see useFetch.js, where it is implemented.
  //   ❌ NO BACKGROUND REFETCH — data goes stale and stays stale until the
  //      user manually reloads.
  //   ❌ NO RETRY on transient network failure.
  //   ❌ MANUAL loading/error state, hand-written in every single hook.
  //
  //   Compare directly with src/pages/ReactQueryPage.jsx, which fetches the
  //   same data and gets every one of those for free.
  // ============================================================
  const fetchTasks = useCallback(async (params = {}) => {
    dispatch({ type: 'FETCH_START' });
    try {
      const res = await axiosClient.get('/tasks', { params });
      dispatch({ type: 'FETCH_SUCCESS', payload: res.data });
      return res.data;
    } catch (err) {
      dispatch({ type: 'FETCH_ERROR', payload: extractErrorMessage(err) });
      return null;
    }
  }, []);

  const createTask = useCallback(async (payload) => {
    try {
      const res = await axiosClient.post('/tasks', payload);
      dispatch({ type: 'ADD_TASK', payload: res.data.data });
      return { ok: true, task: res.data.data };
    } catch (err) {
      return { ok: false, error: extractErrorMessage(err) };
    }
  }, []);

  const updateTask = useCallback(async (id, payload) => {
    try {
      const res = await axiosClient.patch(`/tasks/${id}`, payload);
      dispatch({ type: 'UPDATE_TASK', payload: res.data.data });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: extractErrorMessage(err) };
    }
  }, []);

  // ============================================================
  // 🧠 CONCEPT: OPTIMISTIC UPDATES
  // WHY IT MATTERS (interview angle): update the UI IMMEDIATELY, assuming
  //   the server will succeed, then roll back if it doesn't. The app feels
  //   instant instead of showing a 200ms spinner for an action that almost
  //   always works.
  //   ⚠️ THE COST: you must be able to ROLL BACK. Here we snapshot the
  //   task before removing it and re-add it on failure. Get that wrong and
  //   a failed delete makes the row vanish permanently until a reload —
  //   the user believes it was deleted when it wasn't.
  //   WHEN IT'S APPROPRIATE: high-success-rate, low-stakes, easily
  //   reversible actions (toggling a checkbox, liking a post, deleting a
  //   task). NOT for payments, or anything where a wrong intermediate state
  //   would mislead the user into acting on it.
  // ============================================================
  const deleteTask = useCallback(
    async (id) => {
      const snapshot = state.tasks.find((t) => (t.id || t._id) === id);

      dispatch({ type: 'REMOVE_TASK', payload: id }); // optimistic

      try {
        await axiosClient.delete(`/tasks/${id}`);
        return { ok: true };
      } catch (err) {
        // ROLL BACK: put it back exactly as it was.
        if (snapshot) dispatch({ type: 'ADD_TASK', payload: snapshot });
        return { ok: false, error: extractErrorMessage(err) };
      }
    },
    [state.tasks]
  );

  const value = useMemo(
    () => ({ ...state, fetchTasks, createTask, updateTask, deleteTask }),
    [state, fetchTasks, createTask, updateTask, deleteTask]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (context === null) {
    throw new Error('useTasks must be used inside a <TaskProvider>');
  }
  return context;
}

export { taskReducer, initialState };
export default TaskContext;
