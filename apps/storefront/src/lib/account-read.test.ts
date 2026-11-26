// @vitest-environment node
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeRead } from '@/testing/commerce-fixtures';
import { readAccount } from './account-read';

const api = vi.hoisted(() => ({ getOrder: vi.fn<() => Promise<string>>() }));

vi.mock('@/lib/session', () => ({
  session: {
    read: <T>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));

const call = () => readAccount(() => api.getOrder());

beforeEach(() => {
  api.getOrder.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('readAccount', () => {
  it('passes answers and the session outcomes through', async () => {
    api.getOrder.mockResolvedValueOnce('order');
    expect(await call()).toStrictEqual({ kind: 'ok', value: 'order' });

    api.getOrder.mockRejectedValueOnce(apiError(401, 'unauthenticated'));
    expect(await call()).toStrictEqual({ kind: 'signed_out' });

    api.getOrder.mockRejectedValueOnce(apiError(0, 'timeout'));
    expect(await call()).toStrictEqual({ kind: 'unavailable' });
  });

  it('names a suspended account and a missing record, which includes other customers', async () => {
    api.getOrder.mockRejectedValueOnce(apiError(403, 'account_suspended'));
    expect(await call()).toStrictEqual({ kind: 'suspended' });

    api.getOrder.mockRejectedValueOnce(apiError(404, 'not_found'));
    expect(await call()).toStrictEqual({ kind: 'not_found' });
  });

  it('logs other refusals and shows them as unavailable', async () => {
    api.getOrder.mockRejectedValueOnce(apiError(400, 'validation_failed'));

    expect(await call()).toStrictEqual({ kind: 'unavailable' });
    expect(console.error).toHaveBeenCalledWith('[nilzora] account read failed', {
      code: 'validation_failed',
      status: 400,
      requestId: 'req-test-1',
    });
  });

  it('rethrows what is not an API error', async () => {
    api.getOrder.mockRejectedValueOnce(new TypeError('bug'));
    await expect(call()).rejects.toThrow('bug');
  });
});
