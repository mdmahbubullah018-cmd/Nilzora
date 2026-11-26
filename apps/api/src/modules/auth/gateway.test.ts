import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClients } from '../../supabase/clients';
import { createSupabaseAuthGateway, type AuthFailure } from './gateway';

/*
 * Unit tests for how Supabase Auth answers become API outcomes. Supabase is
 * stubbed here; the integration suite runs the same paths against the local stack.
 */

type Result = { data: unknown; error: unknown };

function gatewayWith(
  auth: Record<string, (...args: never[]) => Promise<Result>>,
  signOut: () => Promise<{ error: unknown }> = () => Promise.resolve({ error: null }),
) {
  const clients = {
    public: () => ({ auth }),
    admin: { auth: { admin: { signOut } } },
    asUser: () => {
      throw new Error('not used by the gateway');
    },
  } as unknown as SupabaseClients;
  return createSupabaseAuthGateway(clients);
}

const apiError = (status: number, code: string, message: string = code) =>
  new AuthApiError(message, status, code);
const networkFailure = () => new AuthRetryableFetchError('fetch failed', 0);

const session = {
  access_token: 'a',
  refresh_token: 'r',
  expires_in: 3600,
  expires_at: 1_800_000_000,
};
const user = { id: 'user-1', email: 'rahima@example.com' };

describe('signUp', () => {
  const input = { email: 'rahima@example.com', password: 'shopping2026' };
  const signUpAnswering = (error: unknown) =>
    gatewayWith({ signUp: () => Promise.resolve({ data: {}, error }) }).signUp(input);

  it('sends only the optional profile fields as user metadata', async () => {
    const signUp = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    await gatewayWith({ signUp }).signUp({ ...input, fullName: 'Rahima Khatun' });

    expect(signUp).toHaveBeenCalledWith({
      ...input,
      options: { data: { full_name: 'Rahima Khatun' } },
    });
  });

  it.each([
    ['a new address', null],
    ['a registered address', apiError(422, 'user_already_exists')],
    [
      'an unconfirmed address inside the resend cooldown',
      apiError(
        429,
        'over_email_send_rate_limit',
        'For security purposes, you can only request this after 37 seconds.',
      ),
    ],
  ])('resolves identically for %s', async (_label, error) => {
    await expect(signUpAnswering(error)).resolves.toBeUndefined();
  });

  it.each<[string, unknown, AuthFailure]>([
    [
      'the project-wide email quota',
      apiError(429, 'over_email_send_rate_limit', 'Email rate limit exceeded'),
      'rate_limited',
    ],
    ['a weak password', apiError(422, 'weak_password'), 'weak_password'],
    ['an address Supabase refuses', apiError(400, 'email_address_invalid'), 'rejected'],
    ['disabled sign-ups', apiError(422, 'signup_disabled'), 'rejected'],
    ['a server error', apiError(500, 'unexpected_failure'), 'unavailable'],
    ['a network failure', networkFailure(), 'unavailable'],
  ])('maps %s to %s', async (_label, error, failure) => {
    await expect(signUpAnswering(error)).rejects.toMatchObject({ failure });
  });
});

describe('signIn', () => {
  it('returns the session tokens and user', async () => {
    const gateway = gatewayWith({
      signInWithPassword: () => Promise.resolve({ data: { session, user }, error: null }),
    });

    await expect(gateway.signIn('rahima@example.com', 'shopping2026')).resolves.toStrictEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3600,
      expiresAt: 1_800_000_000,
      user: { id: 'user-1', email: 'rahima@example.com' },
    });
  });

  it.each<[unknown, AuthFailure]>([
    [apiError(400, 'email_not_confirmed'), 'email_not_confirmed'],
    [apiError(400, 'invalid_credentials'), 'invalid_credentials'],
    [apiError(429, 'over_request_rate_limit'), 'rate_limited'],
    [apiError(503, 'unexpected_failure'), 'unavailable'],
    [networkFailure(), 'unavailable'],
  ])('maps %o to %s', async (error, failure) => {
    const gateway = gatewayWith({
      signInWithPassword: () => Promise.resolve({ data: { session: null, user: null }, error }),
    });

    await expect(gateway.signIn('rahima@example.com', 'x')).rejects.toMatchObject({ failure });
  });
});

describe('verifyAccessToken', () => {
  it('returns the verified user', async () => {
    const gateway = gatewayWith({
      getUser: () => Promise.resolve({ data: { user }, error: null }),
    });

    await expect(gateway.verifyAccessToken('token')).resolves.toStrictEqual(user);
  });

  it('returns null for tokens Supabase rejects', async () => {
    const gateway = gatewayWith({
      getUser: () => Promise.resolve({ data: { user: null }, error: apiError(403, 'bad_jwt') }),
    });

    await expect(gateway.verifyAccessToken('token')).resolves.toBeNull();
  });

  it('fails closed as unavailable when Supabase cannot be reached', async () => {
    const gateway = gatewayWith({
      getUser: () => Promise.resolve({ data: { user: null }, error: networkFailure() }),
    });

    await expect(gateway.verifyAccessToken('token')).rejects.toMatchObject({
      failure: 'unavailable',
    });
  });
});

