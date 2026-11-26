import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClients } from '../../supabase/clients';

export type AuthFailure =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'invalid_refresh_token'
  | 'weak_password'
  | 'invalid_confirmation_link'
  | 'account_exists'
  | 'invitation_invalid'
  | 'rejected'
  | 'rate_limited'
  | 'unavailable';

/** A Supabase Auth outcome the API turns into a specific, safe error response. */
export class AuthGatewayError extends Error {
  override readonly name = 'AuthGatewayError';
  readonly failure: AuthFailure;

  constructor(failure: AuthFailure, options?: ErrorOptions) {
    super(`Supabase Auth: ${failure}`, options);
    this.failure = failure;
  }
}

export interface VerifiedUser {
  id: string;
  email: string | null;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName?: string;
  phone?: string;
}

export interface ResendInvitationInput {
  email: string;
  /** The admin workspace page the invitation email links to (allow-listed in Supabase Auth). */
  redirectTo: string;
}

export interface InvitationInput {
  email: string;
  fullName?: string | undefined;
  /** The admin workspace page the invitation email links to (allow-listed in Supabase Auth). */
  redirectTo: string;
}

/** Supabase Auth operations used by the API. */
export interface AuthGateway {
  /**
   * Asks Supabase Auth whether an access token is valid right now (signature,
   * expiry and a still-active session). Returns null for any token it rejects.
   */
  verifyAccessToken(accessToken: string): Promise<VerifiedUser | null>;
  /** Registers an account. Succeeds quietly if the email is already registered. */
  signUp(input: SignUpInput): Promise<void>;
  signIn(email: string, password: string): Promise<SessionTokens & { user: VerifiedUser }>;
  refresh(refreshToken: string): Promise<SessionTokens & { user: VerifiedUser }>;
  /**
   * Confirms an email address from the token hash in a confirmation link. It signs
   * nobody in: the session Supabase opens with the confirmation is revoked at once.
   */
  confirmEmail(tokenHash: string): Promise<void>;
  /** Revokes the session behind an access token (its refresh token stops working). */
  signOut(accessToken: string): Promise<void>;
  /**
   * Creates an account (a customer until a role is assigned) and emails it a one-time
   * invitation link. Fails with account_exists, sending nothing, when any account
   * (confirmed or not) already uses the email address.
   */
  inviteUser(input: InvitationInput): Promise<{ userId: string }>;
  /**
   * Emails an existing, still unconfirmed invitee a new one-time link (Supabase Auth
   * replaces the earlier one). The caller checks first, as the signed-in staff member,
   * that the account is a pending invitation it may re-send (admin_prepare_invitation_resend).
   */
  resendInvitation(input: ResendInvitationInput): Promise<void>;
  /**
   * Redeems the token hash of an invitation link. The session it opens must never
   * leave the API: the caller sets the password with it in hand, then revokes it.
   */
  verifyInvitation(tokenHash: string): Promise<SessionTokens & { user: VerifiedUser }>;
  /** Sets an account's password (server-side; used only after verifyInvitation). */
  setPassword(userId: string, password: string): Promise<void>;
  /** Deletes an account, undoing an invitation whose role could not be assigned. */
  deleteUser(userId: string): Promise<void>;
}

const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
]);

/** Network failures and 5xx responses: nothing was decided, so nothing is granted. */
function isInfrastructureFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (!isAuthError(error)) return true;
  return error.status === undefined || error.status === 0 || error.status >= 500;
}

function classify(error: unknown, fallback: AuthFailure): AuthGatewayError {
  if (isAuthError(error) && (error.status === 429 || RATE_LIMIT_CODES.has(error.code ?? ''))) {
    return new AuthGatewayError('rate_limited', { cause: error });
  }
  if (isInfrastructureFailure(error)) return new AuthGatewayError('unavailable', { cause: error });
  return new AuthGatewayError(fallback, { cause: error });
}

function toTokens(session: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
}): SessionTokens {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
  };
}

