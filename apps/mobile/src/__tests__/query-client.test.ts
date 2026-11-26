import { ApiError } from '@nilzora/api-client';
import { hashKey, QueryObserver, type QueryClient } from '@tanstack/react-query';
import { SessionEndedError } from '../auth/session-manager';
import {
  createAppQueryClient,
  MAX_QUERY_RETRIES,
  QUERY_GC_TIME_MS,
  QUERY_STALE_TIME_MS,
  queryRetryDelay,
  shouldRetryQuery,
} from '../query/query-client';
import { ANONYMOUS_USER, queryKeys, USER_QUERY_ROOT } from '../query/query-keys';

const network = () => new ApiError(0, 'network_error', 'x');
const timeout = () => new ApiError(0, 'timeout', 'x');
const server = (status = 500) => new ApiError(status, 'internal_error', 'x');

describe('retry policy', () => {
  it('retries a lost connection, a timeout and a server error up to twice', () => {
    for (const error of [network(), timeout(), server(500), server(503)]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
    }
    expect(MAX_QUERY_RETRIES).toBe(2);
  });

  it.each([400, 401, 403, 404, 409, 422, 429])('never retries a %i', (status) => {
    expect(shouldRetryQuery(0, new ApiError(status, 'whatever', 'x'))).toBe(false);
  });

  it('does not retry an ended session, a bad response or an unexpected error', () => {
    expect(shouldRetryQuery(0, new SessionEndedError())).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(200, 'invalid_response', 'x'))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(0, 'invalid_request', 'x'))).toBe(false);
    expect(shouldRetryQuery(0, new TypeError('bug'))).toBe(false);
  });

  it('backs off: 1 s, 2 s, capped at 8 s', () => {
    expect([0, 1, 2, 3, 4, 10].map(queryRetryDelay)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });
});

describe('createAppQueryClient', () => {
  it('uses short staleness, a 10 minute cache and no automatic mutation retries', () => {
    const defaults = createAppQueryClient().getDefaultOptions();

    expect(defaults.queries).toMatchObject({
      staleTime: QUERY_STALE_TIME_MS,
      gcTime: QUERY_GC_TIME_MS,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    });
    expect(QUERY_STALE_TIME_MS).toBe(30_000);
    expect(QUERY_GC_TIME_MS).toBe(600_000);
    expect(defaults.mutations?.retry).toBe(false);
  });

  /** Runs a query through the client's own defaults (instant retries) and counts attempts. */
  async function attempts(client: QueryClient, error: Error): Promise<number> {
    client.setDefaultOptions({
      ...client.getDefaultOptions(),
      queries: { ...client.getDefaultOptions().queries, retryDelay: 0 },
    });
    let calls = 0;
    const observer = new QueryObserver(client, {
      queryKey: ['retry-test'],
      queryFn: () => {
        calls += 1;
        return Promise.reject(error);
      },
    });
    await new Promise<void>((resolve) => {
      const unsubscribe = observer.subscribe((result) => {
        if (result.status === 'error') {
          unsubscribe();
          resolve();
        }
      });
    });
    client.clear();
    return calls;
  }

  it('makes three attempts in total for a connection failure', async () => {
    expect(await attempts(createAppQueryClient(), network())).toBe(1 + MAX_QUERY_RETRIES);
  });

  it('makes one attempt for a 4xx', async () => {
    expect(await attempts(createAppQueryClient(), new ApiError(404, 'not_found', 'x'))).toBe(1);
  });
});

describe('queryKeys', () => {
  const item = { productId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', quantity: 2 };

  it('treats blank and missing filters alike, so equal requests share a cache entry', () => {
    const a = hashKey(queryKeys.catalog.products({ page: 1, q: '   ', category: undefined }));
    const b = hashKey(queryKeys.catalog.products({ page: 1 }));
    const c = hashKey(queryKeys.catalog.products({ page: 1, q: ' shirt ' }));
    expect(a).toBe(b);
    expect(c).toBe(hashKey(queryKeys.catalog.products({ q: 'shirt', page: 1 })));
    expect(c).not.toBe(a);
  });

  it('keeps one-page and endless listings apart', () => {
    expect(hashKey(queryKeys.catalog.products({ category: 'tea' }))).not.toBe(
      hashKey(queryKeys.catalog.productFeed({ category: 'tea' })),
    );
  });

  it('keys a cart quote by product ids and quantities only', () => {
    const withExtras = { ...item, price: 1, name: 'x' } as typeof item;
    expect(hashKey(queryKeys.cart.quote([withExtras]))).toBe(hashKey(queryKeys.cart.quote([item])));
    expect(hashKey(queryKeys.cart.quote([{ ...item, quantity: 3 }]))).not.toBe(
      hashKey(queryKeys.cart.quote([item])),
    );
  });

  it('puts every signed-in account query under ["user", userId]', () => {
    const keys = [
      queryKeys.checkout.quote('u1', [item], 'addr'),
      queryKeys.addresses.all('u1'),
      queryKeys.addresses.list('u1'),
      queryKeys.orders.all('u1'),
      queryKeys.orders.list('u1', { page: 2 }),
      queryKeys.orders.feed('u1'),
      queryKeys.orders.detail('u1', 'NZ100042'),
    ];
    for (const key of keys) expect(key.slice(0, 2)).toEqual([USER_QUERY_ROOT, 'u1']);
  });

  it('never shares an account query between users', () => {
    expect(hashKey(queryKeys.orders.list('u1', { page: 1 }))).not.toBe(
      hashKey(queryKeys.orders.list('u2', { page: 1 })),
    );
    expect(hashKey(queryKeys.orders.detail('u1', 'NZ100042'))).not.toBe(
      hashKey(queryKeys.orders.detail('u2', 'NZ100042')),
    );
    expect(hashKey(queryKeys.addresses.list('u1'))).not.toBe(
      hashKey(queryKeys.addresses.list('u2')),
    );
  });

  it('gives a signed-out screen a fixed key that no real account shares', () => {
    expect(queryKeys.orders.all(null)).toEqual([USER_QUERY_ROOT, ANONYMOUS_USER, 'orders']);
    expect(hashKey(queryKeys.orders.all(null))).not.toBe(hashKey(queryKeys.orders.all('u1')));
  });

  it('has public catalog and cart keys outside the user branch', () => {
    expect(queryKeys.catalog.categories()[0]).toBe('catalog');
    expect(queryKeys.catalog.product('mug')).toEqual(['catalog', 'product', 'mug']);
    expect(queryKeys.cart.quote([item])[0]).toBe('cart');
  });
});
