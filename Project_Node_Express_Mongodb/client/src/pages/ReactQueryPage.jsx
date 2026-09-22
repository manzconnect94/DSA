// ============================================================
// 🧠 CONCEPT: React Query — the SAME data as TasksPage, far less code
// WHY IT MATTERS (interview angle): put this file next to TasksPage.jsx +
//   TaskContext.jsx + useFetch.js. Those three files hand-roll loading
//   state, error state, a reducer, race-condition guards and optimistic
//   updates. This one file does all of it, plus caching, in ~40 lines of
//   actual logic.
//
//   ⭐ THE FRAMING THAT MATTERS — SERVER STATE vs CLIENT STATE:
//
//   CLIENT STATE: owned by your app. Synchronous. You are the only writer.
//     "Is the sidebar open?", "what's in this form?", "which tab is
//     active?". useState / Context / Zustand are correct here.
//
//   SERVER STATE: owned by a database somewhere else. It is:
//     • ASYNCHRONOUS — loading and error states are unavoidable.
//     • SHARED — other users change it without telling you.
//     • POTENTIALLY STALE THE INSTANT YOU RECEIVE IT.
//     • Needs caching, deduplication, revalidation, retries.
//
//   ⭐ The core insight: MOST OF WHAT PEOPLE PUT IN REDUX IS SERVER STATE,
//   and a general-purpose state container is the wrong tool for it. You
//   end up hand-writing a cache with none of the hard parts solved.
//   React Query is a CACHE, not a state manager — and once server state
//   moves there, the amount of genuinely global client state left is
//   usually small enough that Context or Zustand is plenty.
//   Saying this is the strongest available answer to "Redux or Context?".
//
//   WHAT YOU GET FOR FREE HERE:
//   ✅ Caching keyed by queryKey
//   ✅ Deduplication — 3 components, same key, ONE request
//   ✅ Background refetching (stale-while-revalidate)
//   ✅ Refetch on window focus and on network reconnect
//   ✅ Automatic retry with exponential backoff
//   ✅ Race conditions handled (responses for stale keys are discarded)
//   ✅ Loading / error / fetching states maintained for you
//   ✅ Optimistic updates with automatic rollback
//   ✅ Garbage collection of unused cache entries
// ============================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';
import { useDebounce } from '../hooks/useDebounce';
import TaskForm from '../components/TaskForm';
import TaskList from '../components/TaskList';

async function fetchTasks({ queryKey }) {
  const [, params] = queryKey;
  const res = await axiosClient.get('/tasks', { params });
  return res.data;
}