export function createSupabaseAuthGateway(clients: SupabaseClients): AuthGateway {
  async function signOut(accessToken: string): Promise<void> {
    const { error } = await clients.admin.auth.admin.signOut(accessToken, 'local');
    // A 4xx answer means the session has already ended, the goal of a sign-out.
    // Network failures (status 0) and 5xx leave it unknown, so they are not success.
    if (!error || !isInfrastructureFailure(error)) return;
    throw new AuthGatewayError('unavailable', { cause: error });
  }

  return {
    async verifyAccessToken(accessToken) {
      const { data, error } = await clients.public().auth.getUser(accessToken);
      if (error) {
        if (isInfrastructureFailure(error)) {
          throw new AuthGatewayError('unavailable', { cause: error });
        }
        return null;
      }
      return { id: data.user.id, email: data.user.email ?? null };
    },

    async signUp({ email, password, fullName, phone }) {
      // Only optional profile fields go into user metadata; the database trigger
      // validates them again and always creates a customer role.
      const { error } = await clients.public().auth.signUp({
        email,
        password,
        options: {
          data: { ...(fullName ? { full_name: fullName } : {}), ...(phone ? { phone } : {}) },
        },
      });
      if (!error) return;
      if (error.code === 'user_already_exists' || error.code === 'email_exists') return;
      // A repeat sign-up for an unconfirmed address inside the resend cooldown: a
      // confirmation link was just sent. Answering 429 here (but 202 for confirmed
      // addresses) would reveal which addresses are registered. The project-wide
      // email quota uses the same code with a different message and stays a 429.
      if (
        error.code === 'over_email_send_rate_limit' &&
        error.message.startsWith('For security purposes')
      ) {
        return;
      }
      if (error.code === 'weak_password') throw new AuthGatewayError('weak_password');
      if (error.code === 'email_address_invalid' || error.code === 'signup_disabled') {
        throw new AuthGatewayError('rejected', { cause: error });
      }
      throw classify(error, 'rejected');
    },

    async signIn(email, password) {
      const { data, error } = await clients.public().auth.signInWithPassword({ email, password });
      if (error) {
        if (error.code === 'email_not_confirmed') {
          throw new AuthGatewayError('email_not_confirmed');
        }
        throw classify(error, 'invalid_credentials');
      }
      return {
        ...toTokens(data.session),
        user: { id: data.user.id, email: data.user.email ?? null },
      };
    },

    async refresh(refreshToken) {
      const { data, error } = await clients
        .public()
        .auth.refreshSession({ refresh_token: refreshToken });
      if (error) throw classify(error, 'invalid_refresh_token');
      if (!data.session || !data.user) throw new AuthGatewayError('invalid_refresh_token');
      return {
        ...toTokens(data.session),
        user: { id: data.user.id, email: data.user.email ?? null },
      };
    },

    async confirmEmail(tokenHash) {
      const { data, error } = await clients
        .public()
        .auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
      // Expired, used or unknown links all read as one failure; nothing else is revealed.
      if (error) throw classify(error, 'invalid_confirmation_link');
      if (!data.user) throw new AuthGatewayError('invalid_confirmation_link');
      // A session issued here would sign in whoever submits the link, so a forwarded
      // link could sign someone in to another person's account. Its tokens never leave
      // the API, and the address is confirmed either way, so revoking is best effort.
      if (data.session) await signOut(data.session.access_token).catch(() => undefined);
    },

    signOut,

    async inviteUser({ email, fullName, redirectTo }) {
      // The account is created first: Supabase Auth refuses an address already in use,
      // confirmed or not, before any email is sent. (Inviting directly would re-send an
      // invitation to an existing unconfirmed account and hand it back as if new.)
      const { data, error } = await clients.admin.auth.admin.createUser({
        email,
        // Read by the signup trigger like a registration's metadata; validated there again.
        ...(fullName ? { user_metadata: { full_name: fullName } } : {}),
      });
      if (error) {
        if (error.code === 'email_exists' || error.code === 'user_already_exists') {
          throw new AuthGatewayError('account_exists', { cause: error });
        }
        throw classify(error, 'rejected');
      }

      const userId = data.user.id;
      const invited = await clients.admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (invited.error) {
        // The account exists only for this invitation; without its email it is removed.
        await clients.admin.auth.admin.deleteUser(userId).catch(() => undefined);
        throw classify(invited.error, 'rejected');
      }
      return { userId };
    },

    async resendInvitation({ email, redirectTo }) {
      const { error } = await clients.admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (!error) return;
      // Accepted in the meantime: the address is confirmed and Supabase Auth refuses it.
      if (error.code === 'email_exists' || error.code === 'user_already_exists') {
        throw new AuthGatewayError('account_exists', { cause: error });
      }
      throw classify(error, 'rejected');
    },

    async verifyInvitation(tokenHash) {
      const { data, error } = await clients
        .public()
        .auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
      // Expired, used or unknown links all read as one failure.
      if (error) throw classify(error, 'invitation_invalid');
      if (!data.session || !data.user) throw new AuthGatewayError('invitation_invalid');
      return {
        ...toTokens(data.session),
        user: { id: data.user.id, email: data.user.email ?? null },
      };
    },

    async setPassword(userId, password) {
      const { error } = await clients.admin.auth.admin.updateUserById(userId, { password });
      if (!error) return;
      if (error.code === 'weak_password') throw new AuthGatewayError('weak_password');
      throw classify(error, 'rejected');
    },

    async deleteUser(userId) {
      const { error } = await clients.admin.auth.admin.deleteUser(userId);
      if (error) throw classify(error, 'rejected');
    },
  };
}
