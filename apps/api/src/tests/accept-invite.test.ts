import {
  authSessionSchema,
  meResponseSchema,
  staffInvitationResponseSchema,
} from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuthGatewayError } from '../modules/auth/gateway';
import { adminSetup, errorOf, type AdminSetup } from './admin-helpers';

const NEW_PASSWORD = 'team-member-2026';

/** Invites a moderator as the owner (only the owner creates system users); returns the account id and the emailed token hash. */
async function invited(setup: AdminSetup, role = 'moderator') {
  const response = await setup.call('post', '/admin/staff/invitations', 'owner', {
    email: 'invitee@example.com',
    role,
  });
  const { userId } = staffInvitationResponseSchema.parse(response.body).invitation;
  const tokenHash = setup.identity.invitations.find((sent) => sent.userId === userId)?.tokenHash;
  if (!tokenHash) throw new Error('no invitation was sent');
  return { userId, tokenHash };
}

function accept(setup: AdminSetup, body: object) {
  return request(setup.app).post('/api/v1/auth/accept-invite').send(body);
}

function sessionsOf(setup: AdminSetup, userId: string) {
  return [...setup.identity.sessions.values()].filter((session) => session.userId === userId);
}

describe('POST /api/v1/auth/accept-invite', () => {
  it('sets the password, revokes the session the link opened and returns no tokens', async () => {
    const setup = adminSetup();
    const { userId, tokenHash } = await invited(setup);
    const response = await accept(setup, { tokenHash, password: NEW_PASSWORD });

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(setup.identity.passwordChanges).toEqual([{ userId, password: NEW_PASSWORD }]);
    const sessions = sessionsOf(setup, userId);
    expect(sessions).toHaveLength(1);
    expect(sessions.every((session) => session.revoked)).toBe(true);
  });

  it('lets the invitee sign in with the new password and the invited role', async () => {
    const setup = adminSetup();
    const { tokenHash } = await invited(setup);
    await accept(setup, { tokenHash, password: NEW_PASSWORD });
    const login = await request(setup.app)
      .post('/api/v1/auth/login')
      .send({ email: 'invitee@example.com', password: NEW_PASSWORD });
    const { accessToken } = authSessionSchema.parse(login.body);
    const me = await request(setup.app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(meResponseSchema.parse(me.body).user).toMatchObject({
      email: 'invitee@example.com',
      role: 'moderator',
    });
    expect(meResponseSchema.parse(me.body).user.permissions).toContain('content.approve');
  });

  it('accepts each link once', async () => {
    const setup = adminSetup();
    const { tokenHash } = await invited(setup);
    await accept(setup, { tokenHash, password: NEW_PASSWORD });
    const replay = await accept(setup, { tokenHash, password: 'another-pass-1' });

    expect(replay.status).toBe(400);
    expect(errorOf(replay.body).code).toBe('invitation_invalid');
    expect(setup.identity.passwordChanges).toHaveLength(1);
  });

  it('refuses a made-up link', async () => {
    const setup = adminSetup();
    const response = await accept(setup, {
      tokenHash: 'made-up-invitation-hash-00000000',
      password: NEW_PASSWORD,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('invitation_invalid');
  });

  it.each<[string, (setup: AdminSetup, userId: string) => void]>([
    [
      'an account that is (again) a customer',
      (setup, userId) => {
        const user = setup.identity.users.get(userId);
        if (user) user.role = 'customer';
      },
    ],
    [
      'a suspended account',
      (setup, userId) => {
        const user = setup.identity.users.get(userId);
        if (user) user.status = 'suspended';
      },
    ],
  ])('sets no password for %s, revoking the session anyway', async (_label, change) => {
    const setup = adminSetup();
    const { userId, tokenHash } = await invited(setup);
    change(setup, userId);
    const response = await accept(setup, { tokenHash, password: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('invitation_invalid');
    expect(setup.identity.passwordChanges).toEqual([]);
    expect(sessionsOf(setup, userId).every((session) => session.revoked)).toBe(true);
  });

  it.each([
    ['a short password', { password: 'abc123' }],
    ['a letters-only password', { password: 'onlyletters' }],
    ['a password over 72 bytes', { password: `${'ক'.repeat(24)}1` }],
    ['a malformed hash', { tokenHash: 'short' }],
    ['a hash with symbols', { tokenHash: 'made-up/invitation+hash=0000000' }],
    ['a role', { role: 'admin' }],
    ['a redirect', { redirectTo: 'https://evil.test' }],
  ])('rejects %s before redeeming the link', async (_label, extra) => {
    const setup = adminSetup();
    const { tokenHash } = await invited(setup);
    const response = await accept(setup, { tokenHash, password: NEW_PASSWORD, ...extra });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.identity.passwordChanges).toEqual([]);
    // The link is still unused.
    expect(setup.identity.invitations[0]?.tokenHash).toBe(tokenHash);
  });

  it('answers a password Supabase Auth refuses with weak_password, revoking the session', async () => {
    const setup = adminSetup();
    const { userId, tokenHash } = await invited(setup);
    setup.identity.gateway.setPassword = () =>
      Promise.reject(new AuthGatewayError('weak_password'));
    const response = await accept(setup, { tokenHash, password: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('weak_password');
    expect(sessionsOf(setup, userId).every((session) => session.revoked)).toBe(true);
  });

  it('answers 503 when Supabase Auth is unavailable', async () => {
    const setup = adminSetup();
    const { tokenHash } = await invited(setup);
    setup.identity.gatewayFailure = 'unavailable';
    const response = await accept(setup, { tokenHash, password: NEW_PASSWORD });

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('auth_unavailable');
  });

  it('shares the sign-in rate limit', async () => {
    const setup = adminSetup({ AUTH_RATE_LIMIT_MAX: '1' });
    const body = { tokenHash: 'made-up-invitation-hash-00000000', password: NEW_PASSWORD };
    await accept(setup, body);
    const limited = await accept(setup, body);

    expect(limited.status).toBe(429);
    expect(errorOf(limited.body).code).toBe('rate_limited');
  });
});
