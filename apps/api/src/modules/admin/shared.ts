import type { AccountRef } from '@nilzora/contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { NilzoraSupabaseClient } from '../../supabase/clients';

/**
 * `client.rpc` without the generated argument types, for database functions added since the
 * types were generated (or overloaded). Callers still validate every answer with a contract
 * schema, and pass the same arguments the function declares.
 */
export function untypedRpc(client: NilzoraSupabaseClient): (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { code: string; message: string; details?: string | null } | null;
}> {
  return client.rpc.bind(client) as never;
}
import { toAdminStoreError } from './errors';

/**
 * Body of an action that takes no input. Missing or {} only: any field (a status, an
 * actor, an amount) is refused rather than silently ignored.
 */
export const emptyBodySchema = z.strictObject({}).optional();

/** PostgREST: the requested range starts past the last row. */
export const RANGE_NOT_SATISFIABLE = 'PGRST103';

export interface Page {
  limit: number;
  offset: number;
}

export function pageOf(query: { page: number; pageSize: number }): Page {
  return { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
}

export function pageInfo(query: { page: number; pageSize: number }, total: number) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

/**
 * A nullable SQL function argument. PostgREST passes JSON null as SQL NULL, but the
 * generated types cannot express nullable function arguments.
 */
export function sqlNull<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}

/** Anything but letters, digits, spaces and hyphens: LIKE wildcards and filter syntax. */
const SEARCH_UNSAFE = /[^\p{L}\p{N}\s-]/gu;

/**
 * Prepares admin search text for an `ilike` filter: characters with a meaning in LIKE
 * patterns or in PostgREST filter syntax become spaces, so no input can widen the
 * match or add a filter. Null when nothing searchable remains.
 */
export function searchTerm(text: string): string | null {
  const term = text.replace(SEARCH_UNSAFE, ' ').replace(/\s+/gu, ' ').trim();
  return term === '' ? null : term;
}

export interface AccountName {
  name: string | null;
  email: string | null;
}

/**
 * Names and emails of staff accounts, read as the caller (admin_account_names). A
 * caller who may not see them gets an empty map, so the screens show ids only.
 */
export async function staffNames(
  client: NilzoraSupabaseClient,
  ids: readonly (string | null)[],
): Promise<Map<string, AccountName>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  const names = new Map<string, AccountName>();
  if (unique.length === 0) return names;
  const { data, error } = await client.rpc('admin_account_names', { p_ids: unique });
  if (error) {
    if (error.code === 'NZ403') return names;
    throw toAdminStoreError(error, 'admin_account_names');
  }
  for (const row of data) {
    names.set(row.id, { name: row.full_name ?? null, email: row.email ?? null });
  }
  return names;
}

/** An account reference with whatever name the caller may see. */
export function accountRef(
  id: string | null,
  names: ReadonlyMap<string, AccountName>,
): AccountRef | null {
  if (id === null) return null;
  const known = names.get(id);
  return { id, name: known?.name ?? null, email: known?.email ?? null };
}

/**
 * Names and emails of staff accounts over the direct connection, read as the caller
 * (`admin_account_names`). A caller who may not see them gets an empty map, so the
 * screens show ids only, exactly as with the PostgREST call.
 */
export async function staffNamesForUser(
  pool: Pool,
  userId: string,
  ids: readonly (string | null)[],
): Promise<Map<string, AccountName>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  const names = new Map<string, AccountName>();
  if (unique.length === 0) return names;

  try {
    const rows = await withUser(pool, userId, async (client) => {
      const result = await client.query<{ id: string; email: string; full_name: string | null }>(
        'select * from public.admin_account_names($1::uuid[])',
        [unique],
      );
      return result.rows;
    });
    for (const row of rows) {
      names.set(row.id, { name: row.full_name ?? null, email: row.email ?? null });
    }
  } catch (error) {
    const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
    const code = typeof fields?.code === 'string' ? fields.code : '';
    if (code !== 'NZ403') {
      throw toAdminStoreError(
        {
          code,
          message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
          details: typeof fields?.detail === 'string' ? fields.detail : null,
        },
        'admin_account_names',
      );
    }
  }
  return names;
}
