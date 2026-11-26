import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropEmptyFields } from './clean-get-form';

afterEach(() => {
  vi.useRealTimers();
});

describe('dropEmptyFields', () => {
  it('leaves blank fields out of the submission, then lets them be edited again', () => {
    vi.useFakeTimers();
    let sent: string[] = [];
    const { container } = render(
      <form
        onSubmit={(event) => {
          dropEmptyFields(event);
          sent = [...new FormData(event.currentTarget).keys()];
          event.preventDefault();
        }}
      >
        <input name="min" defaultValue="" />
        <input name="max" defaultValue="1500" />
        <select name="brand" defaultValue="">
          <option value="">All brands</option>
        </select>
        <input type="checkbox" name="stock" value="in" defaultChecked />
      </form>,
    );
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.submit(form);
    expect(sent).toEqual(['max', 'stock']);
    vi.runAllTimers();
    expect(container.querySelector<HTMLInputElement>('input[name="min"]')?.disabled).toBe(false);
  });
});
