import { randomUUID } from 'node:crypto';
import type { AppRole, Permission, PermissionEffect } from '@nilzora/contracts';
import type { AuthDependencies, SessionResolver } from '../middleware/authenticate';
import {
  AuthGatewayError,
  type AuthFailure,
  type AuthGateway,
  type InvitationInput,
  type SessionTokens,
  type SignUpInput,
  type VerifiedUser,
} from '../modules/auth/gateway';
import {
  AccountStoreUnavailableError,
  RoleAssignmentError,
  type AccountStore,
  type ProfileRecord,
  type RoleAssignment,
  type RoleAssignmentRefusal,
} from '../modules/users/accounts';
import { permissionsFor } from './role-permissions';

/*
 * In-memory stand-ins for Supabase Auth and the identity tables, for unit tests of
 * the API's own logic. Effective permissions follow the database's rules (role
 * defaults, grants, denials winning, nothing for suspended accounts or grants for
 * customers), but the role hierarchy is not re-implemented; it is covered by the
 * pgTAP suite and the real-Supabase integration tests.
 */

interface FakeUser {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  role: AppRole;
  status: 'active' | 'suspended';
  /** null = signed up but never provisioned (no profile/role rows). */
  profile: ProfileRecord | null;
  /** Per-account grants and denials (user_permissions). */
  overrides: Map<Permission, PermissionEffect>;
}

interface FakeSession {
  userId: string;
  /** The session row's own id, as public.auth_sessions.id would be. */
  sessionId: string;
  revoked: boolean;
  expired: boolean;
}

export class FakeIdentity {
  readonly users = new Map<string, FakeUser>();
  readonly sessions = new Map<string, FakeSession>();
  readonly refreshTokens = new Map<string, string>();
  readonly signUps: SignUpInput[] = [];
  /** One-time confirmation token hashes, as sent in confirmation emails. */
  readonly confirmationLinks = new Map<string, string>();
  readonly roleAssignments: { actorId: string; targetId: string; role: AppRole }[] = [];
  /** Every invitation sent, and the one-time token hash its email would carry. */
  readonly invitations: (InvitationInput & { userId: string; tokenHash: string })[] = [];
  readonly passwordChanges: { userId: string; password: string }[] = [];
  readonly deletedUsers: string[] = [];
  gatewayFailure: AuthFailure | undefined;
  storeUnavailable = false;
  /** Breaks only profile reads/writes, so failures past authentication can be tested. */
  profileUnavailable = false;
  refuseRoleAssignment: RoleAssignmentRefusal | undefined;

  addUser(options: Partial<Omit<FakeUser, 'id'>> & { email: string }): FakeUser {
    const now = new Date('2026-10-23T08:00:00.000Z').toISOString();
    const user: FakeUser = {
      id: randomUUID(),
      password: 'shopping2026',
      confirmed: true,
      role: 'customer',
      status: 'active',
      profile: { fullName: null, phone: null, status: 'active', createdAt: now, updatedAt: now },
      overrides: new Map(),
      ...options,
    };
    this.users.set(user.id, user);
    return user;
  }

