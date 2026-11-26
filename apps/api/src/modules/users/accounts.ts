import {
  appRoleSchema,
  PERMISSIONS,
  PROFILE_STATUSES,
  type AppRole,
  type Permission,
  type ProfileStatus,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withServiceRole, withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';

export interface AccountAccess {
  role: AppRole;
  status: ProfileStatus;
  /**
   * Effective permissions as the database computes them right now: role defaults plus
   * grants, minus denials (a denial always wins). Empty for suspended accounts.
   */
  permissions: ReadonlySet<Permission>;
}

export interface ProfileRecord {
  fullName: string | null;
  phone: string | null;
  status: ProfileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileChanges {
  fullName?: string | null;
  phone?: string | null;
}

export interface RoleAssignment {
  userId: string;
  role: AppRole;
  grantedAt: string;
}

/** The database could not be reached or answered unexpectedly; nothing was granted. */
export class AccountStoreUnavailableError extends Error {
  override readonly name = 'AccountStoreUnavailableError';
}

export type RoleAssignmentRefusal =
  | 'own_role'
  | 'actor_not_permitted'
  | 'owner_only'
  | 'owner_role_protected'
  | 'last_owner'
  | 'target_not_found';

/** The database refused a role change (see assign_user_role in the migrations). */
export class RoleAssignmentError extends Error {
  override readonly name = 'RoleAssignmentError';
  readonly refusal: RoleAssignmentRefusal;

  constructor(refusal: RoleAssignmentRefusal) {
    super(`Role assignment refused: ${refusal}`);
    this.refusal = refusal;
  }
}

/** Database access for identity data. */
export interface AccountStore {
  /**
   * Role, status and effective permissions of the token's own account, from the
   * database (my_access, run as the user). Null if the profile or role is missing.
   */
  loadAccess(accessToken: string, userId: string): Promise<AccountAccess | null>;
  /** The user's own profile, read under RLS. */
  getProfile(accessToken: string, userId: string): Promise<ProfileRecord | null>;
  /** Updates the user's own editable fields under RLS; null if no row was updated. */
  updateProfile(
    accessToken: string,
    userId: string,
    changes: ProfileChanges,
  ): Promise<ProfileRecord | null>;
  /** Privileged role change through the database's rule-checking function. */
  assignRole(actorId: string, targetId: string, role: AppRole): Promise<RoleAssignment>;
}

const REFUSALS: Record<string, RoleAssignmentRefusal> = {
  NZ001: 'own_role',
  NZ002: 'actor_not_permitted',
  NZ003: 'owner_only',
  NZ004: 'last_owner',
  NZ005: 'owner_role_protected',
  NZ404: 'target_not_found',
};

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSIONS);

const accessSchema = z.object({
  role: appRoleSchema,
  status: z.enum(PROFILE_STATUSES),
  permissions: z.array(z.string()),
});

const PROFILE_COLUMNS = 'full_name, phone, status, created_at, updated_at';

/** `created_at`/`updated_at` arrive as strings from PostgREST and as Dates from `pg`. */
function toProfile(row: {
  full_name: string | null;
  phone: string | null;
  status: ProfileStatus;
  created_at: string | Date;
  updated_at: string | Date;
}): ProfileRecord {
  return {
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function createSupabaseAccountStore(clients: SupabaseClients): AccountStore {
  return {
    async loadAccess(accessToken) {
      // my_access reads auth.uid() from the token itself, never an id from the API.
      const { data, error } = await clients.asUser(accessToken).rpc('my_access');
      if (error) throw new AccountStoreUnavailableError(error.message, { cause: error });
      if (data === null) return null;
      const parsed = accessSchema.safeParse(data);
      if (!parsed.success) {
        throw new AccountStoreUnavailableError('my_access returned an unexpected answer', {
          cause: parsed.error,
        });
      }
      const { role, status, permissions } = parsed.data;
      return {
        role,
        status,
        // A permission the API does not know yet is ignored, never guessed at.
        permissions: new Set(
          permissions.filter((name): name is Permission => KNOWN_PERMISSIONS.has(name)),
        ),
      };
    },

    async getProfile(accessToken, userId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new AccountStoreUnavailableError(error.message, { cause: error });
      return data ? toProfile(data) : null;
    },

    async updateProfile(accessToken, userId, changes) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('profiles')
        .update({
          ...(changes.fullName !== undefined ? { full_name: changes.fullName } : {}),
          ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
        })
        .eq('id', userId)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      if (error) throw new AccountStoreUnavailableError(error.message, { cause: error });
      return data ? toProfile(data) : null;
    },

    async assignRole(actorId, targetId, role) {
      const { data, error } = await clients.admin.rpc('assign_user_role', {
        p_actor_id: actorId,
        p_target_id: targetId,
        p_role: role,
      });
      if (error) {
        const refusal = REFUSALS[error.code];
        if (refusal) throw new RoleAssignmentError(refusal);
        throw new AccountStoreUnavailableError(error.message, { cause: error });
      }
      return {
        userId: data.user_id,
        role: data.role,
        grantedAt: new Date(data.granted_at).toISOString(),
      };
    },
  };
}

type ProfileRow = {
  full_name: string | null;
  phone: string | null;
  status: ProfileStatus;
  created_at: Date;
  updated_at: Date;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'database request failed';
}

/** PostgreSQL surfaces `RAISE EXCEPTION ... USING ERRCODE` as a string `code`. */
function pgErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Identity data over a direct PostgreSQL connection instead of Supabase's Data API.
 *
 * Every query runs inside `withUser`, which assumes the `authenticated` role and the
 * JWT claims behind `auth.uid()`, so Row Level Security, column privileges and the
 * security-definer routines behave exactly as they did for PostgREST requests. The
 * access token is still part of the interface because the other stores use it as their
 * RLS context; here the verified account id is enough and the token is neither used
 * nor logged.
 */
export function createPostgresAccountStore(pool: Pool): AccountStore {
  return {
    async loadAccess(_accessToken, userId) {
      let data: unknown;
      try {
        data = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ access: unknown }>(
            'select public.my_access() as access',
          );
          return result.rows[0]?.access ?? null;
        });
      } catch (error) {
        throw new AccountStoreUnavailableError(messageOf(error), { cause: error });
      }
      if (data === null || data === undefined) return null;
      const parsed = accessSchema.safeParse(data);
      if (!parsed.success) {
        throw new AccountStoreUnavailableError('my_access returned an unexpected answer', {
          cause: parsed.error,
        });
      }
      const { role, status, permissions } = parsed.data;
      return {
        role,
        status,
        // A permission the API does not know yet is ignored, never guessed at.
        permissions: new Set(
          permissions.filter((name): name is Permission => KNOWN_PERMISSIONS.has(name)),
        ),
      };
    },

    async getProfile(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<ProfileRow>(
            `select ${PROFILE_COLUMNS} from public.profiles where id = $1`,
            [userId],
          );
          const row = result.rows[0];
          return row ? toProfile(row) : null;
        });
      } catch (error) {
        throw new AccountStoreUnavailableError(messageOf(error), { cause: error });
      }
    },

    async updateProfile(_accessToken, userId, changes) {
      // Only the fields the caller sent are written; values stay parameterised.
      const assignments: string[] = [];
      const values: unknown[] = [];
      if (changes.fullName !== undefined) {
        values.push(changes.fullName);
        assignments.push(`full_name = $${values.length}`);
      }
      if (changes.phone !== undefined) {
        values.push(changes.phone);
        assignments.push(`phone = $${values.length}`);
      }
      if (assignments.length === 0) return null;
      values.push(userId);

      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<ProfileRow>(
            `update public.profiles set ${assignments.join(', ')} where id = $${values.length} returning ${PROFILE_COLUMNS}`,
            values,
          );
          const row = result.rows[0];
          return row ? toProfile(row) : null;
        });
      } catch (error) {
        throw new AccountStoreUnavailableError(messageOf(error), { cause: error });
      }
    },

    async assignRole(actorId, targetId, role) {
      try {
        const result = await withServiceRole(pool, (client) =>
          client.query<{ user_id: string; role: AppRole; granted_at: Date }>(
            'select user_id, role, granted_at from public.assign_user_role($1, $2, $3)',
            [actorId, targetId, role],
          ),
        );
        const row = result.rows[0];
        if (!row) throw new AccountStoreUnavailableError('assign_user_role returned no row');
        return {
          userId: row.user_id,
          role: row.role,
          grantedAt: new Date(row.granted_at).toISOString(),
        };
      } catch (error) {
        const refusal = REFUSALS[pgErrorCode(error) ?? ''];
        if (refusal) throw new RoleAssignmentError(refusal);
        if (error instanceof AccountStoreUnavailableError) throw error;
        throw new AccountStoreUnavailableError(messageOf(error), { cause: error });
      }
    },
  };
}
