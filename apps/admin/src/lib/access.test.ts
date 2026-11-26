import type { SessionState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testUser } from '@/test/fixtures';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import { entryGate, workspaceGate } from './access';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<SessionState>>(),
  csrfToken: vi.fn<() => Promise<string>>(),
}));
vi.mock('./session', () => ({
  session: { getSession: mocks.getSession, csrfToken: mocks.csrfToken },
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };

beforeEach(() => {
  mocks.getSession.mockReset();
  mocks.csrfToken.mockReset().mockResolvedValue(csrf.token);
});

describe('workspaceGate', () => {
  it('sends a signed-out visitor to sign in, returning to the page', async () => {
    mocks.getSession.mockResolvedValue({ status: 'signed_out' });
    const error = await workspaceGate('admin', '/admin').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect((error as RedirectSignal).url).toBe('/login?next=%2Fadmin');
  });

  it('allows an account holding the workspace permission', async () => {
    const user = testUser('staff');
    mocks.getSession.mockResolvedValue({ status: 'signed_in', user });
    await expect(workspaceGate('admin', '/admin')).resolves.toEqual({
      access: 'allowed',
      user,
      csrf,
    });
  });

  it('refuses an account without the workspace permission', async () => {
    const user = testUser('staff');
    mocks.getSession.mockResolvedValue({ status: 'signed_in', user });
    await expect(workspaceGate('moderator', '/moderator')).resolves.toEqual({
      access: 'forbidden',
      user,
      csrf,
    });
  });

  it('refuses customers in both workspaces', async () => {
    mocks.getSession.mockResolvedValue({ status: 'signed_in', user: testUser('customer') });
    await expect(workspaceGate('admin', '/admin')).resolves.toMatchObject({ access: 'forbidden' });
    await expect(workspaceGate('moderator', '/moderator')).resolves.toMatchObject({
      access: 'forbidden',
    });
  });

  it.each(['suspended', 'unavailable'] as const)(
    'reports %s without a user or a redirect',
    async (status) => {
      mocks.getSession.mockResolvedValue({ status });
      await expect(workspaceGate('admin', '/admin')).resolves.toEqual({ access: status, csrf });
    },
  );
});

describe('entryGate', () => {
  it('asks a signed-out visitor to sign in without redirecting', async () => {
    mocks.getSession.mockResolvedValue({ status: 'signed_out' });
    await expect(entryGate()).resolves.toEqual({ access: 'sign_in', csrf });
  });

  it('sends each account to its default workspace', async () => {
    const moderator = testUser('moderator');
    mocks.getSession.mockResolvedValue({ status: 'signed_in', user: moderator });
    await expect(entryGate()).resolves.toEqual({
      access: 'allowed',
      user: moderator,
      workspace: 'moderator',
      csrf,
    });
  });

  it('refuses an account without any workspace permission', async () => {
    const customer = testUser('customer');
    mocks.getSession.mockResolvedValue({ status: 'signed_in', user: customer });
    await expect(entryGate()).resolves.toEqual({ access: 'forbidden', user: customer, csrf });
  });

  it.each(['suspended', 'unavailable'] as const)('reports %s', async (status) => {
    mocks.getSession.mockResolvedValue({ status });
    await expect(entryGate()).resolves.toEqual({ access: status, csrf });
  });
});