  /** Issues a session for a user, as a successful sign-in would. */
  issueSession(user: FakeUser): SessionTokens & { user: VerifiedUser } {
    const accessToken = `at.${randomUUID()}`;
    const refreshToken = `rt-${randomUUID()}`;
    this.sessions.set(accessToken, {
      userId: user.id,
      sessionId: randomUUID(),
      revoked: false,
      expired: false,
    });
    this.refreshTokens.set(refreshToken, accessToken);
    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
      expiresAt: 1_792_746_000,
      user: { id: user.id, email: user.email },
    };
  }

  tokenFor(user: FakeUser): string {
    return this.issueSession(user).accessToken;
  }

  private ownerOf(accessToken: string): string | undefined {
    const session = this.sessions.get(accessToken);
    return session && !session.revoked && !session.expired ? session.userId : undefined;
  }

  /** The live session behind a token, as resolve_session() answers. */
  sessionIdFor(accessToken: string): string | undefined {
    const session = this.sessions.get(accessToken);
    return session && !session.revoked && !session.expired ? session.sessionId : undefined;
  }

  /** The account a session row belongs to, whatever its state (register_device_token's check). */
  ownerOfSession(sessionId: string): string | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) return session.userId;
    }
    return undefined;
  }

  /** The user a live token belongs to, as the database would read auth.uid(). */
  userFor(accessToken: string): FakeUser | undefined {
    const userId = this.ownerOf(accessToken);
    return userId ? this.users.get(userId) : undefined;
  }

  /** Effective permissions, computed as private.permissions_of() does. */
  permissionsOf(user: FakeUser): ReadonlySet<Permission> {
    if (!user.profile || user.status !== 'active') return new Set();
    const granted = new Set(permissionsFor(user.role));
    for (const [permission, effect] of user.overrides) {
      if (effect === 'grant' && user.role !== 'customer') granted.add(permission);
    }
    for (const [permission, effect] of user.overrides) {
      if (effect === 'deny') granted.delete(permission);
    }
    return granted;
  }

  private failIfConfigured(): void {
    if (this.gatewayFailure) throw new AuthGatewayError(this.gatewayFailure);
  }

  readonly gateway: AuthGateway = {
    verifyAccessToken: (accessToken) => {
      this.failIfConfigured();
      const userId = this.ownerOf(accessToken);
      const user = userId ? this.users.get(userId) : undefined;
      return Promise.resolve(user ? { id: user.id, email: user.email } : null);
    },
    signUp: (input) => {
      this.failIfConfigured();
      this.signUps.push(input);
      const exists = [...this.users.values()].some((user) => user.email === input.email);
      // Like the database trigger, every new account becomes a customer.
      if (!exists) {
        this.addUser({ email: input.email, password: input.password, confirmed: false });
      }
      return Promise.resolve();
    },
    signIn: (email, password) => {
      this.failIfConfigured();
      const user = [...this.users.values()].find(
        (candidate) => candidate.email === email && candidate.password === password,
      );
      if (!user) return Promise.reject(new AuthGatewayError('invalid_credentials'));
      if (!user.confirmed) return Promise.reject(new AuthGatewayError('email_not_confirmed'));
      return Promise.resolve(this.issueSession(user));
    },
    refresh: (refreshToken) => {
      this.failIfConfigured();
      const accessToken = this.refreshTokens.get(refreshToken);
      const userId = accessToken ? this.ownerOf(accessToken) : undefined;
      const user = userId ? this.users.get(userId) : undefined;
      if (!accessToken || !user) {
        return Promise.reject(new AuthGatewayError('invalid_refresh_token'));
      }
      this.refreshTokens.delete(refreshToken);
      return Promise.resolve(this.issueSession(user));
    },
    confirmEmail: (tokenHash) => {
      this.failIfConfigured();
      const userId = this.confirmationLinks.get(tokenHash);
      const user = userId ? this.users.get(userId) : undefined;
      if (!user) return Promise.reject(new AuthGatewayError('invalid_confirmation_link'));
      this.confirmationLinks.delete(tokenHash);
      user.confirmed = true;
      return Promise.resolve();
    },
    signOut: (accessToken) => {
      this.failIfConfigured();
      const session = this.sessions.get(accessToken);
      if (session) session.revoked = true;
      for (const [refresh, access] of this.refreshTokens) {
        if (access === accessToken) this.refreshTokens.delete(refresh);
      }
      return Promise.resolve();
    },
    inviteUser: (input) => {
      this.failIfConfigured();
      // Like Supabase Auth's createUser: any account using the address, confirmed or not.
      if ([...this.users.values()].some((user) => user.email === input.email)) {
        return Promise.reject(new AuthGatewayError('account_exists'));
      }
      // Like the database trigger, the invited account starts as a customer.
      const user = this.addUser({
        email: input.email,
        password: `unset-${randomUUID()}`,
        confirmed: false,
      });
      if (input.fullName && user.profile) user.profile.fullName = input.fullName;
      this.invitations.push({ ...input, userId: user.id, tokenHash: `invite_${randomUUID()}` });
      return Promise.resolve({ userId: user.id });
    },
    resendInvitation: ({ email, redirectTo }) => {
      this.failIfConfigured();
      const user = [...this.users.values()].find((candidate) => candidate.email === email);
      if (!user) return Promise.reject(new AuthGatewayError('rejected'));
      if (user.confirmed) return Promise.reject(new AuthGatewayError('account_exists'));
      // Like Supabase Auth: the new link replaces the earlier one.
      for (const [index, sent] of this.invitations.entries()) {
        if (sent.userId === user.id) {
          this.invitations[index] = { ...sent, tokenHash: `used-${randomUUID()}` };
        }
      }
      this.invitations.push({
        email,
        redirectTo,
        userId: user.id,
        tokenHash: `invite_${randomUUID()}`,
      });
      return Promise.resolve();
    },
    verifyInvitation: (tokenHash) => {
      this.failIfConfigured();
      const index = this.invitations.findIndex((invitation) => invitation.tokenHash === tokenHash);
      const user = this.users.get(this.invitations[index]?.userId ?? '');
      if (index < 0 || !user) return Promise.reject(new AuthGatewayError('invitation_invalid'));
      this.invitations[index] = { ...this.invitations[index]!, tokenHash: `used-${randomUUID()}` };
      user.confirmed = true;
      return Promise.resolve(this.issueSession(user));
    },
    setPassword: (userId, password) => {
      this.failIfConfigured();
      const user = this.users.get(userId);
      if (!user) return Promise.reject(new AuthGatewayError('rejected'));
      user.password = password;
      this.passwordChanges.push({ userId, password });
      return Promise.resolve();
    },
    deleteUser: (userId) => {
      this.failIfConfigured();
      this.users.delete(userId);
      this.deletedUsers.push(userId);
      return Promise.resolve();
    },
  };

  /** Mirrors RLS: a token can only ever see or change its own user's rows. */
  readonly accounts: AccountStore = {
    loadAccess: (accessToken, userId) => {
      if (this.storeUnavailable) return Promise.reject(new AccountStoreUnavailableError('down'));
      const user = this.ownerOf(accessToken) === userId ? this.users.get(userId) : undefined;
      return Promise.resolve(
        user?.profile
          ? { role: user.role, status: user.status, permissions: this.permissionsOf(user) }
          : null,
      );
    },
    getProfile: (accessToken, userId) => {
      if (this.storeUnavailable || this.profileUnavailable) {
        return Promise.reject(new AccountStoreUnavailableError('down'));
      }
      const user = this.ownerOf(accessToken) === userId ? this.users.get(userId) : undefined;
      return Promise.resolve(user?.profile ? { ...user.profile, status: user.status } : null);
    },
    updateProfile: (accessToken, userId, changes) => {
      if (this.storeUnavailable || this.profileUnavailable) {
        return Promise.reject(new AccountStoreUnavailableError('down'));
      }
      const user = this.ownerOf(accessToken) === userId ? this.users.get(userId) : undefined;
      if (!user?.profile || user.status !== 'active') return Promise.resolve(null);
      user.profile = {
        ...user.profile,
        ...(changes.fullName !== undefined ? { fullName: changes.fullName } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
        updatedAt: new Date('2026-10-23T09:00:00.000Z').toISOString(),
      };
      return Promise.resolve({ ...user.profile, status: user.status });
    },
    assignRole: (actorId, targetId, role): Promise<RoleAssignment> => {
      this.roleAssignments.push({ actorId, targetId, role });
      if (this.refuseRoleAssignment) {
        return Promise.reject(new RoleAssignmentError(this.refuseRoleAssignment));
      }
      const target = this.users.get(targetId);
      if (target) {
        target.role = role;
        // As assign_user_role does: a customer keeps no permission overrides.
        if (role === 'customer') target.overrides.clear();
      }
      return Promise.resolve({ userId: targetId, role, grantedAt: '2026-10-23T09:30:00.000Z' });
    },
  };

  get deps(): AuthDependencies {
    return { gateway: this.gateway, accounts: this.accounts };
  }

  /**
   * The first-party resolver, for the tests that need one: an opaque token is looked up the
   * way resolve_session() does (not revoked, not expired) and answers the session it belongs
   * to. `deps` deliberately omits it, so every existing test keeps the Supabase JWT path.
   */
  get firstParty(): SessionResolver {
    return {
      resolve: (token) => {
        const session = this.sessions.get(token);
        if (!session || session.revoked || session.expired) return Promise.resolve(null);
        return Promise.resolve({
          userId: session.userId,
          sessionId: session.sessionId,
          email: this.users.get(session.userId)?.email ?? null,
        });
      },
    };
  }

  /** Auth dependencies that accept first-party sessions before falling back to Supabase. */
  get depsWithSessions(): AuthDependencies {
    return { ...this.deps, sessions: this.firstParty };
  }
}
