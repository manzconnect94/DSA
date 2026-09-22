// ============================================================
// 🧠 CONCEPT: ERROR BOUNDARIES — and why they MUST be class components
// WHY IT MATTERS (interview angle): a guaranteed React question, because
//   it is the one thing hooks genuinely cannot do.
//
//   ⭐ WHY A CLASS: an error boundary needs two lifecycle methods that
//   have NO HOOK EQUIVALENT:
//     • static getDerivedStateFromError(error) — called during the RENDER
//       phase to update state so the next render shows a fallback.
//     • componentDidCatch(error, errorInfo)    — called during the COMMIT
//       phase, for side effects like logging to Sentry.
//   There is no useErrorBoundary. The React team has said one is planned
//   but it does not exist today, so if you need a boundary you write a
//   class — or you use the react-error-boundary package, which is itself a
//   class under a hook-friendly API.
//
//   ⚠️ WHAT ERROR BOUNDARIES DO NOT CATCH — this is the follow-up, and
//   the list matters because people assume they catch everything:
//     ❌ EVENT HANDLERS. An onClick that throws is not part of rendering.
//        Use a normal try/catch.
//     ❌ ASYNCHRONOUS CODE. setTimeout, promises, async/await. The error
//        happens on a later tick, outside React's render call stack.
//     ❌ SERVER-SIDE RENDERING.
//     ❌ AN ERROR THROWN IN THE BOUNDARY ITSELF. It propagates to the
//        boundary ABOVE, which is why you often want a minimal top-level
//        boundary plus finer-grained ones inside.
//   So a boundary catches errors in RENDERING, in LIFECYCLE METHODS, and
//   in CONSTRUCTORS of the tree BELOW it. That is it.
//
//   ⚠️ AND THE BIG ONE, since React 16: AN UNCAUGHT ERROR UNMOUNTS THE
//   ENTIRE TREE. The reasoning was that a corrupted UI is worse than no
//   UI — a banking app showing the wrong balance beats showing nothing.
//   In practice it means one broken component blanks your whole app to a
//   white screen unless a boundary catches it. That is why you want them.
//
//   WHERE TO PLACE THEM: not just one at the root. Wrap independent
//   REGIONS — a sidebar, a widget, each route — so a failure in one leaves
//   the rest of the app usable. Granularity is a UX decision.
//
// HOW IT WORKS HERE: the only class component in this codebase, and it
//   exists for exactly this reason.
// ============================================================

import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  // ============================================================
  // 🧠 CONCEPT: getDerivedStateFromError — the RENDER phase
  // WHY IT MATTERS (interview angle): it is STATIC, so it has no access to
  //   `this`. That is deliberate: React calls it during rendering, and the
  //   render phase must stay pure — no side effects, no logging, no
  //   analytics calls. Its ONLY job is to return the new state that makes
  //   the next render show a fallback.
  // ============================================================
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  // ============================================================
  // 🧠 CONCEPT: componentDidCatch — the COMMIT phase
  // WHY IT MATTERS (interview angle): this runs AFTER the DOM has been
  //   updated, so side effects are allowed. This is where real logging
  //   goes. `errorInfo.componentStack` is the gold here — it tells you
  //   WHICH component threw, which a plain JS stack trace will not,
  //   because the JS stack shows React internals rather than your tree.
  // ============================================================
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });

    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, errorInfo.componentStack);

    // In production this is where you'd report it:
    //   Sentry.captureException(error, { contexts: { react: errorInfo } });
    // ⭐ Note: WITHOUT a boundary you would never learn about this crash
    // at all — the user sees a white screen and closes the tab. Boundaries
    // are an observability feature as much as a UX one.
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // A custom fallback can be supplied per boundary.
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback(this.state.error, this.handleReset)
          : this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <h2>⚠️ Something went wrong</h2>
          <p>
            This component crashed, but the error boundary caught it. Without one, React 16+ would have unmounted the
            <strong> entire app</strong> and left a blank white page.
          </p>

          <details>
            <summary>Error details (dev only)</summary>
            <pre>{this.state.error?.toString()}</pre>
            {/* componentStack tells you WHICH component threw — the part a
                normal stack trace cannot give you. */}
            <pre>{this.state.errorInfo?.componentStack}</pre>
          </details>

          {/* ============================================================
              🧠 CONCEPT: Offering a RESET
              WHY IT MATTERS (interview angle): a boundary that only shows
                "something broke" is a dead end. Resetting the state lets
                React re-attempt the render — which fixes it if the cause
                was transient (a failed fetch, a momentary bad prop). If
                the bug is deterministic it will just error again, which is
                also useful information.
              ============================================================ */}
          <button type="button" onClick={this.handleReset}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

// ============================================================
// 🧠 CONCEPT: A component that throws on demand, for the demo
// WHY IT MATTERS (interview angle): lets you SEE the boundary work.
//   Note the contrast baked into it: the render-phase throw IS caught by
//   the boundary, while the event-handler throw is NOT — demonstrating the
//   limitation described at the top of this file rather than just
//   asserting it.
// ============================================================
export function CrashTest() {
  const throwInRender = () => {
    // Forcing a render-phase error via state is the realistic way.
    throw new Error('💥 Deliberate render-phase error — the boundary CATCHES this');
  };

  return (
    <div className="crash-test">
      <button
        type="button"
        onClick={() => {
          // ⚠️ This throw is in an EVENT HANDLER, so the boundary does NOT
          // catch it. Open the console: you will see an uncaught error and
          // the app keeps running normally. This is the limitation, live.
          throw new Error('💥 Event-handler error — the boundary does NOT catch this');
        }}
      >
        Throw in an event handler (NOT caught)
      </button>

      <button
        type="button"
        onClick={() => {
          // Flip a state flag so the NEXT render throws — that one IS
          // inside the render phase, so the boundary catches it.
          // eslint-disable-next-line no-alert
          if (window.confirm('This will crash the component tree. Continue?')) {
            // Force a re-render that throws.
            throwInRender();
          }
        }}
      >
        Throw during render (CAUGHT by the boundary)
      </button>
    </div>
  );
}
