import { ApiError, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptInvitationAction } from './invite-actions';

const mocks = vi.hoisted(() => ({
  sameOrigin: true,
  acceptInvitation: vi.fn<(body: unknown) => Promise<void>>(),
}));
vi.mock('./session', () => ({
  session: {
    isSameOrigin: () => Promise.resolve(mocks.sameOrigin),
    api: () => Promise.resolve({ acceptInvitation: mocks.acceptInvitation }),
  },
}));

const IDLE: FormState = { status: 'idle' };
const TOKEN = 'pkce_0123456789abcdef0123';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  mocks.sameOrigin = true;
  mocks.acceptInvitation.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('acceptInvitationAction', () => {
  it('refuses a post from another origin without calling the API', async () => {
    mocks.sameOrigin = false;
    const state = await acceptInvitationAction(
      IDLE,
      form({ tokenHash: TOKEN, password: 'letters123', confirmPassword: 'letters123' }),
    );
    expect(state.message).toMatch(/expired/);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('checks the password policy and the confirmation first', async () => {
    const weak = await acceptInvitationAction(
      IDLE,
      form({ tokenHash: TOKEN, password: 'short', confirmPassword: 'short' }),
    );
    expect(weak.fieldErrors?.password).toBeDefined();
    const mismatch = await acceptInvitationAction(
      IDLE,
      form({ tokenHash: TOKEN, password: 'letters123', confirmPassword: 'letters124' }),
    );
    expect(mismatch.fieldErrors?.confirmPassword).toMatch(/do not match/);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('sets the password with the token and signs nobody in', async () => {
    const state = await acceptInvitationAction(
      IDLE,
      form({ tokenHash: TOKEN, password: 'letters123', confirmPassword: 'letters123' }),
    );
    expect(mocks.acceptInvitation).toHaveBeenCalledWith({
      tokenHash: TOKEN,
      password: 'letters123',
    });
    expect(state).toEqual({
      status: 'success',
      message: 'Your password is set. Sign in to start working.',
    });
  });

  it('explains an invalid or used link and a malformed token', async () => {
    mocks.acceptInvitation.mockRejectedValue(new ApiError(400, 'invitation_invalid', 'x'));
    const used = await acceptInvitationAction(
      IDLE,
      form({ tokenHash: TOKEN, password: 'letters123', confirmPassword: 'letters123' }),
    );
    expect(used.message).toMatch(/invalid, expired or already used/);

    const malformed = await acceptInvitationAction(
      IDLE,
      form({ tokenHash: '<script>', password: 'letters123', confirmPassword: 'letters123' }),
    );
    expect(malformed.message).toMatch(/invalid, expired or already used/);
  });
});
