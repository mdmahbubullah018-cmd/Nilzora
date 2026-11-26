import { ApiError } from '@nilzora/api-client';
import { QueryClient } from '@tanstack/react-query';
import {
  isOnline,
  PROBE_FIRST_DELAY_MS,
  PROBE_MAX_DELAY_MS,
  reportConnection,
  resetConnection,
  startConnectivity,
} from '@/network/connectivity';

function networkFailure(): ApiError {
  return new ApiError(0, 'network_error', 'offline');
}

describe('connectivity', () => {
  let client: QueryClient;
  beforeEach(() => {
    jest.useFakeTimers();
    resetConnection();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    client.clear();
    jest.useRealTimers();
  });

  it('goes offline only when a request really could not reach the server', async () => {
    // fetchQuery needs the real clock; the monitor is stopped before any probe is due.
    jest.useRealTimers();
    const probe = jest.fn().mockResolvedValue(false);
    const { stop } = startConnectivity(client, probe);

    await client
      .fetchQuery({
        queryKey: ['a'],
        queryFn: () => Promise.reject(new ApiError(500, 'server_error', 'x')),
      })
      .catch(() => undefined);
    await client
      .fetchQuery({
        queryKey: ['b'],
        queryFn: () => Promise.reject(new ApiError(0, 'timeout', 'slow')),
      })
      .catch(() => undefined);
    expect(isOnline()).toBe(true);

    await client
      .fetchQuery({ queryKey: ['c'], queryFn: () => Promise.reject(networkFailure()) })
      .catch(() => undefined);
    expect(isOnline()).toBe(false);
    stop();
  });

  it('probes with backoff while offline, then comes back online on the first answer', async () => {
    const probe = jest.fn().mockResolvedValue(false);
    const { stop } = startConnectivity(client, probe);
    reportConnection(false);

    await jest.advanceTimersByTimeAsync(PROBE_FIRST_DELAY_MS - 1);
    expect(probe).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(1);
    // The next look waits twice as long, never faster.
    await jest.advanceTimersByTimeAsync(PROBE_FIRST_DELAY_MS * 2 - 1);
    expect(probe).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(isOnline()).toBe(false);

    probe.mockResolvedValue(true);
    await jest.advanceTimersByTimeAsync(PROBE_MAX_DELAY_MS);
    expect(isOnline()).toBe(true);
    // Online again: no more probing.
    const calls = probe.mock.calls.length;
    await jest.advanceTimersByTimeAsync(PROBE_MAX_DELAY_MS * 3);
    expect(probe.mock.calls.length).toBe(calls);
    stop();
  });

  it('retryNow looks at once, and a successful request also restores the connection', async () => {
    jest.useRealTimers();
    const probe = jest.fn().mockResolvedValue(true);
    const { stop, retryNow } = startConnectivity(client, probe);
    reportConnection(false);
    expect(await retryNow()).toBe(true);
    expect(isOnline()).toBe(true);

    reportConnection(false);
    // A request that reaches the server proves the connection (mutations run even while the
    // app believes it is offline, which is how a customer's own action finds out).
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.resolve(1), networkMode: 'always' })
      .execute(undefined);
    expect(isOnline()).toBe(true);
    stop();
  });

  it('treats a failing or hanging probe as still offline', async () => {
    const probe = jest.fn().mockRejectedValue(new Error('boom'));
    const { stop, retryNow } = startConnectivity(client, probe);
    reportConnection(false);
    expect(await retryNow()).toBe(false);
    expect(isOnline()).toBe(false);
    stop();
  });
});
