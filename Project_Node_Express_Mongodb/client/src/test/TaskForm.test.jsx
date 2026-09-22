// ============================================================
// 🧠 CONCEPT: Testing a component the way a USER interacts with it
// WHY IT MATTERS (interview angle): these tests never reference a CSS
//   class, a component name, or internal state. They find elements by
//   their accessible label and drive them with real keyboard/click
//   events. That means the tests survive any refactor that keeps the
//   BEHAVIOUR the same — which is precisely the property you want.
// ============================================================

import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskForm from '../components/TaskForm';

describe('TaskForm', () => {
  test('submit is disabled until a title is entered', async () => {
    const user = userEvent.setup();
    render(<TaskForm onSubmit={vi.fn()} />);

    const submit = screen.getByRole('button', { name: /add task/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/title/i), 'Write the README');

    // ⭐ Only possible because the title input is CONTROLLED — the button's
    // disabled state is derived from React state on every keystroke.
    expect(submit).toBeEnabled();
  });

  test('submits both controlled and uncontrolled field values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });

    render(<TaskForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/title/i), 'Ship it');
    // The description is UNCONTROLLED — read from the DOM on submit.
    await user.type(screen.getByLabelText(/description/i), 'With tests');
    await user.selectOptions(screen.getByLabelText(/priority/i), 'high');

    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ship it',
        description: 'With tests', // proves the ref read worked
        priority: 'high',
      })
    );
  });

  test('trims whitespace from the title', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });

    render(<TaskForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/title/i), '   padded   ');
    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'padded' }));
  });

  test('clears the form after a successful submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });

    render(<TaskForm onSubmit={onSubmit} />);

    const titleInput = screen.getByLabelText(/title/i);
    await user.type(titleInput, 'Temporary');
    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(titleInput).toHaveValue('');
  });

  test('shows the server error and does NOT clear the form on failure', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: 'Title already exists' });

    render(<TaskForm onSubmit={onSubmit} />);

    const titleInput = screen.getByLabelText(/title/i);
    await user.type(titleInput, 'Duplicate');
    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(await screen.findByText(/title already exists/i)).toBeInTheDocument();
    // ⭐ Keeping the user's input on failure is basic courtesy — wiping a
    // form because the server said no is a genuinely infuriating bug.
    expect(titleInput).toHaveValue('Duplicate');
  });
});

// ============================================================
// 🧠 CONCEPT: Testing a custom hook in isolation
// WHY IT MATTERS (interview angle): a hook is just a function, but it can
//   only run inside a component. `renderHook` provides a minimal host
//   component so you can test the hook alone — no UI, no mocking of
//   unrelated things. Combined with FAKE TIMERS you can test time-based
//   behaviour instantly instead of actually waiting 400ms per assertion.
// ============================================================
describe('useDebounce', () => {
  test('only emits the final value after the delay', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useDebounce } = await import('../hooks/useDebounce');

    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 400), {
      initialProps: { value: 'a' },
    });

    expect(result.current).toBe('a');

    // Three rapid "keystrokes".
    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    rerender({ value: 'abcd' });

    // Nothing has settled yet — the cleanup cancelled each pending timer.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(400);
    });

    // Only the LAST value survives. 4 keystrokes -> 1 update -> 1 API call.
    expect(result.current).toBe('abcd');

    vi.useRealTimers();
  });
});
