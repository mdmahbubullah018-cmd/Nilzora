// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { BarList } from './bar-list';
import { ComboChart } from './combo-chart';
import { DonutChart } from './donut-chart';
import { Funnel } from './funnel';
import { Heatmap } from './heatmap';
import { RadialProgress } from './radial-progress';
import { Sparkline } from './sparkline';
import { StackedBarChart } from './stacked-bar-chart';

afterEach(cleanup);

const taka = (minor: number) => `৳${String(minor / 100)}`;
const orders = (count: number) => `${String(count)} ${count === 1 ? 'order' : 'orders'}`;

function rowsOf(name: string): string[] {
  const table = screen.getByRole('table', { name });
  return within(table)
    .getAllByRole('row')
    .map((row) => row.textContent);
}

describe('ComboChart', () => {
  const data = [
    {
      label: '24 Oct',
      detail: 'Sat, 24 Oct 2026',
      area: 50_000,
      line: 2,
      previousArea: 20_000,
      previousLine: 1,
    },
    {
      label: '25 Oct',
      detail: 'Sun, 25 Oct 2026',
      area: 125_000,
      line: 5,
      previousArea: null,
      previousLine: 3,
    },
  ];

  it('names both series and their axes, and tables both values per day', () => {
    const { container } = render(
      <ComboChart
        title="Revenue and orders"
        summary="৳1750 from 7 orders"
        data={data}
        areaSeries={{ label: 'Revenue' }}
        lineSeries={{ label: 'Orders' }}
        formatArea={taka}
        formatLine={orders}
        previousLabel="Previous 2 days"
      />,
    );
    expect(container.querySelector('figcaption')?.textContent).toBe(
      'Revenue and orders. ৳1750 from 7 orders',
    );
    const legend = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(legend).toEqual(['Revenueleft axis', 'Ordersright axis', 'Previous 2 daysdashed']);

    expect(rowsOf('Revenue and orders')).toEqual([
      'DayRevenueOrdersRevenue, Previous 2 daysOrders, Previous 2 days',
      'Sat, 24 Oct 2026৳5002 orders৳2001 order',
      'Sun, 25 Oct 2026৳12505 orders—3 orders',
    ]);
    // The drawing (and its tooltips) stay out of the accessibility tree.
    const drawing = container
      .querySelector('[class*="group/plot"]')
      ?.closest('[aria-hidden="true"]');
    expect(drawing).not.toBeNull();
    expect(drawing?.textContent).toContain('Sun, 25 Oct 2026৳1250Revenue5 ordersOrders');
  });

  it('leaves the comparison out when there is none, and survives no data', () => {
    const { rerender } = render(
      <ComboChart
        title="Revenue and orders"
        data={data.map(({ label, area, line }) => ({ label, area, line }))}
        areaSeries={{ label: 'Revenue' }}
        lineSeries={{ label: 'Orders' }}
        formatArea={taka}
        formatLine={orders}
      />,
    );
    expect(rowsOf('Revenue and orders')[0]).toBe('DayRevenueOrders');
    expect(screen.queryByText('dashed')).toBeNull();

    rerender(
      <ComboChart
        title="Revenue and orders"
        data={[]}
        areaSeries={{ label: 'Revenue' }}
        lineSeries={{ label: 'Orders' }}
        formatArea={taka}
        formatLine={orders}
      />,
    );
    expect(rowsOf('Revenue and orders')).toEqual(['DayRevenueOrders']);
  });
});

