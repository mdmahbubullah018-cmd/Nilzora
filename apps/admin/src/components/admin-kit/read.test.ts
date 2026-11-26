import { ApiError } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRead } from './read';

const read = vi.hoisted(() => vi.fn<(call: unknown) => Promise<unknown>>());
vi.mock('@/lib/session', () => ({ session: { read } }));

beforeEach(() => {
  read.mockReset();
});

const call = vi.fn();

describe('adminRead', () => {
  it('passes successful and session outcomes through', async () => {
    read.mockResolvedValueOnce({ kind: 'ok', value: 1 });
    await expect(adminRead(call)).resolves.toEqual({ kind: 'ok', value: 1 });
    read.mockResolvedValueOnce({ kind: 'unavailable' });
    await expect(adminRead(call)).resolves.toEqual({ kind: 'unavailable' });
  });

  it.each([
    [429, 'rate_limited', 'rate_limited'],
    [403, 'forbidden', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [400, 'validation_failed', 'invalid'],
    [422, 'unprocessable', 'invalid'],
    [0, 'invalid_request', 'invalid'],
  ] as const)('maps an API %i (%s) to %s', async (status, code, kind) => {
    read.mockRejectedValueOnce(new ApiError(status, code, 'Refused'));
    await expect(adminRead(call)).resolves.toEqual({ kind });
  });

  it('rethrows anything else, so bugs are not mistaken for refusals', async () => {
    read.mockRejectedValueOnce(new ApiError(409, 'conflict', 'Conflict'));
    await expect(adminRead(call)).rejects.toThrow('Conflict');
    read.mockRejectedValueOnce(new TypeError('boom'));
    await expect(adminRead(call)).rejects.toThrow('boom');
  });
});
