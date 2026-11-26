import {
  adminCustomerSummarySchema,
  adminRoleSchema,
  PERMISSION_EFFECTS,
  permissionInfoSchema,
  PERMISSIONS,
  staffMemberSchema,
  type AdminCustomerSummary,
  type AdminRole,
  type Permission,
  type PermissionEffect,
  type PermissionInfo,
  type ProfileStatus,
  type StaffMember,
} from '@nilzora/contracts';
import { z } from 'zod';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, StoreUnavailableError } from '../commerce/errors';
import { toAdminStoreError } from './errors';
import { sqlNull, untypedRpc, type Page } from './shared';

export interface CustomerFilters {
  query?: string | undefined;
  status?: ProfileStatus | undefined;
}

/**
 * Customer and staff accounts, always as the signed-in caller: the database functions
 * check the caller's permission, the role hierarchy and the no-self-management rule
 * themselves, and write the audit log.
 */
export interface AdminAccountStore {
  /** Newest accounts first; staff accounts never appear. */
  listCustomers(
    accessToken: string,
    userId: string,
    filters: CustomerFilters,
    page: Page,
  ): Promise<{ customers: AdminCustomerSummary[]; total: number }>;
  /** Null unless the account exists and is a customer. */
  getCustomer(
    accessToken: string,
    userId: string,
    customerId: string,
  ): Promise<AdminCustomerSummary | null>;
  setCustomerStatus(
    accessToken: string,
    userId: string,
    customerId: string,
    status: ProfileStatus,
    reason: string | undefined,
  ): Promise<void>;
  /** Owners first, then admins, staff and moderators. */
  listStaff(accessToken: string, userId: string): Promise<StaffMember[]>;
  /**
   * Every role with the permissions it holds by default. The owner role lists the whole
   * permission catalogue (what an owner holds), not stored defaults. Needs staff.roles.assign
   * or staff.permissions.manage, checked again by the database.
   */
  listRoles(accessToken: string, userId: string): Promise<AdminRole[]>;
  /** Every permission and what it allows. */
  listPermissions(accessToken: string, userId: string): Promise<PermissionInfo[]>;
  setPermission(
    accessToken: string,
    userId: string,
    targetId: string,
    permission: Permission,
    effect: PermissionEffect | null,
  ): Promise<void>;
  /**
   * Checks, as the caller, that the account is a pending invitation the caller may
   * re-send (staff.invite; admins only by owners), records it in the audit log and
   * returns the invitee's email address.
   */
  prepareInvitationResend(accessToken: string, userId: string, targetId: string): Promise<string>;
}

interface CustomerRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  status: string;
  created_at: string | Date;
  order_count: number | string;
  last_order_at: string | Date | null;
  total_count: number | string;
}

function toCustomer(row: Omit<CustomerRow, 'total_count'>) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
    createdAt: isoTimestamp(row.created_at),
    orderCount: Number(row.order_count),
    lastOrderAt: row.last_order_at === null ? null : isoTimestamp(row.last_order_at),
  };
}

const customersSchema = z.array(adminCustomerSummarySchema);
const staffSchema = z.array(staffMemberSchema);
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSIONS);
const namesSchema = z.array(z.string());
const overridesSchema = z.array(
  z.object({ permission: z.string(), effect: z.enum(PERMISSION_EFFECTS) }),
);

/** The roles as the database reports them; names this API does not know yet are left out. */
function toRoles(value: unknown): AdminRole[] {
  const rows = conform(
    z.array(z.object({ role: z.string(), permissions: z.array(z.string()) })),
    value,
    'admin_list_roles',
  );
  return conform(
    z.array(adminRoleSchema),
    rows.map((row) => ({
      role: row.role,
      permissions: row.permissions.filter((name) => KNOWN_PERMISSIONS.has(name)),
    })),
    'admin_list_roles',
  );
}