describe('StackedBarChart', () => {
  const series = [
    { key: 'pending', label: 'Pending', tone: 'warning' },
    { key: 'delivered', label: 'Delivered', tone: 'success' },
  ] as const;

  it('totals each series in the legend and every stack in the table', () => {
    const { container } = render(
      <StackedBarChart
        title="Orders by status"
        series={series}
        data={[
          { label: '24 Oct', values: { pending: 2, delivered: 1 } },
          { label: '25 Oct', detail: 'Sun, 25 Oct 2026', values: { delivered: 4 } },
        ]}
      />,
    );
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Pending2',
      'Delivered5',
    ]);
    expect(rowsOf('Orders by status')).toEqual([
      'DayPendingDeliveredTotal',
      '24 Oct213',
      'Sun, 25 Oct 2026044',
    ]);
    // The first day's tooltip lists the stack top-down, then the total.
    const tooltip = screen
      .getAllByText('24 Oct')
      .find((node) => node.closest('[aria-hidden="true"]'));
    expect(tooltip?.parentElement?.textContent).toBe('24 Oct1Delivered2Pending3Total');
    // Two segments on the first day, one on the second.
    expect(container.querySelectorAll('.nz-grow-y > span')).toHaveLength(3);
  });

  it('renders an empty period without bars', () => {
    const { container } = render(
      <StackedBarChart title="Orders by status" series={series} data={[]} />,
    );
    expect(rowsOf('Orders by status')).toEqual(['DayPendingDeliveredTotal']);
    expect(container.querySelector('.nz-grow-y')).toBeNull();
  });
});

describe('Heatmap', () => {
  it('draws 7 × 24 cells, names the busiest slot and tables the slots with orders', () => {
    const { container } = render(
      <Heatmap
        title="Orders by weekday and hour"
        formatValue={orders}
        valueLabel="Orders"
        cells={[
          { weekday: 5, hour: 20, value: 12 },
          { weekday: 1, hour: 9, value: 3 },
          { weekday: 8, hour: 3, value: 99 },
        ]}
      />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(7 * 24);
    expect(container.querySelector('rect title')?.textContent).toBe('Mon 00:00–01:00: 0 orders');
    expect(screen.getByText(/^Busiest:/).textContent).toBe('Busiest: Fri 20:00–21:00 (12 orders)');
    expect(rowsOf('Orders by weekday and hour (slots with no value are left out)')).toEqual([
      'DayHourOrders',
      'Mon09:00–10:003 orders',
      'Fri20:00–21:0012 orders',
    ]);
    // The busiest cell is drawn at full strength, a quarter of it at the second step.
    const opacities = [...container.querySelectorAll('rect')]
      .map((rect) => rect.getAttribute('fill-opacity'))
      .filter(Boolean);
    expect(opacities.sort()).toEqual(['0.4', '1']);
  });

  it('says so when there is nothing to show', () => {
    render(<Heatmap title="Orders by weekday and hour" cells={[]} emptyMessage="No orders yet" />);
    expect(screen.getByText('No orders yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/^Busiest:/)).toBeNull();
  });
});

describe('Funnel', () => {
  const stages = [
    { key: 'carts', label: 'Carts', value: 200 },
    { key: 'checkouts', label: 'Checkouts', value: 50 },
    { key: 'orders', label: 'Orders', value: 40 },
  ];

  it('writes out every stage and the share that went on', () => {
    render(<Funnel title="Shopping journey" stages={stages} />);
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      'Carts200',
      '25%of carts went on to checkoutsCheckouts50',
      '80%of checkouts went on to ordersOrders40',
    ]);
    expect(screen.getByText(/overall, from carts to orders/).textContent).toBe(
      '20% overall, from carts to orders',
    );
    expect(screen.getByRole('figure').querySelector('figcaption')?.textContent).toBe(
      'Shopping journey',
    );
  });

  it('shows no conversion after an empty stage, and an empty journey honestly', () => {
    const { rerender } = render(
      <Funnel
        title="Shopping journey"
        stages={[
          { key: 'carts', label: 'Carts', value: 0 },
          { key: 'checkouts', label: 'Checkouts', value: 0 },
        ]}
        emptyMessage="No carts in this period"
      />,
    );
    expect(screen.getByText('No conversion')).toBeTruthy();
    expect(screen.getByText('No carts in this period')).toBeTruthy();

    rerender(<Funnel title="Shopping journey" stages={[]} />);
    expect(screen.getByText('Nothing recorded in this period')).toBeTruthy();
  });
});

describe('RadialProgress', () => {
  it('labels the ring with its value and target, and fills at most the whole ring', () => {
    const { container, rerender } = render(
      <RadialProgress value={0.725} label="Monthly target" targetLabel="of ৳5,00,000" />,
    );
    expect(screen.getByRole('img', { name: 'Monthly target: 72.5%, of ৳5,00,000' })).toBeTruthy();
    expect(screen.getByText('of ৳5,00,000')).toBeTruthy();
    const arc = () => container.querySelectorAll('circle[stroke="currentColor"]');
    expect(arc()[0]?.getAttribute('stroke-dasharray')).toBe('72.50 100');

    rerender(<RadialProgress value={1.2} label="Monthly target" />);
    expect(screen.getByRole('img', { name: 'Monthly target: 120%' })).toBeTruthy();
    expect(arc()[0]?.getAttribute('stroke-dasharray')).toBe('100.00 100');
  });

  it('draws an empty ring with a reason instead of a made-up zero', () => {
    const { container } = render(
      <RadialProgress value={null} label="Return rate" emptyReason="No delivered orders yet" />,
    );
    expect(
      screen.getByRole('img', { name: 'Return rate: no data. No delivered orders yet' }),
    ).toBeTruthy();
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByText('No delivered orders yet')).toBeTruthy();
    expect(container.querySelectorAll('circle[stroke="currentColor"]')).toHaveLength(0);
  });
});

