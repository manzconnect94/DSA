// ============================================================
// 🧠 CONCEPT: CONTROLLED vs UNCONTROLLED components
// WHY IT MATTERS (interview angle): a standard React question, and this
//   file implements BOTH in the same form so the difference is concrete.
//
//   ── CONTROLLED ─────────────────────────────────────────────────────
//     <input value={title} onChange={e => setTitle(e.target.value)} />
//
//   React state is the SINGLE SOURCE OF TRUTH. The DOM input merely
//   displays what state says. Every keystroke: onChange -> setState ->
//   re-render -> new value prop.
//
//   ✅ You can validate/transform on every keystroke (force uppercase,
//      strip characters, show live character counts).
//   ✅ You can disable the submit button based on current values.
//   ✅ Easy to reset, prefill, or drive from elsewhere.
//   ✅ The value is always available without touching the DOM.
//   ❌ A re-render PER KEYSTROKE. Usually irrelevant, but in a large form
//      or a slow component tree it is measurable jank.
//   ❌ More boilerplate: state + handler per field.
//
//   ── UNCONTROLLED ───────────────────────────────────────────────────
//     <input defaultValue="" ref={inputRef} />   // read ref.current.value
//
//   The DOM holds the value; React only reads it when you ask (usually on
//   submit).
//
//   ✅ ZERO re-renders while typing — genuinely faster for big forms.
//   ✅ Less code.
//   ✅ ⭐ REQUIRED for <input type="file">: a file input's value is
//      READ-ONLY for security (otherwise a page could set it to
//      "C:\passwords.txt" and steal a file without the user choosing it).
//      A file input CANNOT be controlled.
//   ❌ No live validation, no live derived UI.
//   ❌ You must reach into the DOM to read values — less "React-y".
//
//   ⚠️ THE ERROR EVERYONE HITS: `value={undefined}` makes an input
//   uncontrolled; later setting a real value makes it controlled, and
//   React warns "A component is changing an uncontrolled input to be
//   controlled". THE FIX: initialise state to '' (empty string), never
//   undefined or null.
//
//   ⭐ IN PRACTICE: react-hook-form is popular precisely because it uses
//   UNCONTROLLED inputs under the hood (via refs) to avoid per-keystroke
//   re-renders, while still giving you a validation API. That is a good
//   thing to mention — it shows you know why the trade-off matters.
//
// HOW IT WORKS HERE: title/status/priority are CONTROLLED; description and
//   the file input are UNCONTROLLED. Both submit through one handler.
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';

