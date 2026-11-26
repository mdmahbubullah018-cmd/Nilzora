// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QuickActionsSection, quickActions } from './quick-actions';

afterEach(cleanup);

describe('quick actions', () => {
  it('offers a staff account only the shortcuts its permissions allow', () => {
    const names = quickActions(
      [
        'admin_workspace.access',
        'orders.read',
        'products.create',
        'inventory.adjust',
        'customers.read',
      ],
      undefined,
    ).map((action) => action.label);
    expect(names).toEqual(['Orders', 'Add a product', 'Stock levels', 'Customers']);
    // Nothing for money or messages: those permissions are not held.
    expect(names).not.toContain('COD collections');
    expect(names).not.toContain('Messages');
  });

  it('offers nothing to an account with none of the permissions, and renders nothing', () => {
    expect(quickActions(['admin_workspace.access'], undefined)).toEqual([]);
    const { container } = render(
      <QuickActionsSection permissions={['admin_workspace.access']} summary={undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a figure only when the dashboard has one', () => {
    render(
      <QuickActionsSection
        permissions={['orders.read', 'payments.collect', 'inventory.adjust']}
        summary={
          {
            orders: { pending: 3, awaitingCollection: 0 },
            stock: { lowStockCount: 0 },
          } as never
        }
      />,
    );
    expect(screen.getByText('3 to confirm')).toBeTruthy();
    expect(screen.queryByText(/to record/)).toBeNull();
    expect(screen.queryByText(/ low$/)).toBeNull();
  });
});