describe('DonutChart', () => {
  const segments = [
    { key: 'pending', label: 'Pending', value: 3, tone: 'warning', href: '/admin' },
    { key: 'delivered', label: 'Delivered', value: 1, tone: 'success' },
  ] as const;

  it('renders the total and legend on the server', () => {
    const html = renderToString(
      <DonutChart title="Orders by status" centerLabel="orders" segments={segments} />,
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.textContent).toContain('4orders');
    expect(host.querySelectorAll('li')).toHaveLength(2);
    // The segments leave a gap between them and start where the previous one ends.
    const arcs = [...host.querySelectorAll('g circle')];
    expect(arcs.map((arc) => arc.getAttribute('stroke-dasharray'))).toEqual([
      '74.20 25.80',
      '24.20 75.80',
    ]);
    expect(arcs.map((arc) => arc.getAttribute('stroke-dashoffset'))).toEqual(['0', '-75']);
  });

  it('highlights a segment on hover and on focus of its legend link', () => {
    const { container } = render(
      <DonutChart title="Orders by status" centerLabel="orders" segments={segments} />,
    );
    const centre = () => container.querySelector('.pointer-events-none')?.textContent;
    expect(centre()).toBe('4orders');

    fireEvent.pointerEnter(screen.getByText('Delivered').closest('li')!);
    expect(centre()).toBe('1Delivered · 25%');
    fireEvent.pointerLeave(screen.getByText('Delivered').closest('li')!);
    expect(centre()).toBe('4orders');

    fireEvent.focus(screen.getByRole('link'));
    expect(centre()).toBe('3Pending · 75%');
    fireEvent.blur(screen.getByRole('link'));
    expect(centre()).toBe('4orders');
  });
});

describe('BarList and Sparkline', () => {
  it('numbers a ranking and keeps the values as text', () => {
    render(
      <BarList
        label="Top products"
        ranked
        items={[
          { key: 'a', label: 'Kurta', value: 12, display: '12 units' },
          { key: 'b', label: 'Saree', value: 6, display: '6 units' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Top products' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1Kurta12 units', '2Saree6 units']);
  });

  it('draws the area under a sparkline only when asked', () => {
    const { container, rerender } = render(<Sparkline values={[1, 3, 2]} />);
    expect(container.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelectorAll('stop')).toHaveLength(2);
    rerender(<Sparkline values={[1, 3, 2]} area={false} />);
    expect(container.querySelectorAll('path')).toHaveLength(1);
  });
});
