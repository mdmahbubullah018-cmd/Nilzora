// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Route } from 'next';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterBar, SearchFilter, SelectFilter } from './filter-bar';

vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

afterEach(cleanup);

describe('FilterForm', () => {
  it('leaves empty fields out of the submitted address, then enables them again', async () => {
    vi.useFakeTimers();
    try {
      render(
        <FilterBar
          action={'/admin/shipments' as Route}
          hidden={{ kind: 'forward', sort: undefined }}
        >
          <SearchFilter label="Search shipments" />
          <SelectFilter
            name="status"
            label="Status"
            options={[{ value: 'delivered', label: 'Delivered' }]}
            defaultValue="delivered"
          />
          <SelectFilter name="courier" label="Courier" options={[]} />
        </FilterBar>,
      );
      const form = screen.getByRole('search');
      // next/form reads the form after our handler, still inside the submit event.
      let sent = '';
      const read = (event: Event) => {
        event.preventDefault();
        sent = new URLSearchParams(new FormData(form as HTMLFormElement) as never).toString();
      };
      document.addEventListener('submit', read);
      fireEvent.submit(form);
      document.removeEventListener('submit', read);
      expect(sent).toBe('kind=forward&status=delivered');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5);
      });
      expect(screen.getByLabelText('Search shipments')).toHaveProperty('disabled', false);
      expect(screen.getByLabelText('Courier')).toHaveProperty('disabled', false);
    } finally {
      vi.useRealTimers();
    }
  });
});
