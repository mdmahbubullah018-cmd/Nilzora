import type { AppRole, Permission } from '@nilzora/contracts';

/**
 * Who is calling, as established by the authenticate middleware from a token
 * verified by Supabase Auth plus the role stored in the database. Route handlers
 * must use this, never an id taken from the URL or the request body.
 */
export interface RequestIdentity {
  userId: string;
  email: string | null;
  role: AppRole;
  permissions: ReadonlySet<Permission>;
  /** The verified access token, for user-scoped (RLS) database calls. Never log it. */
  accessToken: string;
  /**
   * The session the token belongs to, as the first-party resolver verified it; null for a
   * Supabase JWT, whose claims already carry their own `session_id`. Forwarded to the
   * database as a claim so a function that binds work to a session (registering a push
   * device) never has to trust anything from the request.
   */
  sessionId: string | null;
  /**
   * Present for accounts that must use two-factor authentication. Only routes that opted in
   * with `allowPendingTwoFactor` ever see `verified: false`; everywhere else such a session is
   * refused before the route runs.
   */
  twoFactor?: { required: boolean; enrolled: boolean; verified: boolean };
}