describe('refresh', () => {
  it.each([
    [
      'a rejected refresh token',
      { data: { session: null, user: null }, error: apiError(400, 'refresh_token_not_found') },
    ],
    ['an answer without a session', { data: { session: null, user: null }, error: null }],
  ])('maps %s to invalid_refresh_token', async (_label, answer) => {
    const gateway = gatewayWith({ refreshSession: () => Promise.resolve(answer) });

    await expect(gateway.refresh('r')).rejects.toMatchObject({ failure: 'invalid_refresh_token' });
  });
});

describe('confirmEmail', () => {
  it('verifies the token hash as an email confirmation and revokes the session it opens', async () => {
    const verifyOtp = vi.fn(() => Promise.resolve({ data: { session, user }, error: null }));
    const signOut = vi.fn(() => Promise.resolve({ error: null }));

    await expect(gatewayWith({ verifyOtp }, signOut).confirmEmail('hash-0001')).resolves.toBe(
      undefined,
    );
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-0001', type: 'email' });
    expect(signOut).toHaveBeenCalledWith('a', 'local');
  });

  it('still confirms when the session cannot be revoked', async () => {
    const verifyOtp = () => Promise.resolve({ data: { session, user }, error: null });
    const signOut = () => Promise.resolve({ error: networkFailure() });

    await expect(gatewayWith({ verifyOtp }, signOut).confirmEmail('hash-0001')).resolves.toBe(
      undefined,
    );
  });

  it.each<[string, Result, AuthFailure]>([
    [
      'an expired link',
      { data: { session: null, user: null }, error: apiError(403, 'otp_expired') },
      'invalid_confirmation_link',
    ],
    [
      'an answer without a user',
      { data: { session: null, user: null }, error: null },
      'invalid_confirmation_link',
    ],
    ['an outage', { data: { session: null, user: null }, error: networkFailure() }, 'unavailable'],
  ])('maps %s to %s', async (_label, answer, failure) => {
    const gateway = gatewayWith({ verifyOtp: () => Promise.resolve(answer) });

    await expect(gateway.confirmEmail('hash-0001')).rejects.toMatchObject({ failure });
  });
});

