import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ============================================================
// 🧠 CONCEPT: A fully CONTROLLED form with derived validation
// WHY IT MATTERS (interview angle): a login form is the right place for
//   controlled inputs — you want a live-disabled submit button and instant
//   feedback, both of which need the current values in state. Compare with
//   TaskForm.jsx, which mixes controlled and uncontrolled deliberately.
// ============================================================
export default function LoginPage() {
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('Password123');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Where ProtectedRoute wanted to send us before bouncing to /login.
  const destination = location.state?.from?.pathname || '/tasks';

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const result = await login(email, password);

    setSubmitting(false);

    if (result.ok) {
      // `replace` so Back does not return to the login screen.
      navigate(destination, { replace: true });
    } else {
      setFormError(result.error);
    }
  }

  return (
    <div className="auth-page">
      <h1>Log in</h1>

      <div className="seed-hint">
        <strong>Seeded accounts</strong> (run <code>npm run seed</code> first):
        <br />
        <code>demo@example.com / Password123</code> — regular user with lots of tasks
        <br />
        <code>admin@example.com / Password123</code> — admin
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          // ============================================================
          // 🧠 CONCEPT: autoComplete hints are an accessibility feature
          // WHY IT MATTERS (interview angle): "current-password" vs
          //   "new-password" tells password managers which field is which.
          //   Get it wrong and 1Password/Chrome offer to save the wrong
          //   value, or fail to autofill — a small detail that real users
          //   notice immediately.
          // ============================================================
          autoComplete="current-password"
          required
        />

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        {/* ============================================================
            🧠 CONCEPT: The error message is deliberately vague
            WHY IT MATTERS (interview angle): the server returns "Invalid
              email or password" for BOTH an unknown email and a wrong
              password, to prevent user enumeration (see the full
              explanation in server/controllers/authController.js). The UI
              must not helpfully "improve" on that by saying "no account
              with that email" — that would reintroduce the leak in the
              frontend after the backend carefully closed it.
            ============================================================ */}

        <button type="submit" disabled={submitting || !email || !password}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p>
        No account? <Link to="/register">Register</Link>
      </p>

      <details className="concept-note">
        <summary>What happens when you click Log in?</summary>
        <ol>
          <li>
            <code>POST /api/auth/login</code> with the credentials.
          </li>
          <li>Server verifies the bcrypt hash (and burns the same CPU on a dummy hash if the user doesn&apos;t exist, so timing can&apos;t leak).</li>
          <li>
            Server returns an <strong>access token</strong> in the JSON body (15 min) and sets a{' '}
            <strong>refresh token</strong> as an httpOnly cookie (7 days).
          </li>
          <li>
            The access token is stored in a <strong>module variable</strong> — memory, not localStorage, so XSS
            can&apos;t read it.
          </li>
          <li>
            The axios interceptor attaches it as <code>Authorization: Bearer …</code> on every later request.
          </li>
          <li>When it expires, the interceptor silently refreshes using the cookie and replays the failed request.</li>
        </ol>
      </details>
    </div>
  );
}
