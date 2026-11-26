import { ApiError } from '@nilzora/api-client';
import { useQuery } from '@tanstack/react-query';
import { PackageOpen } from 'lucide-react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SessionEndedError } from '../auth/session-manager';
import { queryKeys } from '../query/query-keys';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';
import {
  QueryState,
  QueryStateView,
  queryViewState,
  type QueryStateSource,
} from '../components/query-state';

function source<T>(overrides: Partial<QueryStateSource<T>>): QueryStateSource<T> {
  return {
    status: 'pending',
    data: undefined,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

const EMPTY = { icon: PackageOpen, title: 'No orders yet', description: 'Orders appear here.' };

describe('QueryState', () => {
  it('shows an accessible loading placeholder while pending', async () => {
    await render(
      <QueryState query={source<string[]>({})} loadingLabel="Loading your orders">
        {() => <Text>data</Text>}
      </QueryState>,
    );

    expect(screen.getByRole('progressbar', { name: 'Loading your orders' })).toBeBusy();
    expect(screen.queryByText('data')).not.toBeOnTheScreen();
  });

  it('can show a custom placeholder', async () => {
    await render(
      <QueryState query={source<string[]>({})} skeleton={<Text>custom skeleton</Text>}>
        {() => null}
      </QueryState>,
    );

    expect(screen.getByText('custom skeleton')).toBeOnTheScreen();
  });

  it('renders the data once loaded', async () => {
    await render(
      <QueryState query={source<string[]>({ status: 'success', data: ['a', 'b'] })}>
        {(items) => <Text>{items.join('+')}</Text>}
      </QueryState>,
    );

    expect(screen.getByText('a+b')).toBeOnTheScreen();
  });

  it('shows the empty state for an empty list, with its action', async () => {
    await render(
      <QueryState
        query={source<string[]>({ status: 'success', data: [] })}
        empty={{ ...EMPTY, action: <Text>Start shopping</Text> }}
      >
        {() => <Text>data</Text>}
      </QueryState>,
    );

    expect(screen.getByRole('header', { name: 'No orders yet' })).toBeOnTheScreen();
    expect(screen.getByText('Orders appear here.')).toBeOnTheScreen();
    expect(screen.getByText('Start shopping')).toBeOnTheScreen();
    expect(screen.queryByText('data')).not.toBeOnTheScreen();
  });

  it('lets the caller decide what empty means', async () => {
    const query = source<{ items: number[] }>({ status: 'success', data: { items: [] } });
    await render(
      <QueryState query={query} isEmpty={(data) => data.items.length === 0} empty={EMPTY}>
        {() => <Text>data</Text>}
      </QueryState>,
    );

    expect(screen.getByText('No orders yet')).toBeOnTheScreen();
  });

  it('renders empty data as ready when no empty state is given', async () => {
    await render(
      <QueryState query={source<string[]>({ status: 'success', data: [] })}>
        {(items) => <Text>{`${items.length} rows`}</Text>}
      </QueryState>,
    );

    expect(screen.getByText('0 rows')).toBeOnTheScreen();
  });

  it('shows a friendly error with Try again for a connection failure, and retries', async () => {
    const user = userEvent.setup();
    const refetch = jest.fn();
    await render(
      <QueryState
        query={source<string[]>({
          status: 'error',
          error: new ApiError(0, 'network_error', 'raw API text'),
          refetch,
        })}
      >
        {() => null}
      </QueryState>,
    );

    expect(screen.getByRole('header', { name: 'Nilzora could not be reached' })).toBeOnTheScreen();
    expect(screen.queryByText(/raw API text/)).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not found', new ApiError(404, 'not_found', 'x')],
    ['an ended session', new SessionEndedError()],
    ['a validation failure', new ApiError(400, 'validation_failed', 'x')],
  ])('offers no retry for %s', async (_name, error) => {
    await render(
      <QueryState query={source<string[]>({ status: 'error', error })}>{() => null}</QueryState>,
    );

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
  });

  it('keeps data on screen when a refresh fails, with a warning and a retry', async () => {
    const user = userEvent.setup();
    const refetch = jest.fn();
    await render(
      <QueryState
        query={source<string[]>({
          status: 'error',
          data: ['kept'],
          error: new ApiError(0, 'timeout', 'x'),
          refetch,
        })}
      >
        {(items) => <Text>{items[0]}</Text>}
      </QueryState>,
    );

    expect(screen.getByText('kept')).toBeOnTheScreen();
    expect(screen.getByText('Could not refresh')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('marks the retry button busy while a retry runs', async () => {
    await render(
      <QueryState
        query={source<string[]>({
          status: 'error',
          error: new ApiError(503, 'service_unavailable', 'x'),
          isRefetching: true,
        })}
      >
        {() => null}
      </QueryState>,
    );

    expect(screen.getByRole('button', { name: 'Try again' })).toBeBusy();
  });
});

describe('QueryState with a real React Query result', () => {
  it('shows the error, retries through refetch, then shows the data', async () => {
    const api = createFakeApiClient();
    api.listCategories
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'x'))
      .mockResolvedValueOnce({
        categories: [
          {
            slug: 'tea',
            name: 'Tea',
            description: null,
            productCount: 3,
            image: null,
            parentSlug: null,
            depth: 1,
            isFeatured: false,
          },
        ],
      });
    function Categories() {
      const query = useQuery({
        queryKey: queryKeys.catalog.categories(),
        queryFn: () => api.listCategories(),
      });
      return (
        <QueryState query={query} isEmpty={(data) => data.categories.length === 0}>
          {(data) => <Text>{data.categories[0]?.name}</Text>}
        </QueryState>
      );
    }
    const { user } = await renderWithProviders(<Categories />, { api });

    expect(
      await screen.findByRole('header', { name: 'Nilzora could not be reached' }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Tea')).toBeOnTheScreen();
    expect(api.listCategories).toHaveBeenCalledTimes(2);
  });
});

describe('queryViewState', () => {
  it('maps a query to one of four views', () => {
    expect(queryViewState({ status: 'pending', data: undefined })).toBe('loading');
    expect(queryViewState({ status: 'error', data: undefined })).toBe('error');
    expect(queryViewState({ status: 'success', data: [] })).toBe('empty');
    expect(queryViewState({ status: 'success', data: [1] })).toBe('ready');
    // Stale data with a failed refresh, or placeholder data while loading, is still shown.
    expect(queryViewState({ status: 'error', data: [1] })).toBe('ready');
    expect(queryViewState({ status: 'pending', data: [1] })).toBe('ready');
    expect(queryViewState({ status: 'success', data: { n: 0 } }, (d) => d.n === 0)).toBe('empty');
  });
});

describe('QueryStateView', () => {
  it('renders each view explicitly (for FlatList empty components)', async () => {
    const { rerender } = await render(<QueryStateView state="loading" />);
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();

    await rerender(<QueryStateView state="empty" empty={EMPTY} />);
    expect(screen.getByText('No orders yet')).toBeOnTheScreen();

    await rerender(<QueryStateView state="error" error={new ApiError(0, 'timeout', 'x')} />);
    expect(screen.getByText('This is taking too long')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen(); // no onRetry

    await rerender(
      <QueryStateView state="ready">
        <Text>content</Text>
      </QueryStateView>,
    );
    expect(screen.getByText('content')).toBeOnTheScreen();
  });
});
