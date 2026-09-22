import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const { register } = useAuth();
  const navigate = useNavigate();

  // ============================================================
  // 🧠 CONCEPT: One state object vs one useState per field
  // WHY IT MATTERS (interview angle): a single object plus a generic
  //   handler scales better than five useStates and five handlers.
  //   ⚠️ THE CATCH: you MUST spread the previous state, because setState
  //   REPLACES rather than merges (unlike the old class-component
  //   this.setState, which DID merge shallowly — a real source of
  //   confusion when converting classes to hooks). Forget the spread and
  //   typing in `email` wipes `name`.
  //   ⚠️ And use the FUNCTIONAL form `setForm(prev => ...)`: reading
  //   `form` directly closes over a possibly-stale value if two updates
  //   batch together.
  // ============================================================
  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // ============================================================
  // 🧠 CONCEPT: Derived state should be COMPUTED, not stored
  // WHY IT MATTERS (interview angle): a frequent design mistake is to keep
  //   `const [isValid, setIsValid] = useState(false)` and update it inside
  //   an effect whenever the fields change. That is a second source of
  //   truth which can drift out of sync with the first — and it costs an
  //   extra render.
  //   ⭐ THE RULE: if a value can be calculated from existing state, do
  //   not store it. Calculate it during render. Only reach for useMemo
  //   when the calculation is genuinely expensive — this one is not, but
  //   it is memoised here because the object feeds a child prop.
  // ============================================================
  const validation = useMemo(() => {
    const issues = [];
    if (form.name.trim().length < 2) issues.push('Name must be at least 2 characters');
    if (!/^\S+@\S+\.\S+$/.test(form.email)) issues.push('Enter a valid email');
    if (form.password.length < 8) issues.push('Password must be at least 8 characters');
    if (!/[0-9]/.test(form.password)) issues.push('Password needs at least one digit');
    if (!/[a-zA-Z]/.test(form.password)) issues.push('Password needs at least one letter');
    return { issues, isValid: issues.length === 0 };
  }, [form]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validation.isValid) return;

    setSubmitting(true);
    setFormError(null);

    const result = await register(form.name, form.email, form.password);
    setSubmitting(false);

    if (result.ok) navigate('/tasks', { replace: true });
    else setFormError(result.error);
  }

  return (
    <div className="auth-page">
      <h1>Create an account</h1>

      <form onSubmit={handleSubmit}>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" value={form.name} onChange={handleChange} autoComplete="name" />

        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" value={form.email} onChange={handleChange} autoComplete="email" />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          autoComplete="new-password"
        />

        {/* Live feedback — only possible because the inputs are controlled. */}
        {form.password.length > 0 && validation.issues.length > 0 && (
          <ul className="validation-hints">
            {validation.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <button type="submit" disabled={submitting || !validation.isValid}>
          {submitting ? 'Creating…' : 'Register'}
        </button>
      </form>

      {/* ============================================================
          🧠 CONCEPT: Client validation is UX; server validation is security
          WHY IT MATTERS (interview angle): the exact same point as
            ProtectedRoute. The checks above give instant feedback and save
            a round-trip — that is all. Anyone can bypass them with curl,
            which is why server/middleware/validate.js re-validates every
            single field. NEVER trust the client. Client validation that
            is not duplicated server-side is not validation.
          ============================================================ */}
      <p className="hint">
        ⚠️ These checks are duplicated in <code>server/middleware/validate.js</code>. The client version is for
        feedback; the server version is the one that actually protects the database.
      </p>

      <p>
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
