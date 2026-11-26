import { ApiError } from '@nilzora/api-client';
import { focusManager, useQuery, type QueryClient } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { useSignedInUserId } from '../auth/session-context';
import { SessionEndedError } from '../auth/session-manager';
import { ApiNotConfiguredError } from '../lib/errors';
import { queryKeys } from '../query/query-keys';
import { useAuthorizedApi } from '../query/use-authorized-api';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderHookWithProviders, renderWithProviders } from '../test-utils/render-with-providers';
import { CUSTOMER, FAKE_ACCESS_TOKEN, signedInState } from '../test-utils/session-fakes';

const USER_A = CUSTOMER.user.id;
const USER_B = '11111111-2222-4333-8444-555555555555';
const ORDER = { order: { orderNumber: 'NZ100001' } } as never;

/** Loads one account-scoped query and one public query, and shows both statuses. */
function Probe() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const order = useQuery({
    queryKey: queryKeys.orders.detail(userId, 'NZ100001'),
    queryFn: () => run((api, token) => api.getOrder(token, 'NZ100001')),
    enabled: userId !== null,
  });
  const categories = useQuery({
    queryKey: queryKeys.catalog.categories(),
    queryFn: () => Promise.resolve({ categories: [] }),
  });
  return <Text>{`order:${order.status} categories:${categories.status}`}</Text>;
}

function userEntries(client: QueryClient) {
  return client.getQueryCache().findAll({ queryKey: ['user'] });
}

function holdsData(client: QueryClient, userId: string) {
  return client.getQueryData(queryKeys.orders.detail(userId, 'NZ100001')) !== undefined;
}

describe('account-scoped cache', () => {
  async function setup() {
    const api = createFakeApiClient();
    api.getOrder.mockResolvedValue(ORDER);
    const harness = await renderWithProviders(<Probe />, {
      api,
      session: signedInState(USER_A),
    });
    expect(await screen.findByText('order:success categories:success')).toBeOnTheScreen();
    return { ...harness, api };
  }

  it('loads account data through the session, under the account id', async () => {
    const { api, queryClient } = await setup();

    expect(api.getOrder).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, 'NZ100001');
    expect(userEntries(queryClient).map((query) => query.queryKey)).toEqual([
      ['user', USER_A, 'orders', 'detail', 'NZ100001'],
    ]);
  });

  it("removes the previous account's data when a different account signs in", async () => {
    const { queryClient, setSession, api } = await setup();

    await setSession(signedInState(USER_B));
    expect(holdsData(queryClient, USER_A)).toBe(false);
    expect(await screen.findByText('order:success categories:success')).toBeOnTheScreen();

    expect(userEntries(queryClient).map((query) => query.queryKey[1])).toEqual([USER_B]);
    expect(api.getOrder).toHaveBeenCalledTimes(2);
  });

  it('removes all account data on sign-out but keeps the public catalog', async () => {
    const { queryClient, setSession } = await setup();

    await setSession({ status: 'signed_out' });

    expect(holdsData(queryClient, USER_A)).toBe(false);
    // Only the disabled, empty "anonymous" entry may remain; no account data.
    expect(userEntries(queryClient).every((query) => query.state.data === undefined)).toBe(true);
    expect(queryClient.getQueryData(queryKeys.catalog.categories())).toEqual({ categories: [] });
    expect(screen.getByText('order:pending categories:success')).toBeOnTheScreen();
  });

  it.each([
    ['restoring', { status: 'restoring' } as const],
    ['offline', { status: 'offline' } as const],
    ['suspended', { status: 'suspended' } as const],
  ])('keeps the data while the session is only %s', async (_name, state) => {
    const { queryClient, setSession } = await setup();

    await setSession(state);

    expect(holdsData(queryClient, USER_A)).toBe(true);
  });

  it('keeps the data when the same account is signed in again (profile saved)', async () => {
    const { queryClient, setSession, api } = await setup();

    await setSession({
      status: 'signed_in',
      user: {
        ...CUSTOMER.user,
        id: USER_A,
        profile: { ...CUSTOMER.user.profile, fullName: 'Renamed' },
      },
    });

    expect(holdsData(queryClient, USER_A)).toBe(true);
    expect(api.getOrder).toHaveBeenCalledTimes(1);
  });

  it('clears the previous account even if the next one signs in without signing out first', async () => {
    const { queryClient, setSession } = await setup();

    await setSession({ status: 'restoring' });
    await setSession(signedInState(USER_B));

    expect(holdsData(queryClient, USER_A)).toBe(false);
  });
});