export default function TaskForm({ onSubmit, isSubmitting = false }) {
  // ---- CONTROLLED state ----
  // ⚠️ Initialised to '' and NOT undefined — see the warning above.
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [priority, setPriority] = useState('medium');
  const [error, setError] = useState(null);

  // ============================================================
  // 🧠 CONCEPT: useRef for DOM ACCESS (use #1 of two)
  // WHY IT MATTERS (interview angle): useRef has two distinct jobs, and
  //   this is the first — an escape hatch to a real DOM node. Legitimate
  //   uses: focus management, text selection, measuring size, triggering
  //   media playback, and integrating a non-React library (a chart, a map,
  //   a rich-text editor) that wants a DOM element.
  //   ⚠️ NOT for reading or writing content you could hold in state.
  //   Reaching into the DOM to change what is displayed fights React's
  //   model and produces UI that disagrees with state.
  //   (Use #2 — persisting a value without re-rendering — is demonstrated
  //   in AuthContext.jsx and just below.)
  // ============================================================
  const titleInputRef = useRef(null);
  const descriptionRef = useRef(null); // UNCONTROLLED: we read .value on submit
  const fileInputRef = useRef(null); // MUST be uncontrolled

  // ============================================================
  // 🧠 CONCEPT: useRef to persist a value WITHOUT re-rendering (use #2)
  // WHY IT MATTERS (interview angle): a render counter is the clearest
  //   demonstration. If this were useState, incrementing it would trigger
  //   a render, which would increment it, which would render... an
  //   infinite loop. Because a ref mutation does NOT re-render, it can
  //   safely track render-related data.
  //   Watch the counter in the UI: it ticks up on every CONTROLLED
  //   keystroke and stays still while you type in the UNCONTROLLED
  //   textarea. That single observation is the entire lesson of this file.
  // ============================================================
  const renderCount = useRef(0);
  renderCount.current += 1;

  // Autofocus on mount — the classic DOM-ref use case.
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault(); // stop the browser's native full-page form POST
      setError(null);

      // CONTROLLED values come from state...
      const trimmedTitle = title.trim();
      // ...UNCONTROLLED values are read from the DOM, only now.
      const description = descriptionRef.current?.value ?? '';

      if (!trimmedTitle) {
        setError('Title is required');
        titleInputRef.current?.focus();
        return;
      }

      const result = await onSubmit({ title: trimmedTitle, description, status, priority });

      if (result?.ok) {
        // Resetting CONTROLLED fields = setState.
        setTitle('');
        setStatus('todo');
        setPriority('medium');
        // Resetting UNCONTROLLED fields = touch the DOM directly. Note the
        // asymmetry — this is the practical cost of uncontrolled inputs.
        if (descriptionRef.current) descriptionRef.current.value = '';
        if (fileInputRef.current) fileInputRef.current.value = '';
        titleInputRef.current?.focus();
      } else if (result?.error) {
        setError(result.error);
      }
    },
    [title, status, priority, onSubmit]
  );

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <div className="form-meta">
        renders: <strong>{renderCount.current}</strong>{' '}
        <span className="hint">
          (ticks on every keystroke in the CONTROLLED title; stays still while typing the UNCONTROLLED description)
        </span>
      </div>

      {/* ---------- CONTROLLED ---------- */}
      <label htmlFor="task-title">
        Title <span className="badge controlled">controlled</span>
      </label>
      <input
        id="task-title"
        ref={titleInputRef}
        type="text"
        // The value comes FROM state — React owns it.
        value={title}
        // ...and every keystroke writes back to state, causing a re-render.
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs doing?"
        maxLength={200}
        disabled={isSubmitting}
      />
      {/* Live derived UI — only possible because the value is in state. */}
      <small className={title.length > 180 ? 'warn' : ''}>{title.length}/200 characters</small>

      {/* ---------- UNCONTROLLED ---------- */}
      <label htmlFor="task-description">
        Description <span className="badge uncontrolled">uncontrolled</span>
      </label>
      <textarea
        id="task-description"
        ref={descriptionRef}
        // `defaultValue`, NOT `value`. Using `value` without `onChange`
        // makes the field read-only and logs a React warning.
        defaultValue=""
        rows={3}
        placeholder="Type here — notice the render counter above does NOT move"
        disabled={isSubmitting}
      />
      <small>The DOM holds this value; React reads it only on submit.</small>

      {/* ---------- CONTROLLED selects ---------- */}
      <div className="form-row">
        <div>
          <label htmlFor="task-status">Status</label>
          <select id="task-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={isSubmitting}>
            <option value="todo">To do</option>
            <option value="in-progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </div>

        <div>
          <label htmlFor="task-priority">Priority</label>
          <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)} disabled={isSubmitting}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      {/* ============================================================
          🧠 CONCEPT: A file input CANNOT be controlled
          WHY IT MATTERS (interview angle): the `value` of
            <input type="file"> is read-only by browser security design. If
            a page could set it programmatically, any site could silently
            upload a file from your disk. So file inputs are ALWAYS
            uncontrolled — you read `ref.current.files`. This is not a
            React limitation; it is a web platform rule, and knowing the
            reason is the good answer.
          ============================================================ */}
      <label htmlFor="task-file">
        Attachment <span className="badge uncontrolled">must be uncontrolled</span>
      </label>
      <input id="task-file" ref={fileInputRef} type="file" accept="image/*,.pdf,.txt" disabled={isSubmitting} />

      {error && <p className="form-error">{error}</p>}

      <button type="submit" disabled={isSubmitting || !title.trim()}>
        {/* Disabling based on the live value is only possible because
            `title` is CONTROLLED. With an uncontrolled input you would not
            know whether it is empty without reading the DOM on every render. */}
        {isSubmitting ? 'Saving…' : 'Add task'}
      </button>
    </form>
  );
}
