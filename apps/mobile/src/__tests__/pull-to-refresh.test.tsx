import { useQuery } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { RefreshableScrollView } from '../components/pull-to-refresh/pull-to-refresh';
import { REFRESH_LABELS } from '../components/pull-to-refresh/refresh-indicator';
import { Screen } from '../components/screen';
import {
  REFRESH_MAX_MS,
  REFRESH_MIN_MS,
  refreshFailed,
  useManualRefresh,
  type RefreshOutcome,
} from '../query/use-manual-refresh';
import { listActions, refreshList } from '../test-utils/refresh';
import { renderWithProviders } from '../test-utils/render-with-providers';

async function advance(ms: number): Promise<void> {
  const step = 50;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
    });
  }
}

/**
 * How visible the indicator is. It is hidden from assistive technology (the sentences are
 * announced, not drawn), so it counts as a "hidden" element for queries, and "gone" now means
 * fully transparent rather than unmounted.
 */
function indicatorOpacity(): number {
  const node = screen.getByTestId('refresh-indicator-stack', { includeHiddenElements: true });
  const style = StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>);
  return typeof style?.opacity === 'number' ? style.opacity : 1;
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('refreshFailed', () => {
  it('reads TanStack refetch results, alone or from Promise.all', () => {
    expect(refreshFailed({ isError: false, status: 'success' })).toBe(false);
    expect(refreshFailed({ isError: true })).toBe(true);
    expect(refreshFailed([{ status: 'success' }, { status: 'error' }])).toBe(true);
    expect(refreshFailed([undefined, { isError: false }])).toBe(false);
    expect(refreshFailed(undefined)).toBe(false);
  });
});

