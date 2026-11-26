// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { Banknote } from 'lucide-react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountUp, countUpFrame, easeOut } from './count-up';
import { KpiCard } from './kpi-card';

/** The three spans: width reserve, moving digits, screen-reader figure. */
function parts(container: HTMLElement) {
  const [reserve, visible, spoken] = [...(container.firstElementChild?.children ?? [])];
  return { reserve, visible, spoken };
}

let frames: FrameRequestCallback[] = [];

function reducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query })),
  );
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function runFrame(time: number) {
  const next = frames.shift();
  if (!next) throw new Error('no animation frame was requested');
  act(() => next(time));
}

describe('CountUp', () => {
  it('renders the final figure on the server, for no-JS and screen readers', () => {
    const html = renderToString(<CountUp value={12_500_000} kind="money" />);
    const host = document.createElement('div');
    host.innerHTML = html;
    const { reserve, visible, spoken } = parts(host);
    expect(visible?.textContent).toBe('৳1,25,000');
    expect(visible?.getAttribute('aria-hidden')).toBe('true');
    expect(reserve?.getAttribute('aria-hidden')).toBe('true');
    expect(spoken?.textContent).toBe('৳1,25,000');
    expect(spoken?.className).toBe('sr-only');
    expect(host.querySelector('[aria-live]')).toBeNull();
  });

  it('holds still under prefers-reduced-motion', () => {
    reducedMotion(true);
    const { container } = render(<CountUp value={1_204} kind="count" />);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(parts(container).visible?.textContent).toBe('1,204');
  });

  it('counts up from zero to the exact figure, easing out', () => {
    reducedMotion(false);
    const { container } = render(<CountUp value={12_500_050} kind="money" durationMs={700} />);
    const visible = () => parts(container).visible?.textContent;

    runFrame(1_000);
    expect(visible()).toBe('৳0');
    runFrame(1_350);
    // Halfway in time is 87.5% of the way there (ease-out), in whole taka.
    expect(visible()).toBe('৳1,09,375');
    runFrame(1_700);
    expect(visible()).toBe('৳1,25,000.50');
    expect(frames).toHaveLength(0);
    // Assistive technology only ever had the final figure.
    expect(screen.getByText('৳1,25,000.50', { selector: '.sr-only' })).toBeTruthy();
  });

  it('formats every frame at the precision of its kind', () => {
    expect(countUpFrame(12_345, 0.5, 'money')).toBe(6_200);
    expect(countUpFrame(7, 0.5, 'count')).toBe(4);
    expect(countUpFrame(0.4567, 0.5, 'percent')).toBe(0.228);
    expect(countUpFrame(0.4567, 1, 'percent')).toBe(0.4567);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(0.5)).toBe(0.875);
    expect(easeOut(2)).toBe(1);
  });
});

describe('KpiCard with a count-up', () => {
  it('shows the animated figure in place of a preformatted value', () => {
    render(
      <KpiCard
        label="Orders"
        animate={{ value: 1_204, kind: 'count' }}
        icon={Banknote}
        trend={[1, 4, 2]}
      />,
    );
    expect(screen.getByText('1,204', { selector: '.sr-only' })).toBeTruthy();
    expect(screen.getByText('Orders')).toBeTruthy();
  });
});
