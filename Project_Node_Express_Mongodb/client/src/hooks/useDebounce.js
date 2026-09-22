// ============================================================
// 🧠 CONCEPT: useDebounce — a custom hook, and useEffect CLEANUP
// WHY IT MATTERS (interview angle): debouncing a search box is the
//   canonical custom-hook example AND the clearest demonstration of why
//   useEffect returns a cleanup function.
//
//   THE PROBLEM: a user types "backend" — 7 keystrokes. Without
//   debouncing, that is 7 API calls in under a second. Six of them are
//   already obsolete before they return, and each one runs a regex query
//   against your database (an unindexed COLLSCAN, per the search comment
//   in server/controllers/taskController.js). You have multiplied your
//   database load by 7 to display one result set.
//
//   THE SOLUTION: wait until the user STOPS typing for 400ms, then fire
//   once. 7 requests become 1.
//
//   ⭐ DEBOUNCE vs THROTTLE — they get confused constantly:
//   • DEBOUNCE — wait for a PAUSE in events, then act. Each new event
//     RESETS the timer. If events never stop, it NEVER fires.
//     Use for: search-as-you-type, autosave, window-resize-then-recalculate,
//     validating a field after typing stops.
//   • THROTTLE — act at most once per N ms, GUARANTEED, regardless of how
//     many events arrive.
//     Use for: scroll handlers (you need periodic updates while scrolling,
//     not just at the end), mousemove, rate-limiting a button.
//   One-liner: debounce = "tell me when they're done"; throttle = "tell me
//   at most every N ms".
//
// HOW IT WORKS HERE: a value-based debounce (debouncing the VALUE, not the
//   callback), which composes better with React's render model.
// ============================================================

import { useState, useEffect } from 'react';

export function useDebounce(value, delayMs = 400) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    // Schedule the update.
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    // ============================================================
    // 🧠 CONCEPT: ⭐ THE CLEANUP FUNCTION — the heart of this hook
    // WHY IT MATTERS (interview angle): the function you RETURN from
    //   useEffect runs (a) before the effect re-runs, and (b) when the
    //   component unmounts.
    //
    //   FOLLOW THE SEQUENCE, because this is the whole trick:
    //     keystroke "b"  -> effect runs, schedules a timer for 400ms
    //     keystroke "ba" -> `value` changed, so React first runs CLEANUP
    //                       (clearing the "b" timer), THEN runs the effect
    //                       again with a fresh timer
    //     keystroke "bac"-> cleanup cancels "ba", new timer for "bac"
    //     ...user stops typing...
    //     400ms later    -> the surviving timer fires exactly ONCE
    //
    //   Remove `clearTimeout` and every keystroke's timer survives: all 7
    //   fire, 400ms apart, and you have added latency without removing a
    //   single request. The cleanup IS the debounce.
    //
    //   ⚠️ WHY CLEANUP MATTERS GENERALLY — it prevents MEMORY LEAKS. Any
    //   effect that creates something long-lived must dispose of it:
    //     • setTimeout / setInterval    -> clearTimeout / clearInterval
    //     • addEventListener            -> removeEventListener
    //     • a WebSocket or subscription -> close / unsubscribe
    //     • an in-flight fetch          -> AbortController.abort()
    //   Without cleanup, an unmounted component's callback still fires,
    //   still holds a reference to that component's closure (so it is never
    //   garbage collected), and may call setState on something that no
    //   longer exists.
    // ============================================================
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

// ============================================================
// 🧠 CONCEPT: The throttle sibling, for contrast
// WHY IT MATTERS (interview angle): having both side by side makes the
//   difference concrete. This one fires on a fixed schedule while events
//   keep arriving; the debounce above fires only after they stop.
// ============================================================
export function useThrottle(value, intervalMs = 200) {
  const [throttledValue, setThrottledValue] = useState(value);
  const [lastRun, setLastRun] = useState(Date.now());

  useEffect(() => {
    const elapsed = Date.now() - lastRun;

    if (elapsed >= intervalMs) {
      // Enough time has passed — update immediately.
      setThrottledValue(value);
      setLastRun(Date.now());
      return undefined;
    }

    // Otherwise schedule the update for when the interval completes.
    const timer = setTimeout(() => {
      setThrottledValue(value);
      setLastRun(Date.now());
    }, intervalMs - elapsed);

    return () => clearTimeout(timer);
  }, [value, intervalMs, lastRun]);

  return throttledValue;
}

export default useDebounce;