describe('foreground refetching', () => {
  // React Native's Jest preset already makes addEventListener a mock; capture the handler.
  const addEventListener = jest.spyOn(AppState, 'addEventListener');
  const defaultImplementation = addEventListener.getMockImplementation();
  let handlers: ((status: AppStateStatus) => void)[];
  let remove: jest.Mock;

  beforeEach(() => {
    handlers = [];
    remove = jest.fn();
    addEventListener.mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove };
    });
  });

  afterEach(() => {
    if (defaultImplementation) addEventListener.mockImplementation(defaultImplementation);
    focusManager.setFocused(undefined);
  });

  async function emit(status: AppStateStatus) {
    await act(() => {
      handlers[0]?.(status);
    });
  }

  it('follows the app state: focused only while active', async () => {
    const { unmount } = await renderHookWithProviders(() => null);
    expect(handlers).toHaveLength(1);

    await emit('background');
    expect(focusManager.isFocused()).toBe(false);
    await emit('inactive');
    expect(focusManager.isFocused()).toBe(false);
    await emit('active');
    expect(focusManager.isFocused()).toBe(true);

    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('refetches stale data when the app returns to the foreground', async () => {
    const fetchCategories = jest.fn(() => Promise.resolve({ categories: [] }));
    function Categories() {
      const { status } = useQuery({
        queryKey: queryKeys.catalog.categories(),
        queryFn: fetchCategories,
      });
      return <Text>{status}</Text>;
    }
    await renderWithProviders(<Categories />);
    await screen.findByText('success');
    expect(fetchCategories).toHaveBeenCalledTimes(1);

    await emit('background');
    await emit('active');

    expect(fetchCategories).toHaveBeenCalledTimes(2);
  });
});

describe('useAuthorizedApi', () => {
  it("runs the call with the client and the session's access token", async () => {
    const api = createFakeApiClient();
    api.listAddresses.mockResolvedValue({ addresses: [] });
    const { result } = await renderHookWithProviders(() => useAuthorizedApi(), { api });

    await expect(result.current((client, token) => client.listAddresses(token))).resolves.toEqual({
      addresses: [],
    });

    expect(api.listAddresses).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN);
  });

  it("rejects with the call's own error", async () => {
    const api = createFakeApiClient();
    api.listAddresses.mockRejectedValue(new ApiError(403, 'forbidden', 'x'));
    const { result } = await renderHookWithProviders(() => useAuthorizedApi(), { api });

    await expect(
      result.current((client, token) => client.listAddresses(token)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects with SessionEndedError when nobody is signed in, without calling the API', async () => {
    const api = createFakeApiClient();
    const { result } = await renderHookWithProviders(() => useAuthorizedApi(), {
      api,
      session: { status: 'signed_out' },
    });

    await expect(
      result.current((client, token) => client.listAddresses(token)),
    ).rejects.toBeInstanceOf(SessionEndedError);
    expect(api.listAddresses).not.toHaveBeenCalled();
  });

  it.each([
    ['no API address', { api: null }],
    ['no session manager', { session: null }],
  ])('rejects with ApiNotConfiguredError for %s', async (_name, options) => {
    const { result } = await renderHookWithProviders(() => useAuthorizedApi(), options);

    await expect(
      result.current((client, token) => client.listAddresses(token)),
    ).rejects.toBeInstanceOf(ApiNotConfiguredError);
  });

  it('keeps its identity between renders', async () => {
    const { result, rerender } = await renderHookWithProviders(() => useAuthorizedApi());
    const first = result.current;

    await rerender(undefined);

    expect(result.current).toBe(first);
  });
});
