// ============================================================
// 🧠 CONCEPT: Context API — solving PROP DRILLING
// WHY IT MATTERS (interview angle): the problem Context exists to solve,
//   stated precisely:
//
//   ❌ PROP DRILLING — the current user is needed by <Navbar>, which is 4
//      levels below <App>. Without Context you pass `user` through
//      <Layout>, <Header> and <Nav>, none of which USE it. Those three
//      components now have a prop they don't care about, they all
//      re-render when it changes, and they cannot be reused elsewhere
//      without supplying it. Add a second such value and it compounds.
//
//   ✅ CONTEXT — a Provider publishes a value, and ANY descendant at any
//      depth reads it directly with useContext. The intermediate
//      components never see it.
//
//   ⚠️⚠️ THE LIMITATION — ASK THIS BEFORE THEY DO:
//   When a Context value changes, EVERY component consuming that context
//   re-renders. Not just the ones using the part that changed — ALL of
//   them. React.memo does NOT help, because useContext subscribes the
//   component directly; memo only compares props.
//
//   So a single "AppContext" holding user + theme + tasks + notifications
//   means a keystroke in a search box re-renders your entire app. This is
//   THE reason people reach for Redux/Zustand, and the reason is
//   specifically about RE-RENDER GRANULARITY, not about Context being
//   "not a real state manager".
//
//   MITIGATIONS, in order of preference:
//   1. SPLIT CONTEXTS by change frequency — a rarely-changing AuthContext
//      separate from a frequently-changing TaskContext. (Done in this app.)
//   2. Split STATE from DISPATCH into two contexts: components that only
//      dispatch actions never re-render when the state changes.
//   3. useMemo the provider value so an unchanged value doesn't create a
//      new object identity on every parent render. (Done below.)
//   4. Use a store with SELECTORS (Zustand/Redux) when you genuinely need
//      per-field subscriptions. See src/store/taskStore.js.
//
// HOW IT WORKS HERE: AuthContext holds the user + access token. It changes
//   rarely (login, logout, refresh), which makes it a GOOD Context fit.
// ============================================================

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axiosClient, {
  setAccessToken,
  clearAccessToken,
  registerAuthFailureHandler,
  extractErrorMessage,
} from '../api/axiosClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // true until the boot refresh settles
  const [error, setError] = useState(null);

  // ============================================================
  // 🧠 CONCEPT: useRef to "persist a value WITHOUT causing a re-render"
  // WHY IT MATTERS (interview angle): the second, less-known use of useRef
  //   (the first is DOM access — see TaskForm.jsx). A ref is a mutable box
  //   whose `.current` survives re-renders but does NOT trigger one when
  //   changed. Compare:
  //     • useState — changing it RE-RENDERS. For data the UI displays.
  //     • useRef   — changing it does NOT re-render. For data the RENDER
  //                  DOESN'T DEPEND ON: timer ids, previous values,
  //                  "has this already run?" flags, subscription handles.
  //     • a plain local variable — RESET on every render. Useless for this.
  //   Here we guard React 18 StrictMode's deliberate double-invocation of
  //   effects in development: without the flag, the boot refresh fires
  //   twice, and with refresh-token ROTATION the second call presents an
  //   already-rotated token -> reuse detected -> instant logout. That is a
  //   real bug people hit and blame on StrictMode.
  // ============================================================
  const bootstrapAttempted = useRef(false);

  // ============================================================
  // 🧠 CONCEPT: useEffect with an EMPTY dependency array
  // WHY IT MATTERS (interview angle): the direct hooks equivalent of
  //   componentDidMount — it runs ONCE after the first render.
  //
  //   ⭐ THE CLASS-TO-HOOKS MAPPING interviewers still ask for:
  //     componentDidMount        -> useEffect(fn, [])
  //     componentDidUpdate       -> useEffect(fn, [dep])  (runs when dep changes)
  //     componentWillUnmount     -> the RETURNED cleanup function
  //     all three at once        -> useEffect(fn)          (no dep array)
  //
  //   ⚠️ But the mapping is a teaching aid, not an equivalence. The real
  //   mental model is different and better: an effect SYNCHRONISES your
  //   component with an external system, and the dependency array says
  //   "re-synchronise when these change". Thinking in lifecycle terms is
  //   what leads to the classic bugs — a stale closure capturing an old
  //   value, or a missing dependency because "I only want this on mount".
  // ============================================================
  useEffect(() => {
    if (bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;

    // ============================================================
    // 🧠 CONCEPT: Silent re-authentication on page load
    // WHY IT MATTERS (interview angle): the access token lived in memory,
    //   so a page refresh destroyed it. But the httpOnly refresh cookie
    //   survived — the browser still has it. So on boot we call /refresh:
    //   if the cookie is valid we get a new access token and the user never
    //   saw a login screen; if not, they are genuinely logged out.
    //   This is the piece that makes "token in memory" practical rather
    //   than infuriating, and it is the direct answer to "but doesn't the
    //   user get logged out on every refresh?"
    // ============================================================
    async function bootstrap() {
      try {
        const res = await axiosClient.post('/auth/refresh');
        setAccessToken(res.data.data.accessToken);
        setUser(res.data.data.user);
      } catch {
        // No valid refresh cookie. Not an error — just not logged in.
        clearAccessToken();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    bootstrap();
  }, []);

  // Let the axios interceptor force a logout when a refresh finally fails.
  useEffect(() => {
    registerAuthFailureHandler(() => {
      setUser(null);
      clearAccessToken();
    });
  }, []);

  // ============================================================
  // 🧠 CONCEPT: useCallback — a STABLE function identity
  // WHY IT MATTERS (interview angle): every render creates brand-new
  //   function objects. `login` on render 2 is a DIFFERENT object from
  //   `login` on render 1, even though the code is identical. That matters
  //   in exactly three situations:
  //   1. The function is in a useEffect/useMemo DEPENDENCY ARRAY — a new
  //      identity each render means the effect re-runs every render. If
  //      that effect sets state, you have an infinite loop.
  //   2. The function is passed to a React.memo'd child — a new prop
  //      identity defeats the memo entirely, so the optimisation silently
  //      does nothing.
  //   3. The function goes into a context value (exactly this case) — a new
  //      identity means every consumer re-renders.
  //
  //   ⚠️ OTHERWISE useCallback IS A NET COST. It allocates the dependency
  //   array and runs a comparison on every render, to avoid... allocating a
  //   function, which is extremely cheap in V8. Wrapping every handler "for
  //   performance" makes code slower AND noisier. Measure first.
  //   (React 19's compiler automates this, which is itself a sign that
  //   hand-written memoisation was a bad developer experience.)
  // ============================================================
  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const res = await axiosClient.post('/auth/login', { email, password });
      setAccessToken(res.data.data.accessToken);
      setUser(res.data.data.user);
      return { ok: true };
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  const register = useCallback(async (name, email, password) => {
    setError(null);
    try {
      const res = await axiosClient.post('/auth/register', { name, email, password });
      setAccessToken(res.data.data.accessToken);
      setUser(res.data.data.user);
      return { ok: true };
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await axiosClient.post('/auth/logout');
    } catch {
      // Logout must succeed locally even if the network call fails —
      // otherwise a user with no connectivity can never log out.
    } finally {
      clearAccessToken();
      setUser(null);
    }
  }, []);

  // ============================================================
  // 🧠 CONCEPT: useMemo on the Provider value — essential, not optional
  // WHY IT MATTERS (interview angle): a very common and very costly
  //   mistake:
  //
  //     ❌ <AuthContext.Provider value={{ user, login, logout }}>
  //
  //   That object literal is a NEW OBJECT on every single render of this
  //   provider. Context compares by reference (Object.is), so every
  //   consumer in the entire tree re-renders on every provider render —
  //   even when `user` is byte-for-byte identical. You have built the exact
  //   performance problem Context is accused of having.
  //
  //   ✅ useMemo keeps the object identity stable until something in the
  //   dependency array actually changes.
  // ============================================================
  const value = useMemo(
    () => ({
      user,
      isLoading,
      error,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
    }),
    [user, isLoading, error, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================
// 🧠 CONCEPT: A custom hook wrapping useContext
// WHY IT MATTERS (interview angle): three concrete benefits over exporting
//   the raw context:
//   1. It THROWS A USEFUL ERROR when used outside the Provider. Without
//      this, `useContext` returns undefined and you get
//      "Cannot destructure property 'user' of undefined" pointing at the
//      wrong file entirely.
//   2. Consumers import ONE thing (useAuth) instead of two (useContext +
//      AuthContext).
//   3. It is an ABSTRACTION BOUNDARY: swap Context for Zustand or Redux
//      inside this hook and not a single consuming component changes.
//      That is the real payoff.
// ============================================================
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>. Did you forget to wrap your app?');
  }
  return context;
}

export default AuthContext;