export function createSupabaseAdminAccountStore(clients: SupabaseClients): AdminAccountStore {
  async function searchCustomers(
    accessToken: string,
    filters: CustomerFilters,
    { limit, offset }: Page,
  ) {
    const { data, error } = await clients.asUser(accessToken).rpc('admin_list_customers', {
      p_query: sqlNull(filters.query),
      p_status: sqlNull(filters.status),
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw toAdminStoreError(error, 'admin_list_customers');
    return data as CustomerRow[];
  }

  return {
    async listCustomers(accessToken, _userId, filters, page) {
      const rows = await searchCustomers(accessToken, filters, page);
      // The total comes with each row, so a page past the end asks once more for it.
      const counted =
        rows.length > 0 || page.offset === 0
          ? rows
          : await searchCustomers(accessToken, filters, { limit: 1, offset: 0 });
      return {
        customers: conform(customersSchema, rows.map(toCustomer), 'admin_list_customers'),
        total: Number(counted[0]?.total_count ?? 0),
      };
    },

    async getCustomer(accessToken, _userId, customerId) {
      // admin_get_customer checks customers.read for the caller and returns customer
      // accounts only (nothing for staff ids), email included.
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_get_customer', { p_id: customerId });
      if (error) throw toAdminStoreError(error, 'admin_get_customer');
      const row = data[0];
      return row
        ? conform(adminCustomerSummarySchema, toCustomer(row), 'admin_get_customer')
        : null;
    },

    async setCustomerStatus(accessToken, _userId, customerId, status, reason) {
      const { error } = await clients.asUser(accessToken).rpc('admin_set_account_status', {
        p_target: customerId,
        p_status: status,
        p_reason: sqlNull(reason),
      });
      if (error) throw toAdminStoreError(error, 'admin_set_account_status');
    },

    async listRoles(accessToken) {
      const { data, error } = await untypedRpc(clients.asUser(accessToken))('admin_list_roles');
      if (error) throw toAdminStoreError(error, 'admin_list_roles');
      return toRoles(data);
    },

    async listStaff(accessToken, _userId) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_list_staff');
      if (error) throw toAdminStoreError(error, 'admin_list_staff');
      const members = data.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name ?? null,
        role: row.role,
        status: row.status,
        grantedAt: isoTimestamp(row.granted_at),
        // Names the API does not know yet are left out rather than failing the list.
        overrides: conform(overridesSchema, row.overrides, 'admin_list_staff').filter((override) =>
          KNOWN_PERMISSIONS.has(override.permission),
        ),
        permissions: conform(namesSchema, row.permissions, 'admin_list_staff').filter((name) =>
          KNOWN_PERMISSIONS.has(name),
        ),
        invitationPending: row.invitation_pending,
      }));
      return conform(staffSchema, members, 'admin_list_staff');
    },

    async listPermissions(accessToken, _userId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('permissions')
        .select('name, description')
        .order('name');
      if (error) throw toAdminStoreError(error, 'permissions');
      return conform(
        z.array(permissionInfoSchema),
        data.filter((row) => KNOWN_PERMISSIONS.has(row.name)),
        'permissions',
      );
    },

    async prepareInvitationResend(accessToken, _userId, userId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_prepare_invitation_resend', { p_user_id: userId });
      if (error) throw toAdminStoreError(error, 'admin_prepare_invitation_resend');
      return conform(z.string().min(3), data, 'admin_prepare_invitation_resend');
    },

    async setPermission(accessToken, _userId, userId, permission, effect) {
      const { error } = await clients.asUser(accessToken).rpc('admin_set_permission', {
        p_target: userId,
        p_permission: permission,
        p_effect: sqlNull(effect),
      });
      if (error) throw toAdminStoreError(error, 'admin_set_permission');
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`, `23505`, `23514`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

interface StaffRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  granted_at: string | Date;
  overrides: unknown;
  permissions: unknown;
  invitation_pending: boolean;
}

/**
 * Customer and staff accounts over a direct PostgreSQL connection. Every function is
 * security-definer and re-checks the caller's own permission, the role hierarchy and
 * the no-self-management rule, so running it inside `withUser` keeps exactly the same
 * authorization boundary as the PostgREST call did.
 */
export function createPostgresAdminAccountStore(pool: Pool): AdminAccountStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  async function searchCustomers(
    userId: string,
    filters: CustomerFilters,
    { limit, offset }: Page,
  ): Promise<CustomerRow[]> {
    return withUser(pool, userId, async (client) => {
      const result = await client.query<CustomerRow>(
        'select * from public.admin_list_customers($1, $2::public.profile_status, $3, $4)',
        [filters.query ?? null, filters.status ?? null, limit, offset],
      );
      return result.rows;
    });
  }

  return {
    async listCustomers(_accessToken, userId, filters, page) {
      try {
        const rows = await searchCustomers(userId, filters, page);
        // The total comes with each row, so a page past the end asks once more for it.
        const counted =
          rows.length > 0 || page.offset === 0
            ? rows
            : await searchCustomers(userId, filters, { limit: 1, offset: 0 });
        return {
          customers: conform(customersSchema, rows.map(toCustomer), 'admin_list_customers'),
          total: Number(counted[0]?.total_count ?? 0),
        };
      } catch (error) {
        throw failure(error, 'admin_list_customers');
      }
    },

    async getCustomer(_accessToken, userId, customerId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<Omit<CustomerRow, 'total_count'>>(
            'select * from public.admin_get_customer($1::uuid)',
            [customerId],
          );
          const row = result.rows[0];
          return row
            ? conform(adminCustomerSummarySchema, toCustomer(row), 'admin_get_customer')
            : null;
        });
      } catch (error) {
        throw failure(error, 'admin_get_customer');
      }
    },

    async setCustomerStatus(_accessToken, userId, customerId, status, reason) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query(
            'select public.admin_set_account_status($1::uuid, $2::public.profile_status, $3)',
            [customerId, status, reason ?? null],
          );
        });
      } catch (error) {
        throw failure(error, 'admin_set_account_status');
      }
    },

    async listRoles(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_list_roles() as value',
          );
          return toRoles(result.rows[0]?.value);
        });
      } catch (error) {
        throw failure(error, 'admin_list_roles');
      }
    },

    async listStaff(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<StaffRow>('select * from public.admin_list_staff()');
          const members = result.rows.map((row) => ({
            id: row.id,
            email: row.email,
            fullName: row.full_name ?? null,
            role: row.role,
            status: row.status,
            grantedAt: isoTimestamp(row.granted_at),
            // Names the API does not know yet are left out rather than failing the list.
            overrides: conform(overridesSchema, row.overrides, 'admin_list_staff').filter(
              (override) => KNOWN_PERMISSIONS.has(override.permission),
            ),
            permissions: conform(namesSchema, row.permissions, 'admin_list_staff').filter((name) =>
              KNOWN_PERMISSIONS.has(name),
            ),
            invitationPending: row.invitation_pending,
          }));
          return conform(staffSchema, members, 'admin_list_staff');
        });
      } catch (error) {
        throw failure(error, 'admin_list_staff');
      }
    },

    async listPermissions(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ name: string; description: string }>(
            'select name, description from public.permissions order by name',
          );
          return conform(
            z.array(permissionInfoSchema),
            result.rows.filter((row) => KNOWN_PERMISSIONS.has(row.name)),
            'permissions',
          );
        });
      } catch (error) {
        throw failure(error, 'permissions');
      }
    },

    async prepareInvitationResend(_accessToken, userId, targetId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ email: string }>(
            'select public.admin_prepare_invitation_resend($1::uuid) as email',
            [targetId],
          );
          return conform(
            z.string().min(3),
            result.rows[0]?.email,
            'admin_prepare_invitation_resend',
          );
        });
      } catch (error) {
        throw failure(error, 'admin_prepare_invitation_resend');
      }
    },

    async setPermission(_accessToken, userId, targetId, permission, effect) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_set_permission($1::uuid, $2, $3)', [
            targetId,
            permission,
            effect ?? null,
          ]);
        });
      } catch (error) {
        throw failure(error, 'admin_set_permission');
      }
    },
  };
}
