import type { RequestIdentity } from '../auth/identity';
import {
  isServiceUnavailable,
  twoFactorVerdict,
  type AuthDependencies,
} from '../middleware/authenticate';
import type { ChatTicketSigner } from './ticket';

/*
 * Socket authentication
 * ---------------------
 * A socket proves who it is exactly the way a REST call does, and the answer is built the
 * same way: the token or ticket is verified here, and the role and effective permissions
 * are then read from the database for that account. Nothing in the handshake is trusted.
 *
 * Two credentials are accepted:
 *   - `token`: the account's access token. The mobile app keeps it in the device keychain
 *     and has it available, so it connects with it directly.
 *   - `ticket`: a two-minute credential the web apps obtain server-side, because their
 *     access tokens live in HttpOnly cookies the browser cannot read.
 *
 * Account status is re-checked on every handshake, so a suspended account cannot keep a
 * socket alive by reconnecting.
 */

export class SocketAuthUnavailableError extends Error {
  override readonly name = 'SocketAuthUnavailableError';
}

export interface SocketHandshakeAuth {
  token?: unknown;
  ticket?: unknown;
}

const MAX_CREDENTIAL_LENGTH = 8192;

function present(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CREDENTIAL_LENGTH;
}

export async function resolveSocketIdentity(
  deps: { auth: AuthDependencies; tickets: ChatTicketSigner },
  handshake: SocketHandshakeAuth,
): Promise<RequestIdentity | null> {
  const { auth, tickets } = deps;

  let userId: string | null = null;
  let accessToken = '';
  let email: string | null = null;
  let sessionId: string | null = null;

  if (present(handshake.ticket)) {
    userId = tickets.verify(handshake.ticket);
    if (!userId) return null;
  } else if (present(handshake.token)) {
    accessToken = handshake.token;
    try {
      const session = auth.sessions ? await auth.sessions.resolve(accessToken) : null;
      if (session) {
        userId = session.userId;
        email = session.email ?? null;
        sessionId = session.sessionId;
      } else {
        const user = await auth.gateway.verifyAccessToken(accessToken);
        if (!user) return null;
        userId = user.id;
        email = user.email;
      }
    } catch (error) {
      if (isServiceUnavailable(error)) throw new SocketAuthUnavailableError();
      throw error;
    }
  } else {
    return null;
  }

  try {
    const access = await auth.accounts.loadAccess(accessToken, userId);
    if (!access || access.status !== 'active') return null;
    // A socket gets no 2FA exemption: a super_admin session must have passed it. (A ticket is
    // only issued by a REST route that already enforced it.)
    if (!present(handshake.ticket)) {
      const verdict = await twoFactorVerdict(auth.twoFactor, userId, access.role, sessionId).catch(
        () => {
          throw new SocketAuthUnavailableError();
        },
      );
      if (verdict && !verdict.verified) return null;
    }
    return {
      userId,
      email,
      role: access.role,
      permissions: access.permissions,
      accessToken,
      sessionId,
    };
  } catch (error) {
    if (isServiceUnavailable(error)) throw new SocketAuthUnavailableError();
    throw error;
  }
}
