// @vitest-environment jsdom
/* eslint-disable @next/next/no-html-link-for-pages -- RouteProgress listens to plain anchors, so the test uses them */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChartSkeleton,
  FormSkeleton,
  InlineSpinner,
  ListSkeleton,
  LoadingOverlay,
  SectionLoader,
  StatTilesSkeleton,
} from './loaders';
import { RouteProgress } from './route-progress';

const nav = vi.hoisted(() => ({ pathname: '/admin', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

afterEach(cleanup);

describe('skeletons', () => {
  it('each announces itself once and draws the shape of what it stands for', () => {
    const { container } = render(
      <>
        <StatTilesSkeleton count={3} label="Loading figures" />
        <ChartSkeleton label="Loading chart" />
        <ListSkeleton rows={4} label="Loading list" />
        <FormSkeleton fields={3} label="Loading form" />
      </>,
    );

    for (const name of ['Loading figures', 'Loading chart', 'Loading list', 'Loading form']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getAllByRole('status')).toHaveLength(4);
    expect(container.querySelector('[data-loader="stat-tiles"]')?.children).toHaveLength(1 + 3);
    expect(
      container.querySelector('[data-loader="list"]')?.querySelectorAll('.size-10'),
    ).toHaveLength(4);
  });
});

describe('spinners and overlay', () => {
  it('only moves when motion is allowed', () => {
    const { container } = render(<InlineSpinner size="md" />);
    const classes = container.querySelector('svg')?.getAttribute('class') ?? '';
    expect(classes).toContain('motion-safe:animate-spin');
    expect(classes.split(' ')).not.toContain('animate-spin');
  });

  it('a labelled spinner is announced, an unlabelled one is not', () => {
    const { rerender } = render(<InlineSpinner label="Saving" />);
    expect(screen.getByRole('status').textContent).toBe('Saving');
    rerender(<InlineSpinner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the section loader says what it is waiting for', () => {
    render(<SectionLoader label="Loading orders" />);
    expect(screen.getByRole('status').textContent).toContain('Loading orders');
  });

  it('the overlay appears only while an action runs, leaving the content in place', () => {
    const { rerender } = render(
      <LoadingOverlay active={false} label="Saving">
        <p>Form</p>
      </LoadingOverlay>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    rerender(
      <LoadingOverlay active label="Saving">
        <p>Form</p>
      </LoadingOverlay>,
    );
    expect(screen.getByRole('status').textContent).toBe('Saving');
    expect(screen.getByText('Form')).toBeTruthy();
  });
});

describe('RouteProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nav.pathname = '/admin';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows while a link to another page is followed, finishes when the page changes, then goes', () => {
    const { container, rerender } = render(
      <>
        <RouteProgress />
        <a href="/admin/orders">Orders</a>
      </>,
    );
    expect(container.querySelector('[data-route-progress]')).toBeNull();

    fireEvent.click(screen.getByText('Orders'));
    expect(container.querySelector('[data-route-progress]')).not.toBeNull();

    nav.pathname = '/admin/orders';
    rerender(
      <>
        <RouteProgress />
        <a href="/admin/orders">Orders</a>
      </>,
    );
    expect(container.querySelector('[data-route-progress] > div')?.getAttribute('style')).toContain(
      'width: 100%',
    );
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.querySelector('[data-route-progress]')).toBeNull();
  });

  it('ignores a link to the same page, another site, a new tab and a download', () => {
    const { container } = render(
      <>
        <RouteProgress />
        <a href={window.location.pathname}>Same page</a>
        <a href="https://example.test/">Elsewhere</a>
        <a href="/admin/orders" target="_blank">
          New tab
        </a>
        <a href="/admin/export.csv" download>
          Download
        </a>
      </>,
    );
    for (const name of ['Same page', 'Elsewhere', 'New tab', 'Download']) {
      fireEvent.click(screen.getByText(name));
    }
    expect(container.querySelector('[data-route-progress]')).toBeNull();
  });

  it('gives up on a navigation that never arrives', () => {
    const { container } = render(
      <>
        <RouteProgress />
        <a href="/admin/orders">Orders</a>
      </>,
    );
    fireEvent.click(screen.getByText('Orders'));
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(container.querySelector('[data-route-progress]')).toBeNull();
  });
});