export default function ReactQueryPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 400);

  const queryClient = useQueryClient();

  const params = { page, limit: 20, ...(debouncedSearch ? { search: debouncedSearch } : {}) };

  // ============================================================
  // 🧠 CONCEPT: The queryKey IS the cache key
  // WHY IT MATTERS (interview angle): the most important concept in React
  //   Query. The key is a serialisable array that uniquely identifies this
  //   data. Everything follows from it:
  //   • Change the key -> a different cache entry -> a fetch.
  //   • Same key in ten components -> ONE request, ten subscribers.
  //   • Invalidating a key marks it stale and triggers a refetch.
  //   • Keys are HIERARCHICAL: invalidating ['tasks'] invalidates
  //     ['tasks', {page:1}] and ['tasks', {page:2}] too, because matching
  //     is by prefix. That is how one mutation refreshes every page.
  //   ⚠️ Every value the query depends on MUST be in the key. Omit `page`
  //   and page 2 would serve page 1's cached data — the same class of bug
  //   as an incomplete server-side cache key (see utils/cache.js).
  // ============================================================
  const {
    data,
    error,
    isLoading, // true only on the FIRST load with no cached data
    isFetching, // true on ANY fetch, including a background refetch
    isPlaceholderData,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['tasks', params],
    queryFn: fetchTasks,

    // ============================================================
    // 🧠 CONCEPT: staleTime vs gcTime — the two timers people confuse
    // WHY IT MATTERS (interview angle):
    //   • staleTime — how long the data is considered FRESH. While fresh,
    //     React Query will NOT refetch, even on remount or window focus.
    //     Default is 0, meaning data is stale immediately, which is why
    //     newcomers see "it refetches constantly".
    //   • gcTime (formerly cacheTime) — how long an UNUSED cache entry is
    //     kept in memory after the last component using it unmounts.
    //     Default 5 minutes. This is what makes going back to a page
    //     instant.
    //   They are independent: data can be STALE but still CACHED. That
    //   combination is what enables stale-while-revalidate — show the
    //   stale data instantly, refetch in the background, swap it in.
    // ============================================================
    staleTime: 30_000, // fresh for 30s — no refetch during that window
    gcTime: 5 * 60_000, // keep unused data for 5 minutes

    // ============================================================
    // 🧠 CONCEPT: placeholderData: keepPreviousData
    // WHY IT MATTERS (interview angle): a big UX win for pagination.
    //   Without it, clicking "next page" blanks the list and shows a
    //   spinner — the whole layout jumps. With it, the PREVIOUS page stays
    //   on screen (flagged via isPlaceholderData) until the new one
    //   arrives. No layout shift, no flicker.
    // ============================================================
    placeholderData: keepPreviousData,

    // ============================================================
    // 🧠 CONCEPT: Automatic retry with exponential backoff
    // WHY IT MATTERS (interview angle): a transient network blip should
    //   not surface as an error. React Query retries 3 times by default,
    //   backing off exponentially. ⚠️ But retrying a 404 or a 403 is
    //   pointless — those will never succeed — so we only retry 5xx and
    //   network failures. Blindly retrying 4xx wastes requests and can
    //   trip your own rate limiter.
    // ============================================================
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),

    // Refetch when the user comes back to the tab. Great for dashboards
    // left open all day; turn it off for data that must not change under
    // the user's cursor.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // ============================================================
  // 🧠 CONCEPT: useMutation — writes, and cache invalidation
  // WHY IT MATTERS (interview angle): useQuery is for reads; useMutation
  //   is for writes. The important part is `onSuccess`: after a write, you
  //   INVALIDATE the affected query keys, and React Query refetches them.
  //   That is the client-side mirror of the server-side cache invalidation
  //   in utils/cache.js — the exact same problem ("my write isn't visible")
  //   solved at a different layer.
  // ============================================================
  const createMutation = useMutation({
    mutationFn: (payload) => axiosClient.post('/tasks', payload).then((r) => r.data.data),
    onSuccess: () => {
      // Prefix matching: this invalidates EVERY ['tasks', ...] entry, so
      // whichever page/filter the user visits next is refetched.
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // ============================================================
  // 🧠 CONCEPT: OPTIMISTIC UPDATES with automatic rollback
  // WHY IT MATTERS (interview angle): compare this with the hand-rolled
  //   version in TaskContext.jsx. There, we manually snapshot the task and
  //   manually re-add it on failure. Here the pattern is formalised:
  //     onMutate  — cancel in-flight refetches, snapshot, apply optimistically
  //     onError   — restore the snapshot
  //     onSettled — refetch to reconcile with the server's truth
  //   ⚠️ `cancelQueries` in onMutate is the subtle, essential bit: without
  //   it, an in-flight refetch can land AFTER your optimistic update and
  //   overwrite it with pre-mutation data, making the change appear to
  //   revert itself.
  // ============================================================
  const deleteMutation = useMutation({
    mutationFn: (id) => axiosClient.delete(`/tasks/${id}`),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });

      const previous = queryClient.getQueryData(['tasks', params]);

      queryClient.setQueryData(['tasks', params], (old) =>
        old ? { ...old, data: old.data.filter((t) => (t.id || t._id) !== id) } : old
      );

      // Whatever is returned here becomes `context` in onError.
      return { previous };
    },

    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['tasks', params], context.previous);
      }
    },

    onSettled: () => {
      // Runs on success AND failure — reconcile with the server either way.
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }) => axiosClient.patch(`/tasks/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <div className="page">
      <h1>Tasks — React Query</h1>
      <p className="subtitle">
        The same data as the Tasks page, but cached. Compare the network tab: navigate away and back, and this page
        renders <strong>instantly from cache</strong> while revalidating in the background.
      </p>

      {/* ============================================================
          🧠 CONCEPT: isLoading vs isFetching — a genuinely useful distinction
          WHY IT MATTERS (interview angle): a frequent point of confusion.
            • isLoading  — there is NO data yet. Show a skeleton/spinner.
            • isFetching — a request is in flight, but you MAY already have
              cached data to display. Show a subtle indicator, NOT a
              full-page spinner.
            Using isFetching for the main loading state is what causes the
            "it flashes a spinner every time I focus the tab" complaint.
          ============================================================ */}
      <div className="perf-bar">
        {isLoading && <span className="pill">⏳ first load (no cached data)</span>}
        {isFetching && !isLoading && <span className="pill">⟳ background revalidation (cached data shown)</span>}
        {isPlaceholderData && <span className="pill">showing previous page while loading</span>}
        {dataUpdatedAt > 0 && <span>last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}</span>}
        <button type="button" onClick={() => refetch()}>
          Manual refetch
        </button>
      </div>

      <TaskForm
        onSubmit={async (payload) => {
          try {
            await createMutation.mutateAsync(payload);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: extractErrorMessage(err) };
          }
        }}
        isSubmitting={createMutation.isPending}
      />

      <div className="filters">
        <input
          type="search"
          placeholder="Search… (debounced, then cached per search term)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <small className="hint">
          Search for something, clear it, then search the same thing again — the second time is instant, because that
          queryKey is still cached.
        </small>
      </div>

      {error && <p className="form-error">{extractErrorMessage(error)}</p>}

      <TaskList
        tasks={data?.data ?? []}
        isLoading={isLoading}
        onToggle={(id, status) => updateMutation.mutate({ id, patch: { status } })}
        onDelete={(id) => deleteMutation.mutate(id)}
      />

      {data?.pagination && (
        <div className="pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button type="button" disabled={!data.pagination.hasMore} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}

      <details className="concept-note">
        <summary>Line-count comparison</summary>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Manual (Context + useEffect)</th>
              <th>React Query</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Loading / error state</td>
              <td>A reducer with 5 action types</td>
              <td>Free</td>
            </tr>
            <tr>
              <td>Caching</td>
              <td>❌ none</td>
              <td>Free</td>
            </tr>
            <tr>
              <td>Request deduplication</td>
              <td>❌ none</td>
              <td>Free</td>
            </tr>
            <tr>
              <td>Race conditions</td>
              <td>Manual ignore-flag + AbortController</td>
              <td>Free</td>
            </tr>
            <tr>
              <td>Retry with backoff</td>
              <td>❌ none</td>
              <td>Free (configurable)</td>
            </tr>
            <tr>
              <td>Refetch on focus / reconnect</td>
              <td>❌ none</td>
              <td>Free</td>
            </tr>
            <tr>
              <td>Optimistic update + rollback</td>
              <td>Hand-written snapshot logic</td>
              <td>A standard 3-callback pattern</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}
