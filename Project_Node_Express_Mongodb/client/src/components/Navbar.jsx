import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [online, setOnline] = useState(navigator.onLine);

  // ============================================================
  // 🧠 CONCEPT: useEffect cleanup removing an EVENT LISTENER
  // WHY IT MATTERS (interview angle): the second canonical cleanup example
  //   (the first is the timer in useDebounce.js). Without
  //   removeEventListener, every mount adds ANOTHER listener to `window`.
  //   Navigate between pages ten times and there are ten listeners, each
  //   holding a closure over a dead component's state. That is a textbook
  //   memory leak, and the symptom is a page that gets progressively
  //   slower the longer it is open.
  //   ⚠️ The listener must be the SAME FUNCTION REFERENCE in both calls —
  //   `removeEventListener('online', () => setOnline(true))` removes
  //   NOTHING, because that arrow is a brand-new function. Hence the named
  //   handlers below.
  // ============================================================
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <nav className="navbar">
      <div className="nav-brand">
        <NavLink to="/">🧠 MERN Interview Boilerplate</NavLink>
      </div>

      {isAuthenticated && (
        <div className="nav-links">
          {/* NavLink adds an "active" class automatically based on the
              current route — that is the only reason to prefer it over Link. */}
          <NavLink to="/tasks">Tasks (Context)</NavLink>
          <NavLink to="/react-query">React Query</NavLink>
          <NavLink to="/zustand">Zustand</NavLink>
          <NavLink to="/demo">Query demos</NavLink>
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </div>
      )}

      <div className="nav-user">
        {!online && <span className="pill warn">offline</span>}

        {isAuthenticated ? (
          <>
            <span>
              {user.name} <span className={`pill role-${user.role}`}>{user.role}</span>
            </span>
            <button type="button" onClick={handleLogout}>
              Log out
            </button>
          </>
        ) : (
          <NavLink to="/login">Log in</NavLink>
        )}
      </div>
    </nav>
  );
}
