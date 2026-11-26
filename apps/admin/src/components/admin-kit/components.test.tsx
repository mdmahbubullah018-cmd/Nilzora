// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { TableBody, TableCell, TableHeader, TableRow } from '@nilzora/ui';
import { Banknote } from 'lucide-react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaChart, BarChart } from './charts/cartesian';
import { DonutChart } from './charts/donut-chart';
import { Sparkline } from './charts/sparkline';
import { ConfirmForm } from './confirm-form';
import { DataTable, DataTableEmpty, SortableHead } from './data-table';
import { DetailList } from './detail-list';
import { FilterBar, FilterChips, SearchFilter, SelectFilter } from './filter-bar';
import { withQuery } from './href';
import { KpiCard } from './kpi-card';
import { Pagination } from './pagination';
import { SectionCard } from './section-card';
import { ForbiddenState, ReadState } from './states';
import { OrderStatusBadge, PaymentStatusBadge, RoleBadge, StockBadge } from './status-badge';

// next/form needs the app router; a plain GET form is what it renders without JavaScript.
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

afterEach(cleanup);

// jsdom lacks the modal methods of <dialog>; this mirrors what the Dialog relies on.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

describe('KpiCard', () => {
  it('states the change in words as well as colour', () => {
    render(
      <KpiCard
        label="Sales"
        value="৳1,25,000"
        icon={Banknote}
        change={{ ratio: 0.125, comparison: 'vs previous 30 days' }}
        trend={[1, 3, 2]}
      />,
    );
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('৳1,25,000')).toBeTruthy();
    const change = screen.getByText('vs previous 30 days').parentElement;
    expect(change?.textContent).toBe('Up12.5%vs previous 30 days');
  });

  it('treats a rise as bad news when asked, and says when there is nothing to compare', () => {
    const { container, rerender } = render(
      <KpiCard
        label="Cancelled"
        value="4"
        icon={Banknote}
        change={{ ratio: 0.5, comparison: 'vs previous 7 days', increaseIs: 'bad' }}
      />,
    );
    // A rise that is bad news is shown in the danger tone.
    expect(container.querySelector('.text-danger-ink')?.textContent).toContain('50%');

    rerender(
      <KpiCard
        label="Cancelled"
        value="4"
        icon={Banknote}
        change={{ ratio: null, comparison: 'vs previous 7 days' }}
      />,
    );
    expect(screen.getByText('No comparison')).toBeTruthy();
    expect(screen.getByText('vs previous 7 days: no earlier figures')).toBeTruthy();
  });

  it('links the whole card when given an address', () => {
    render(<KpiCard label="Low stock" value="3" icon={Banknote} href="/admin" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/admin');
  });
});

