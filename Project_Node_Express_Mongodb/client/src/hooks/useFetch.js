// ============================================================
// 🧠 CONCEPT: A hand-rolled data-fetching hook — and the RACE CONDITION
// WHY IT MATTERS (interview angle): almost everyone writes a useFetch at
//   some point, and almost every first version has a race condition. Being
//   able to explain the bug AND both fixes is a strong signal.
//
//   ❌ THE BUGGY VERSION EVERYONE WRITES FIRST:
//
//     useEffect(() => {
//       setLoading(true);
//       axios.get(url).then(res => {
//         setData(res.data);        // <-- the bug lives here
//         setLoading(false);
//       });
//     }, [url]);
//
//   ⭐ THE RACE: the user types "a", then quickly "ab".
//     t=0ms    request("a")  starts
//     t=50ms   request("ab") starts
//     t=100ms  request("ab") RESOLVES -> setData(results for "ab")  ✅
//     t=300ms  request("a")  RESOLVES -> setData(results for "a")   ❌
//
//   The SLOWER, OLDER request finishes LAST and overwrites the correct
//   data. The input says "ab" and the list shows results for "a".
//
//   It is intermittent, it depends on network timing, and it almost never
//   reproduces on localhost — which is exactly why it reaches production.
//
//   ✅ FIX 1 — THE IGNORE FLAG (what the cleanup does below). A local
//      boolean captured by the effect's closure. The cleanup sets it to
//      true, so a response arriving after the effect re-ran is discarded.
//      Simple, works for any async operation, and does not require the
//      request itself to be cancellable.
//
//   ✅ FIX 2 — AbortController (also implemented below). Genuinely
//      CANCELS the HTTP request, so the browser stops waiting and the
//      server can stop caring. Strictly better where supported, because it
//      also saves bandwidth. Use both: abort the request AND guard the
//      state update.
//
//   ⚠️ NOTE: this is also why calling setState after unmount used to warn.
//      React 18 removed the warning, but the underlying waste — holding a
//      dead component's closure alive — is still real.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

export function useFetch(url, { params = null, skip = false, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(!skip);
  const [durationMs, setDurationMs] = useState(null);

  // A counter used to force a refetch on demand.
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  // ============================================================
  // 🧠 CONCEPT: Serialising params to keep the dep array stable
  // WHY IT MATTERS (interview angle): `params` is usually an object
  //   literal created inline by the caller, so it is a NEW REFERENCE on
  //   every render. Put it directly in a dependency array and the effect
  //   re-runs every render -> fetch -> setState -> render -> fetch...
  //   AN INFINITE REQUEST LOOP. It is one of the most common React bugs,
  //   and it usually presents as "why is my API being called 400 times?"
  //   Serialising to a string gives a value that compares by CONTENT.
  // ============================================================
  const paramsKey = JSON.stringify(params ?? {});

  useEffect(() => {
    if (skip) {
      setIsLoading(false);
      return undefined;
    }

    // ✅ FIX 1: the ignore flag, scoped to THIS run of the effect.
    let ignore = false;

    // ✅ FIX 2: a real cancellation token.
    const controller = new AbortController();

    async function run() {
      setIsLoading(true);
      setError(null);
      const startedAt = performance.now();

      try {
        const res = await axiosClient.get(url, {
          params: params ?? undefined,
          signal: controller.signal, // axios forwards this to the adapter
        });

        // ⭐ THE GUARD. If the effect has already re-run (the user typed
        // again), `ignore` is true and we throw this stale response away
        // instead of stomping on newer data.
        if (ignore) return;

        setData(res.data);
        setDurationMs(Math.round(performance.now() - startedAt));
      } catch (err) {
        // An aborted request is not an error — it is us cancelling on
        // purpose. Showing "Error: canceled" to the user would be wrong.
        if (ignore || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        setError(extractErrorMessage(err));
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }

    run();

    // ============================================================
    // 🧠 CONCEPT: Cleanup runs BEFORE the next effect, and on unmount
    // WHY IT MATTERS (interview angle): both lines matter and they do
    //   different jobs. `ignore = true` protects the STATE (a late
    //   response can no longer call setData). `controller.abort()` cancels
    //   the NETWORK REQUEST (saving bandwidth and server work). The first
    //   guarantees correctness; the second is the efficiency win.
    // ============================================================
    return () => {
      ignore = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, paramsKey, skip, reloadToken, ...deps]);

  return { data, error, isLoading, refetch, durationMs };
}

// ============================================================
// 🧠 CONCEPT: What this hook STILL does not do
// WHY IT MATTERS (interview angle): having fixed the race condition, be
//   honest about the remaining gaps — it is the argument for React Query:
//
//   ❌ NO CACHE. Navigate away and back: full refetch, spinner, blank
//      screen, for data you had a moment ago.
//   ❌ NO DEDUPLICATION. Three components calling useFetch('/tasks') make
//      three identical simultaneous requests.
//   ❌ NO BACKGROUND REVALIDATION. Data silently goes stale.
//   ❌ NO RETRY on a transient network blip.
//   ❌ NO "stale-while-revalidate" — you cannot show cached data instantly
//      while refreshing behind the scenes.
//   ❌ NO shared state between components — each has its own copy, and
//      they can disagree.
//   ❌ NO refetch on window focus / reconnect.
//   ❌ NO pagination or infinite-scroll primitives.
//
//   Every one of those is a solved problem in React Query / SWR / RTK
//   Query. See src/pages/ReactQueryPage.jsx, which fetches the SAME data
//   in about a third of the code.
//
//   ⭐ THE PRINCIPLE: SERVER STATE IS NOT CLIENT STATE. Server state is
//   asynchronous, shared, owned by someone else, and can go stale without
//   you doing anything. Treating it like local state (useState + useEffect)
//   is what creates all of the above. That framing is the strongest version
//   of this answer.
// ============================================================

export default useFetch;