describe('useManualRefresh', () => {
  it('runs one refresh at a time; a second request is answered busy', async () => {
    let finish: () => void = () => undefined;
    const refetch = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = await renderHook(() => useManualRefresh(refetch));
    let first: Promise<RefreshOutcome> = Promise.resolve('cancelled');
    let second: RefreshOutcome = 'cancelled';
    await act(async () => {
      first = result.current.onRefresh();
      second = await result.current.onRefresh();
    });
    expect(second).toBe('busy');
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    finish();
    await advance(REFRESH_MIN_MS);
    expect(await first).toBe('updated');
    expect(result.current.refreshing).toBe(false);
  });

  it('stays visible for the minimum time, so a fast answer does not flicker', async () => {
    const { result } = await renderHook(() => useManualRefresh(() => Promise.resolve()));
    let outcome: Promise<RefreshOutcome> = Promise.resolve('cancelled');
    await act(async () => {
      outcome = result.current.onRefresh();
      await Promise.resolve();
    });
    await advance(REFRESH_MIN_MS - 100);
    expect(result.current.refreshing).toBe(true);
    await advance(150);
    expect(result.current.refreshing).toBe(false);
    expect(await outcome).toBe('updated');
  });

  it('gives up at the maximum and reports a failure, never a success', async () => {
    const { result } = await renderHook(() => useManualRefresh(() => new Promise(() => undefined)));
    let outcome: Promise<RefreshOutcome> = Promise.resolve('cancelled');
    await act(async () => {
      outcome = result.current.onRefresh();
      await Promise.resolve();
    });
    await advance(REFRESH_MAX_MS - 100);
    expect(result.current.refreshing).toBe(true);
    await advance(200);
    expect(result.current.refreshing).toBe(false);
    expect(await outcome).toBe('failed');
  });

  it('reports a rejected refetch, or one whose result is an error, as failed', async () => {
    const rejecting = await renderHook(() =>
      useManualRefresh(() => Promise.reject(new Error('offline'))),
    );
    let outcome: Promise<RefreshOutcome> = Promise.resolve('cancelled');
    await act(async () => {
      outcome = rejecting.result.current.onRefresh();
      await Promise.resolve();
    });
    await advance(REFRESH_MIN_MS);
    expect(await outcome).toBe('failed');

    const erroring = await renderHook(() =>
      useManualRefresh(() => Promise.resolve([{ isError: false }, { isError: true }])),
    );
    await act(async () => {
      outcome = erroring.result.current.onRefresh();
      await Promise.resolve();
    });
    await advance(REFRESH_MIN_MS);
    expect(await outcome).toBe('failed');
  });

  it('reports cancelled, and sets nothing, once the screen has gone', async () => {
    const error = jest.spyOn(console, 'error');
    const { result, unmount } = await renderHook(() =>
      useManualRefresh(() => new Promise((resolve) => setTimeout(resolve, 2000))),
    );
    let outcome: Promise<RefreshOutcome> = Promise.resolve('updated');
    await act(async () => {
      outcome = result.current.onRefresh();
      await Promise.resolve();
    });
    await unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2500);
    });
    expect(await outcome).toBe('cancelled');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('RefreshableScrollView', () => {
  it('refreshes once, says so, shows the outcome and settles back', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onRefresh = jest.fn(() => Promise.resolve<RefreshOutcome>('updated'));
    await render(
      <RefreshableScrollView testID="list" onRefresh={onRefresh}>
        <Text>content</Text>
      </RefreshableScrollView>,
    );
    await refreshList('list');
    await refreshList('list');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(REFRESH_LABELS.refreshing);

    await advance(10);
    expect(indicatorOpacity()).toBeGreaterThan(0);
    expect(announce).toHaveBeenCalledWith(REFRESH_LABELS.updated);
    expect(screen.getByText('content')).toBeOnTheScreen();

    await advance(1200);
    // Settled: it can be refreshed again.
    await refreshList('list');
    expect(onRefresh).toHaveBeenCalledTimes(2);
    announce.mockRestore();
  });

  it('shows the logo and ring only — the status line is never drawn', async () => {
    const onRefresh = jest.fn(() => Promise.resolve<RefreshOutcome>('updated'));
    await render(
      <RefreshableScrollView testID="list" onRefresh={onRefresh}>
        <Text>content</Text>
      </RefreshableScrollView>,
    );
    await refreshList('list');
    await advance(10);
    // The indicator is on screen, and none of the spoken sentences is rendered as text.
    expect(indicatorOpacity()).toBeGreaterThan(0);
    for (const sentence of Object.values(REFRESH_LABELS)) {
      expect(screen.queryByText(sentence, { includeHiddenElements: true })).toBeNull();
    }
    expect(
      screen.queryByText(/Refreshing|Updated|Release to refresh/u, {
        includeHiddenElements: true,
      }),
    ).toBeNull();
    await advance(1500);
  });

  it('keeps the content and collapses without a success when the refresh fails', async () => {
    const onRefresh = jest.fn(() => Promise.resolve<RefreshOutcome>('failed'));
    await render(
      <RefreshableScrollView testID="list" onRefresh={onRefresh}>
        <Text>content</Text>
      </RefreshableScrollView>,
    );
    await refreshList('list');
    await advance(10);
    expect(indicatorOpacity()).toBeGreaterThan(0);
    expect(screen.getByText('content')).toBeOnTheScreen();
    await advance(2500);
    expect(indicatorOpacity()).toBe(0);
  });

  it('never stays on screen for a refresh that does not answer', async () => {
    await render(
      <RefreshableScrollView testID="list" onRefresh={() => new Promise(() => undefined)}>
        <Text>content</Text>
      </RefreshableScrollView>,
    );
    await refreshList('list');
    await advance(10_500);
    expect(indicatorOpacity()).toBeGreaterThan(0);
    await advance(1000);
    // Past the safety timeout it reports a failure rather than spinning for ever.
    await advance(2500);
    expect(indicatorOpacity()).toBe(0);
  });

  it('offers nothing while paused (Search, while typing)', async () => {
    const onRefresh = jest.fn();
    await render(
      <RefreshableScrollView testID="list" onRefresh={onRefresh} refreshEnabled={false}>
        <Text>content</Text>
      </RefreshableScrollView>,
    );
    expect(listActions('list')).toEqual([]);
    await refreshList('list');
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('forgets a refresh that finishes after the screen has gone', async () => {
    const error = jest.spyOn(console, 'error');
    let finish: (value: RefreshOutcome) => void = () => undefined;
    const view = await render(
      <RefreshableScrollView
        testID="list"
        onRefresh={() =>
          new Promise<RefreshOutcome>((resolve) => {
            finish = resolve;
          })
        }
      >
        <Text>content</Text>
      </RefreshableScrollView>,
    );
    await refreshList('list');
    await view.unmount();
    await act(async () => {
      finish('updated');
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('a screen refresh', () => {
  it("refetches the screen's own query, and only that", async () => {
    const mine = jest.fn(() => Promise.resolve('mine'));
    const other = jest.fn(() => Promise.resolve('other'));

    function Probe() {
      const query = useQuery({ queryKey: ['test', 'mine'], queryFn: mine });
      useQuery({ queryKey: ['test', 'other'], queryFn: other });
      const { onRefresh } = useManualRefresh(query.refetch);
      return (
        <Screen testID="scroll" onRefresh={onRefresh}>
          <Text>{query.data ?? 'loading'}</Text>
        </Screen>
      );
    }

    await renderWithProviders(<Probe />);
    await advance(50);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);

    await refreshList('scroll');
    await advance(REFRESH_MIN_MS + 50);
    expect(mine).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });
});
