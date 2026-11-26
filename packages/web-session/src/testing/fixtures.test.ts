import { describe, expect, it } from 'vitest';
import { meResponse, stubApi } from './fixtures';

describe('stubApi', () => {
  it('rejects, naming the method, when a test did not fake it', async () => {
    const api = stubApi();
    await expect(api.getMe('token')).rejects.toThrow('not faked: getMe');
    await expect(api.listProducts({})).rejects.toThrow('not faked: listProducts');
  });

  it('serves a typed mock a test can configure, and reuses it across accesses', async () => {
    const api = stubApi();
    const me = meResponse();
    api.getMe.mockResolvedValue(me);

    await expect(api.getMe('token')).resolves.toBe(me);
    expect(api.getMe).toBe(api.getMe);
    expect(api.getMe).toHaveBeenCalledExactlyOnceWith('token');
  });

  it('lists only the methods that were touched, so "no API call" checks stay meaningful', async () => {
    const api = stubApi();
    expect(Object.values(api)).toHaveLength(0);

    await api.getMe('token').catch(() => undefined);

    expect(Object.keys(api)).toStrictEqual(['getMe']);
    expect(Object.values(api).every((method) => method.mock.calls.length > 0)).toBe(true);
  });

  it('is not mistaken for a thenable when returned from an async function', async () => {
    const api = stubApi();
    await expect(Promise.resolve(api)).resolves.toBe(api);
  });
});
