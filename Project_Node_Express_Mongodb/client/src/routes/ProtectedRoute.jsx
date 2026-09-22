// ============================================================
// 🧠 CONCEPT: Protected routes — and why they are UX, NOT SECURITY
// WHY IT MATTERS (interview angle): the critical point, and one
//   interviewers deliberately probe:
//
//   ⚠️⚠️ CLIENT-SIDE ROUTE GUARDS ARE NOT SECURITY. All the JavaScript
//   is already in the user's browser. They can open DevTools, set
//   `isAuthenticated = true`, delete this component from the bundle, or
//   simply ignore your app entirely and curl the API. A route guard
//   prevents an honest user from seeing a broken page; it prevents an
//   attacker from precisely nothing.
//
//   ⭐ THE REAL SECURITY IS ON THE SERVER — verifyAccessToken,
//   requireRole and requireOwnership in server/middleware/auth.js. Those
//   run on a machine the user does not control. The guard below is a
//   REDIRECT, not a lock.
//
//   So what IS it for? Genuinely useful things:
//   • Not rendering a dashboard that will immediately 401 and show errors.
//   • Redirecting to /login with the intended destination remembered.
//   • Hiding admin UI that would only frustrate a non-admin.
//
//   The right mental model: the client guard decides WHAT TO SHOW; the
//   server decides WHAT IS ALLOWED. If your API is properly protected, a
//   user who bypasses this guard sees an empty page and a pile of 403s —
//   annoying for them, harmless for you.
//
// HOW IT WORKS HERE: reads AuthContext, redirects when unauthenticated,
//   and optionally enforces a role.
// ============================================================

import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, requireRole = null }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // ============================================================
  // 🧠 CONCEPT: The loading state is NOT optional here
  // WHY IT MATTERS (interview angle): a subtle, very common bug. On page
  //   load, AuthContext is still calling /auth/refresh to silently restore
  //   the session — so for a few hundred milliseconds `isAuthenticated` is
  //   false even though the user IS logged in. Without this guard, every
  //   refresh of a protected page FLASHES THE LOGIN SCREEN and then
  //   redirects back, or worse, kicks the user out entirely.
  //   THE FIX: a three-state model — loading / authenticated /
  //   unauthenticated — and render nothing decisive while loading.
  // ============================================================
  if (isLoading) {
    return (
      <div className="route-loading">
        <p>Restoring session…</p>
        <small>Calling /api/auth/refresh with the httpOnly cookie</small>
      </div>
    );
  }

  if (!isAuthenticated) {
    // ============================================================
    // 🧠 CONCEPT: Preserving the intended destination
    // WHY IT MATTERS (interview angle): a small detail that signals care.
    //   A user deep-links to /tasks/abc123, gets bounced to /login, logs
    //   in — and should land back on /tasks/abc123, not on a generic home
    //   page. Stashing `location` in the navigation state makes that
    //   possible; LoginPage reads it back.
    //   `replace` matters too: without it, the login page is pushed onto
    //   the history stack, so pressing Back after logging in returns the
    //   user to the login screen.
    // ============================================================
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // ---- Role gate (AUTHORIZATION, again only cosmetic) ----
  if (requireRole && user?.role !== requireRole) {
    return (
      <div className="forbidden">
        <h2>403 — Not allowed</h2>
        <p>
          This page requires the <strong>{requireRole}</strong> role; you are <strong>{user?.role}</strong>.
        </p>
        <p className="hint">
          ⚠️ Note this check is cosmetic. The real enforcement is
          <code> requireRole(&apos;admin&apos;) </code> on the server — try calling
          <code> GET /api/admin/users </code> directly and you will still get a 403.
        </p>
      </div>
    );
  }

  // ============================================================
  // 🧠 CONCEPT: children vs <Outlet /> — two router patterns
  // WHY IT MATTERS (interview angle): React Router v6 supports both:
  //   1. WRAPPER:  <Route path="/x" element={<ProtectedRoute><X/></ProtectedRoute>} />
  //      Explicit and readable per route.
  //   2. LAYOUT ROUTE: <Route element={<ProtectedRoute/>}> with nested
  //      <Route> children rendered through <Outlet/>. Less repetition when
  //      many routes share the guard — and, as with router-level
  //      middleware on the server, it is secure-by-default: a new nested
  //      route inherits the guard automatically.
  //   Supporting both means callers can pick.
  // ============================================================
  return children ?? <Outlet />;
}

// ============================================================
// 🧠 CONCEPT: PublicRoute — the inverse guard
// WHY IT MATTERS (interview angle): an already-logged-in user should not
//   see the login page. Without this, they can navigate back to /login,
//   sign in again, and create a duplicate session — or just be confused.
//   Small, but it is the kind of completeness that gets noticed.
// ============================================================
export function PublicRoute({ children, redirectTo = '/tasks' }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="route-loading">Loading…</div>;

  if (isAuthenticated) {
    // Send them back where they were headed before the login bounce.
    const destination = location.state?.from?.pathname || redirectTo;
    return <Navigate to={destination} replace />;
  }

  return children ?? <Outlet />;
}
