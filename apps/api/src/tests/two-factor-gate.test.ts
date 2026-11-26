import { describe, expect, it } from 'vitest';
import type { TwoFactorState } from '../auth/two-factor';
import {
  twoFactorVerdict,
  type AuthDependencies,
  type TwoFactorGate,
} from '../middleware/authenticate';
import type { AuthGateway } from '../modules/auth/gateway';
import type { AccountStore } from '../modules/users/accounts';
import { resolveSocketIdentity } from '../realtime/auth';
import type { ChatTicketSigner } from '../realtime/ticket';

/* The 2FA gate shared by REST (authenticate) and sockets (resolveSocketIdentity). */

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const SESSION = '00000000-0000-4000-8000-0000000000f1';

function state(verified: boolean, overrides: Partial<TwoFactorState> = {}): TwoFactorState {
  return {
    required: true,
    enrolled: true,
    pending: false,
    verified,
    lockedUntil: null,
    recoveryCodesLeft: 10,
    sessionIssuedAt: new Date(),
    ...overrides,
  };
}

const gate = (value: TwoFactorState | Error): TwoFactorGate => ({
  state: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)),
});

describe('twoFactorVerdict', () => {
  it('does not apply to roles that need no 2FA, or when 2FA is not configured', async () => {
    expect(await twoFactorVerdict(gate(state(false)), OWNER, 'admin', SESSION)).toBeUndefined();
    expect(await twoFactorVerdict(gate(state(false)), OWNER, 'customer', SESSION)).toBeUndefined();
    expect(await twoFactorVerdict(undefined, OWNER, 'super_admin', SESSION)).toBeUndefined();
  });

  it('blocks a super_admin session that has not passed, and one that cannot (no first-party session)', async () => {
    expect(await twoFactorVerdict(gate(state(false)), OWNER, 'super_admin', SESSION)).toEqual({
      required: true,
      enrolled: true,
      verified: false,
    });
    expect(await twoFactorVerdict(gate(state(true)), OWNER, 'super_admin', null)).toMatchObject({
      verified: false,
    });
    expect(await twoFactorVerdict(gate(state(true)), OWNER, 'super_admin', SESSION)).toMatchObject({
      verified: true,
    });
  });

  it('fails closed: an unreadable state is an error, never a pass', async () => {
    await expect(
      twoFactorVerdict(gate(new Error('db down')), OWNER, 'super_admin', SESSION),
    ).rejects.toThrow();
  });
});

describe('socket handshake', () => {
  function deps(verified: boolean): { auth: AuthDependencies; tickets: ChatTicketSigner } {
    const accounts = {
      loadAccess: () =>
        Promise.resolve({
          role: 'super_admin',
          status: 'active',
          permissions: new Set(['admin_workspace.access']),
        }),
    } as unknown as AccountStore;
    return {
      auth: {
        gateway: { verifyAccessToken: () => Promise.resolve(null) } as unknown as AuthGateway,
        accounts,
        sessions: {
          resolve: () =>
            Promise.resolve({ userId: OWNER, sessionId: SESSION, email: 'o@example.com' }),
        },
        twoFactor: gate(state(verified)),
      },
      tickets: { verify: () => OWNER, sign: () => 'ticket' } as unknown as ChatTicketSigner,
    };
  }

  it('refuses a super_admin token that has not passed 2FA, and accepts it once it has', async () => {
    expect(await resolveSocketIdentity(deps(false), { token: 'opaque-token' })).toBeNull();
    expect(await resolveSocketIdentity(deps(true), { token: 'opaque-token' })).toMatchObject({
      userId: OWNER,
    });
  });
});