describe('signOut', () => {
  it.each([
    ['revoked', null],
    ['already ended', apiError(404, 'session_not_found')],
  ])('resolves when the session is %s', async (_label, error) => {
    await expect(
      gatewayWith({}, () => Promise.resolve({ error })).signOut('token'),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['a server error', apiError(500, 'unexpected_failure')],
    ['a network failure', networkFailure()],
  ])('does not report success after %s', async (_label, error) => {
    await expect(
      gatewayWith({}, () => Promise.resolve({ error })).signOut('token'),
    ).rejects.toMatchObject({ failure: 'unavailable' });
  });
});

/** A gateway whose service-role Auth admin API answers with the given functions. */
function gatewayWithAdmin(
  admin: Record<string, (...args: never[]) => Promise<Result | { error: unknown }>>,
  auth: Record<string, (...args: never[]) => Promise<Result>> = {},
) {
  const clients = {
    public: () => ({ auth }),
    admin: { auth: { admin } },
    asUser: () => {
      throw new Error('not used by the gateway');
    },
  } as unknown as SupabaseClients;
  return createSupabaseAuthGateway(clients);
}

describe('inviteUser', () => {
  const input = {
    email: 'nadia@example.com',
    fullName: 'Nadia Islam',
    redirectTo: 'http://localhost:3001/accept-invite',
  };
  const createdUser = () => Promise.resolve({ data: { user: { id: 'user-2' } }, error: null });
  const sent = () => Promise.resolve({ data: { user: { id: 'user-2' } }, error: null });

  it('creates the account with only the name as metadata, then emails the admin app link', async () => {
    const createUser = vi.fn(createdUser);
    const inviteUserByEmail = vi.fn(sent);

    await expect(
      gatewayWithAdmin({ createUser, inviteUserByEmail }).inviteUser(input),
    ).resolves.toStrictEqual({ userId: 'user-2' });
    expect(createUser).toHaveBeenCalledWith({
      email: 'nadia@example.com',
      user_metadata: { full_name: 'Nadia Islam' },
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith('nadia@example.com', {
      redirectTo: 'http://localhost:3001/accept-invite',
    });
  });

  it('sends no metadata without a name', async () => {
    const createUser = vi.fn(createdUser);
    const { fullName: _name, ...withoutName } = input;
    await gatewayWithAdmin({ createUser, inviteUserByEmail: sent }).inviteUser(withoutName);

    expect(createUser).toHaveBeenCalledWith({ email: 'nadia@example.com' });
  });

  it.each<[string, unknown, AuthFailure]>([
    ['a registered address', apiError(422, 'email_exists'), 'account_exists'],
    ['an existing user', apiError(422, 'user_already_exists'), 'account_exists'],
    ['an address Supabase refuses', apiError(400, 'email_address_invalid'), 'rejected'],
    ['an outage', networkFailure(), 'unavailable'],
  ])('maps %s to %s without sending any email', async (_label, error, failure) => {
    const inviteUserByEmail = vi.fn(sent);
    const gateway = gatewayWithAdmin({
      createUser: () => Promise.resolve({ data: { user: null }, error }),
      inviteUserByEmail,
    });

    await expect(gateway.inviteUser(input)).rejects.toMatchObject({ failure });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it.each<[string, unknown, AuthFailure]>([
    ['the email quota', apiError(429, 'over_email_send_rate_limit'), 'rate_limited'],
    ['a refused redirect', apiError(400, 'validation_failed'), 'rejected'],
    ['an outage', networkFailure(), 'unavailable'],
  ])('removes the new account when the email fails (%s → %s)', async (_label, error, failure) => {
    const deleteUser = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    const gateway = gatewayWithAdmin({
      createUser: createdUser,
      inviteUserByEmail: () => Promise.resolve({ data: { user: null }, error }),
      deleteUser,
    });

    await expect(gateway.inviteUser(input)).rejects.toMatchObject({ failure });
    expect(deleteUser).toHaveBeenCalledWith('user-2');
  });
});

describe('resendInvitation', () => {
  const input = { email: 'nadia@example.com', redirectTo: 'http://localhost:3001/accept-invite' };

  it('re-invites the existing account with the admin app link, creating nothing', async () => {
    const createUser = vi.fn(() => Promise.resolve({ data: { user: null }, error: null }));
    const inviteUserByEmail = vi.fn(() =>
      Promise.resolve({ data: { user: { id: 'user-2' } }, error: null }),
    );

    await expect(
      gatewayWithAdmin({ createUser, inviteUserByEmail }).resendInvitation(input),
    ).resolves.toBeUndefined();
    expect(inviteUserByEmail).toHaveBeenCalledWith('nadia@example.com', {
      redirectTo: 'http://localhost:3001/accept-invite',
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it.each<[string, unknown, AuthFailure]>([
    ['an address confirmed in between', apiError(422, 'email_exists'), 'account_exists'],
    ['the email quota', apiError(429, 'over_email_send_rate_limit'), 'rate_limited'],
    ['a refused redirect', apiError(400, 'validation_failed'), 'rejected'],
    ['an outage', networkFailure(), 'unavailable'],
  ])('maps %s to %s', async (_label, error, failure) => {
    const gateway = gatewayWithAdmin({
      inviteUserByEmail: () => Promise.resolve({ data: { user: null }, error }),
    });

    await expect(gateway.resendInvitation(input)).rejects.toMatchObject({ failure });
  });
});

describe('verifyInvitation', () => {
  it('verifies the token hash as an invitation only and hands back the session', async () => {
    const verifyOtp = vi.fn(() => Promise.resolve({ data: { session, user }, error: null }));
    const gateway = gatewayWithAdmin({}, { verifyOtp });

    await expect(gateway.verifyInvitation('hash-0002')).resolves.toMatchObject({
      accessToken: 'a',
      user: { id: 'user-1' },
    });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-0002', type: 'invite' });
  });

  it.each<[string, Result, AuthFailure]>([
    [
      'an expired link',
      { data: { session: null, user: null }, error: apiError(403, 'otp_expired') },
      'invitation_invalid',
    ],
    [
      'an answer without a session',
      { data: { session: null, user }, error: null },
      'invitation_invalid',
    ],
    ['an outage', { data: { session: null, user: null }, error: networkFailure() }, 'unavailable'],
  ])('maps %s to %s', async (_label, answer, failure) => {
    const gateway = gatewayWithAdmin({}, { verifyOtp: () => Promise.resolve(answer) });

    await expect(gateway.verifyInvitation('hash-0002')).rejects.toMatchObject({ failure });
  });
});

describe('setPassword and deleteUser', () => {
  it('sets the password through the service-role admin API', async () => {
    const updateUserById = vi.fn(() => Promise.resolve({ data: { user }, error: null }));

    await gatewayWithAdmin({ updateUserById }).setPassword('user-1', 'team-member-2026');
    expect(updateUserById).toHaveBeenCalledWith('user-1', { password: 'team-member-2026' });
  });

  it.each<[string, unknown, AuthFailure]>([
    ['a weak password', apiError(422, 'weak_password'), 'weak_password'],
    ['an outage', networkFailure(), 'unavailable'],
  ])('maps %s to %s', async (_label, error, failure) => {
    const gateway = gatewayWithAdmin({
      updateUserById: () => Promise.resolve({ data: { user: null }, error }),
    });

    await expect(gateway.setPassword('user-1', 'team-member-2026')).rejects.toMatchObject({
      failure,
    });
  });

  it('deletes an account, failing loudly when Auth refuses', async () => {
    const deleteUser = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    await gatewayWithAdmin({ deleteUser }).deleteUser('user-2');
    expect(deleteUser).toHaveBeenCalledWith('user-2');

    const refusing = gatewayWithAdmin({
      deleteUser: () => Promise.resolve({ data: {}, error: networkFailure() }),
    });
    await expect(refusing.deleteUser('user-2')).rejects.toMatchObject({ failure: 'unavailable' });
  });
});
