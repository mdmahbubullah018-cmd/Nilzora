import type { FormState, SignInResult } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testUser } from '@/test/fixtures';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import { signInAction, signOutAction } from './actions';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn<(formData: FormData, options?: unknown) => Promise<SignInResult>>(),
  signOut: vi.fn<(formData: FormData) => Promise<FormState>>(),
}));
vi.mock('./session', () => ({ session: { signIn: mocks.signIn, signOut: mocks.signOut } }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const IDLE: FormState = { status: 'idle' };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof RedirectSignal)) throw new Error('expected a redirect');
  return error.url;
}

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.signOut.mockReset();
});

describe('signInAction', () => {
  it('admits only accounts holding a workspace permission', async () => {
    mocks.signIn.mockResolvedValue({ status: 'error', message: 'denied' });
    const data = form({ email: 'a@example.test', password: 'not-a-real-password' });
    await signInAction(IDLE, data);

    expect(mocks.signIn).toHaveBeenCalledWith(data, {
      requireAnyPermission: ['admin_workspace.access', 'moderator_workspace.access'],
      deniedMessage: 'This account does not have access to the Nilzora workspaces.',
    });
  });

  it('returns failures as form state and never includes the user', async () => {
    mocks.signIn.mockResolvedValue({
      status: 'error',
      message: 'This account does not have access to the Nilzora workspaces.',
      values: { email: 'customer@example.test' },
      user: testUser('customer'),
    });
    const state = await signInAction(IDLE, form({ email: 'customer@example.test' }));

    expect(state).toEqual({
      status: 'error',
      message: 'This account does not have access to the Nilzora workspaces.',
      values: { email: 'customer@example.test' },
    });
    expect(state).not.toHaveProperty('user');
  });

  it.each([
    ['staff', '', '/admin'],
    ['moderator', '', '/moderator'],
    ['super_admin', '/moderator', '/moderator'],
    ['staff', '/admin/orders?page=2', '/admin/orders?page=2'],
    // A workspace the account may not enter falls back to its own.
    ['staff', '/moderator', '/admin'],
    ['moderator', '/admin', '/moderator'],
    // Off-site and out-of-area targets are dropped.
    ['staff', 'https://evil.example/admin', '/admin'],
    ['staff', '//evil.example/admin', '/admin'],
    ['staff', '/\\evil.example', '/admin'],
    ['moderator', '/login', '/moderator'],
    ['admin', '/administrator', '/admin'],
  ] as const)('%s with next=%j lands on %s', async (role, next, target) => {
    mocks.signIn.mockResolvedValue({ status: 'success', user: testUser(role) });
    await expect(redirectOf(signInAction(IDLE, form({ next })))).resolves.toBe(target);
  });
});

describe('signOutAction', () => {
  it('goes to the sign-in page once the session has ended', async () => {
    mocks.signOut.mockResolvedValue({ status: 'success' });
    await expect(redirectOf(signOutAction(IDLE, form({})))).resolves.toBe('/login?signedOut=1');
  });

  it('reports a refused form without redirecting', async () => {
    const expired: FormState = { status: 'error', message: 'This form has expired.' };
    mocks.signOut.mockResolvedValue(expired);
    await expect(signOutAction(IDLE, form({}))).resolves.toEqual(expired);
  });
});
