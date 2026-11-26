// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubmitButton } from './submit-button';

afterEach(cleanup);

describe('SubmitButton', () => {
  it('says what is happening and blocks a second click while its form is being sent', async () => {
    let finish: () => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <form action={action}>
        <SubmitButton pendingLabel="Recording…">Record decision</SubmitButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Record decision' });
    expect(button.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    const busy = screen.getByRole('button', { name: 'Recording…' });
    expect(busy.hasAttribute('disabled')).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    const idle = screen.getByRole('button', { name: 'Record decision' });
    expect(idle.hasAttribute('disabled')).toBe(false);
    expect(idle.getAttribute('aria-busy')).toBeNull();
  });

  it('stays disabled when the caller disables it, and keeps its own label without a pending one', () => {
    render(
      <form action={() => undefined}>
        <SubmitButton disabled>Restock</SubmitButton>
      </form>,
    );

    expect(screen.getByRole('button', { name: 'Restock' }).hasAttribute('disabled')).toBe(true);
  });
});
