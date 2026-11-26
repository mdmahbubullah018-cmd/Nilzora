// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Tabs, type TabItem } from './tabs';

afterEach(cleanup);

const items: readonly TabItem[] = [
  { key: 'all', label: 'All orders', href: '/admin/orders' },
  {
    key: 'pending',
    label: 'Pending',
    href: '/admin/orders?status=pending',
    count: 3,
  },
];

describe('Tabs', () => {
  it('links every view and marks the one in effect', () => {
    render(<Tabs label="Order status" items={items} current="pending" />);

    const nav = screen.getByRole('navigation', { name: 'Order status' });
    const pending = within(nav).getByRole('link', { name: /Pending/ });
    const all = within(nav).getByRole('link', { name: 'All orders' });

    expect(pending.getAttribute('href')).toBe('/admin/orders?status=pending');
    expect(pending.getAttribute('aria-current')).toBe('page');
    expect(all.getAttribute('aria-current')).toBeNull();
  });

  it('shows a count only where the API gave one', () => {
    render(<Tabs label="Order status" items={items} current="all" />);

    expect(screen.getByText('3')).toBeTruthy();
    const all = screen.getByRole('link', { name: 'All orders' });
    expect(within(all).queryByText('3')).toBeNull();
  });
});