describe('charts', () => {
  const data = [
    { label: '24 Oct', detail: 'Sat, 24 Oct 2026', value: 50_000 },
    { label: '25 Oct', detail: 'Sun, 25 Oct 2026', value: 125_000 },
  ];

  it.each([
    ['area', AreaChart],
    ['bar', BarChart],
  ] as const)('gives the %s chart a data table as its text alternative', (_, Chart) => {
    const { container } = render(
      <Chart
        title="Daily sales"
        columns={['Day', 'Sales']}
        data={data}
        formatValue={(value) => `৳${String(value / 100)}`}
        summary="৳1750 from 3 orders"
      />,
    );
    const table = screen.getByRole('table', { name: 'Daily sales' });
    const rows = within(table).getAllByRole('row');

    expect(rows.map((row) => row.textContent)).toEqual([
      'DaySales',
      'Sat, 24 Oct 2026৳500',
      'Sun, 25 Oct 2026৳1250',
    ]);
    expect(container.querySelector('figcaption')?.textContent).toBe(
      'Daily sales. ৳1750 from 3 orders',
    );
    expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
    // The figures sit behind a native disclosure that keyboards reach without JavaScript.
    expect(table.closest('details')?.querySelector('summary')?.textContent).toContain(
      'Show the figures',
    );
  });

  it('writes every donut segment out with its value and share', () => {
    render(
      <DonutChart
        title="Orders by status"
        centerLabel="orders"
        segments={[
          { key: 'pending', label: 'Pending', value: 3, tone: 'warning', href: '/admin' },
          { key: 'delivered', label: 'Delivered', value: 1, tone: 'success' },
          { key: 'cancelled', label: 'Cancelled', value: 0, tone: 'neutral' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['Pending375%', 'Delivered125%', 'Cancelled00%']);
    expect(screen.getByRole('link').textContent).toContain('Pending');
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('keeps an unlabelled sparkline out of the accessibility tree', () => {
    const { container, rerender } = render(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    rerender(<Sparkline values={[1, 2, 3]} label="Sales trend" />);
    expect(screen.getByRole('img', { name: 'Sales trend' })).toBeTruthy();

    rerender(<Sparkline values={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('DataTable', () => {
  const hrefFor = (sort: { column: string; direction: string }) =>
    withQuery('/admin', { sort: sort.direction === 'desc' ? `-${sort.column}` : sort.column });

  it('marks the sorted column and links each heading to its next sort', () => {
    render(
      <DataTable caption="Orders">
        <TableHeader>
          <TableRow>
            <SortableHead
              column="placed"
              sort={{ column: 'placed', direction: 'desc' }}
              hrefFor={hrefFor}
            >
              Placed
            </SortableHead>
            <SortableHead
              column="total"
              sort={{ column: 'placed', direction: 'desc' }}
              hrefFor={hrefFor}
              firstDirection="desc"
            >
              Total
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Today</TableCell>
            <TableCell>৳500</TableCell>
          </TableRow>
        </TableBody>
      </DataTable>,
    );

    expect(screen.getByRole('table', { name: 'Orders' })).toBeTruthy();
    const [placed, total] = screen.getAllByRole('columnheader');
    expect(placed?.getAttribute('aria-sort')).toBe('descending');
    expect(total?.hasAttribute('aria-sort')).toBe(false);
    expect(within(placed!).getByRole('link').getAttribute('href')).toBe('/admin?sort=placed');
    expect(within(total!).getByRole('link').getAttribute('href')).toBe('/admin?sort=-total');
  });

  it('draws an empty message under the table, outside its scrolling wrapper', () => {
    render(
      <DataTable caption="Orders">
        <DataTableEmpty colSpan={5} title="No orders match" description="Clear the filters." />
      </DataTable>,
    );
    const table = screen.getByRole('table', { name: 'Orders' });
    const message = screen.getByText('No orders match');
    // A centred message inside a wide, sideways-scrolling table sits mostly off-screen on a
    // phone, so it must not be a descendant of the table or of its overflow-x wrapper.
    expect(table.contains(message)).toBe(false);
    expect(table.parentElement?.contains(message)).toBe(false);
    expect(screen.queryByRole('cell')).toBeNull();
    expect(screen.getByText('Clear the filters.')).toBeTruthy();
  });

  it('still spans every column when the empty body is used on its own', () => {
    render(
      <table>
        <DataTableEmpty colSpan={5} title="No orders match" />
      </table>,
    );
    expect(screen.getByRole('cell').getAttribute('colspan')).toBe('5');
  });
});

describe('filters and paging', () => {
  it('submits filters as a GET form without a page field', () => {
    const { container } = render(
      <FilterBar action="/admin" resetHref="/admin" hidden={{ sort: '-total', empty: undefined }}>
        <SearchFilter label="Search orders" defaultValue="NZ1" />
        <SelectFilter
          name="status"
          label="Status"
          defaultValue="pending"
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'shipped', label: 'Shipped' },
          ]}
        />
      </FilterBar>,
    );
    const form = screen.getByRole('search', { name: 'Filters' });

    expect(form.getAttribute('method')).toBe('get');
    expect(screen.getByLabelText<HTMLInputElement>('Search orders').value).toBe('NZ1');
    expect(screen.getByLabelText<HTMLSelectElement>('Status').value).toBe('pending');
    expect(screen.getByRole('option', { name: 'All' })).toBeTruthy();
    const hidden = [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')];
    expect(hidden.map((input) => [input.name, input.value])).toEqual([['sort', '-total']]);
    expect(container.querySelector('[name="page"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Clear' }).getAttribute('href')).toBe('/admin');
  });

  it('lists active filters as links that remove them', () => {
    render(
      <FilterChips
        clearHref="/admin"
        chips={[
          { key: 'status', label: 'Status: Pending', removeHref: '/admin?q=NZ1' },
          { key: 'q', label: 'Search: NZ1', removeHref: '/admin?status=pending' },
        ]}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Status: Pending, remove filter' }).getAttribute('href'),
    ).toBe('/admin?q=NZ1');
    expect(screen.getByRole('link', { name: 'Clear all' })).toBeTruthy();
  });

  it('pages with links and never past the last page', () => {
    render(
      <Pagination
        page={3}
        totalPages={3}
        total={60}
        pageSize={25}
        noun="orders"
        hrefFor={(page) => withQuery('/admin', { page })}
      />,
    );
    expect(screen.getByText('Showing 51–60 of 60 orders')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Previous' }).getAttribute('href')).toBe(
      '/admin?page=2',
    );
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Page 3' }).getAttribute('aria-current')).toBe('page');
  });

  it('shows only the summary for a single page', () => {
    render(
      <Pagination
        page={1}
        totalPages={1}
        total={3}
        pageSize={25}
        noun="orders"
        hrefFor={() => '/admin'}
      />,
    );
    expect(screen.getByText('Showing 1–3 of 3 orders')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('ConfirmForm', () => {
  const csrf = { name: 'csrf_token', token: 'signed-test-token' };

  function confirmation(overrides: Partial<ComponentProps<typeof ConfirmForm>> = {}) {
    return (
      <ConfirmForm
        action={vi.fn()}
        csrf={csrf}
        trigger="Cancel order"
        title="Cancel order NZ100042?"
        description="Its stock returns to inventory."
        confirmLabel="Yes, cancel it"
        hiddenFields={{ orderNumber: 'NZ100042' }}
        {...overrides}
      />
    );
  }

  const dialogNamed = (name: string) =>
    screen
      .getAllByRole('dialog', { hidden: true })
      .find((dialog) => dialog.textContent.includes(name));

  it('without JavaScript, reveals an inline form posting the CSRF field and hidden values', () => {
    const html = renderToString(confirmation());
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(container.querySelector('details summary')?.textContent).toBe('Cancel order');
    const fields = [...container.querySelectorAll<HTMLInputElement>('form input[type="hidden"]')];
    expect(fields.map((field) => [field.name, field.value])).toEqual([
      ['csrf_token', 'signed-test-token'],
      ['orderNumber', 'NZ100042'],
    ]);
  });

  it('opens a modal dialog carrying the same form, and returns focus to the trigger', () => {
    const { container } = render(confirmation());
    const trigger = screen.getByRole('button', { name: 'Cancel order' });
    const dialog = container.ownerDocument.querySelector('dialog');
    if (!dialog) throw new Error('dialog not rendered');

    expect(dialog.open).toBe(false);
    fireEvent.click(trigger);
    expect(dialog.open).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // The click opened the dialog instead of the inline <details> panel.
    expect(trigger.closest('details')?.open).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Cancel order NZ100042?' })).toBe(dialog);
    const fields = [...dialog.querySelectorAll<HTMLInputElement>('input[type="hidden"]')];
    expect(fields.map((field) => field.name)).toEqual(['csrf_token', 'orderNumber']);

    const keep = within(dialog).getAllByRole('button', { name: 'Keep it' }).at(-1);
    fireEvent.click(keep!);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape and when focus leaves the dialog', () => {
    render(
      <>
        {confirmation({ children: <input aria-label="Reason" /> })}
        <button type="button">Elsewhere</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Cancel order' });
    const dialog = dialogNamed('Cancel order NZ100042?') as HTMLDialogElement;

    fireEvent.click(trigger);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(dialog.open).toBe(false);

    fireEvent.click(trigger);
    fireEvent.blur(screen.getByLabelText('Reason'), {
      relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }),
    });
    expect(dialog.open).toBe(false);
  });

  it('keeps only one confirmation open at a time', () => {
    render(
      <>
        {confirmation()}
        {confirmation({ trigger: 'Archive', title: 'Archive this product?' })}
      </>,
    );
    const first = dialogNamed('Cancel order NZ100042?') as HTMLDialogElement;
    const second = dialogNamed('Archive this product?') as HTMLDialogElement;

    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(first.open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(second.open).toBe(true);
    expect(first.open).toBe(false);
  });

  it('opens with the message of a refused attempt', () => {
    render(confirmation({ error: 'Give a reason of at least 5 characters' }));
    expect(dialogNamed('Cancel order NZ100042?')?.hasAttribute('open')).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Give a reason of at least 5 characters');
  });
});

describe('states and records', () => {
  it('names the permission a forbidden section needs', () => {
    render(<ForbiddenState permission="finance.read" />);
    expect(screen.getByRole('status').textContent).toContain('“View sales and finance”');
  });

  it('maps every read failure to its own explanation', () => {
    const { rerender } = render(<ReadState failure="unavailable" retryHref="/admin" />);
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/admin');

    rerender(<ReadState failure="rate_limited" retryHref="/admin" />);
    expect(screen.getByText('Too many requests')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Wait a moment, then try again.');

    rerender(<ReadState failure="not_found" />);
    expect(screen.getByText('Not found')).toBeTruthy();

    rerender(<ReadState failure="invalid" resetHref="/admin" />);
    expect(screen.getByRole('alert').textContent).toContain('could not be applied');
  });

  it('labels a section by its title and shows missing values as not set', () => {
    render(
      <SectionCard title="Delivery">
        <DetailList
          items={[
            { label: 'Recipient', value: 'Ayesha Rahman' },
            { label: 'Note', value: null },
          ]}
        />
      </SectionCard>,
    );
    const region = screen.getByRole('region', { name: 'Delivery' });
    expect(within(region).getByText('Ayesha Rahman')).toBeTruthy();
    expect(within(region).getByText('Not set')).toBeTruthy();
  });

  it('labels statuses, roles and stock levels in words', () => {
    render(
      <>
        <OrderStatusBadge status="shipped" />
        <PaymentStatusBadge status="collected" />
        <RoleBadge role="super_admin" />
        <StockBadge quantity={0} />
        <StockBadge quantity={3} />
      </>,
    );
    for (const label of ['Shipped', 'Cash collected', 'Owner', 'Out of stock', 'Low stock']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
