import type { Pool } from 'pg';
import { withServiceRole, withUser } from '../db/user-context';
import type { SupabaseClients } from '../supabase/clients';
import { toAdminStoreError } from './admin/errors';
import { StoreUnavailableError, toStoreError, type DatabaseFailure } from './commerce/errors';

/*
 * The two ways this API reaches the database
 * ------------------------------------------
 * Every module calls a database function by name rather than building SQL of its own, so
 * the same call works against Supabase (as the caller's JWT) and against a direct Postgres
 * connection (inside a transaction that carries the caller's identity). A set-returning
 * function needs `select * from`, which is the only difference between the two shapes.
 *
 * The direct path also carries the caller's verified `sessionId`, because first-party
 * sessions are opaque tokens that no JWT claim can describe; Supabase's own tokens already
 * contain that claim and travel through `supabaseRpc` instead.
 */

export type Rpc = <T>(name: string, args: Record<string, unknown>, rows?: boolean) => Promise<T>;

type SupabaseRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: DatabaseFailure | null }>;

/** The generated typings enumerate every function by name; this adapter is generic by design. */
export function supabaseRpc(clients: SupabaseClients): (accessToken: string | null) => Rpc {
  return (accessToken) => {
    const client = clients.asUser(accessToken ?? '');
    const call = client.rpc.bind(client) as unknown as SupabaseRpc;
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await call(name, args);
      if (error) throw toAdminStoreError(error, name);
      return data as T;
    };
  };
}

export interface PostgresRpcOptions {
  /**
   * Pass null arguments as SQL NULL instead of leaving them out. Leaving them out lets a
   * function's own defaults apply, which most modules rely on; a function without defaults
   * for its nullable arguments (the courier functions) needs them sent explicitly.
   */
  keepNulls?: boolean;
}

export type QueryClient = { query: <R>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }> };

async function callFunction<T>(
  client: QueryClient,
  name: string,
  args: Record<string, unknown>,
  rows: boolean,
  keepNulls: boolean,
): Promise<T> {
  const entries = Object.entries(args).filter(
    ([, argument]) => argument !== undefined && (keepNulls || argument !== null),
  );
  const parameters = await bindArguments(client, name, entries);
  const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
  const sql = rows
    ? `select * from public.${name}(${named})`
    : await functionCallSql(client, name, named);
  const result = await client.query(sql, parameters);
  if (rows) return result.rows as T;
  const row = result.rows[0] as { value: T } | undefined;
  if (row === undefined) throw new StoreUnavailableError(`${name} answered with no row`);
  return row.value;
}

/**
 * The value to bind for each argument. A JSON document (an object, or an array sent to a `json`
 * or `jsonb` parameter) is serialised to text; an array sent to an array-typed parameter
 * (`uuid[]`, `text[]`) is passed as a JS array, which `pg` encodes as a Postgres array literal.
 * Stringifying every array turned `["id"]` into text that a `uuid[]` parameter refuses (22P02).
 */
export async function bindArguments(
  client: QueryClient,
  name: string,
  entries: [string, unknown][],
): Promise<unknown[]> {
  const needsTypes = entries.some(([, argument]) => Array.isArray(argument));
  const arrayParameters = needsTypes
    ? await nativeArrayParameters(
        client,
        name,
        entries.map(([key]) => key),
      )
    : new Set<string>();
  return entries.map(([key, argument]) => {
    if (argument === null || typeof argument !== 'object') return argument;
    if (Array.isArray(argument) && arrayParameters.has(key)) return argument as unknown[];
    return JSON.stringify(argument);
  });
}

interface FunctionSignature {
  /** Input argument name -> whether its type is a Postgres array other than json/jsonb. */
  arrays: Map<string, boolean>;
}

/** The input signatures of each public function, read once from the catalogue. */
const SIGNATURES = new Map<string, FunctionSignature[]>();

async function signaturesOf(client: QueryClient, name: string): Promise<FunctionSignature[]> {
  const known = SIGNATURES.get(name);
  if (known !== undefined) return known;
  const result = await client.query<{
    names: string[] | null;
    modes: string[] | null;
    types: string[] | null;
  }>(
    `select p.proargnames as names,
            p.proargmodes::text[] as modes,
            array(select pg_catalog.format_type(u.t, null)
                    from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                         with ordinality as u(t, i) order by u.i) as types
       from pg_catalog.pg_proc p
      where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
    [name],
  );
  const signatures: FunctionSignature[] = [];
  for (const row of result.rows) {
    if (!Array.isArray(row?.names) || !Array.isArray(row.types)) continue;
    const arrays = new Map<string, boolean>();
    row.names.forEach((argument, index) => {
      const mode = row.modes?.[index] ?? 'i';
      if (mode === 'o' || mode === 't') return;
      const type = row.types?.[index] ?? '';
      arrays.set(argument, type.endsWith('[]'));
    });
    signatures.push({ arrays });
  }
  /* A function the catalogue does not describe is not cached, so a later call may find it. */
  if (signatures.length > 0) SIGNATURES.set(name, signatures);
  return signatures;
}

/** The named arguments whose parameter is an array type, so they are sent as arrays. */
async function nativeArrayParameters(
  client: QueryClient,
  name: string,
  keys: string[],
): Promise<Set<string>> {
  const signatures = await signaturesOf(client, name);
  const match = signatures.find((signature) => keys.every((key) => signature.arrays.has(key)));
  const arrays = new Set<string>();
  for (const [argument, isArray] of match?.arrays ?? []) if (isArray) arrays.add(argument);
  return arrays;
}

export function postgresRpc(
  pool: Pool,
  translate: (failure: DatabaseFailure, operation: string) => Error = toStoreError,
  options: PostgresRpcOptions = {},
): (userId: string | null, sessionId?: string | null) => Rpc {
  const keepNulls = options.keepNulls === true;
  return (userId, sessionId) =>
    async <T>(name: string, args: Record<string, unknown>, rows = false): Promise<T> => {
      try {
        return await withUser(
          pool,
          userId ?? '00000000-0000-0000-0000-000000000000',
          (client) => callFunction<T>(client, name, args, rows, keepNulls),
          sessionId,
        );
      } catch (error) {
        if (error instanceof StoreUnavailableError) throw error;
        throw translate(pgFailure(error), name);
      }
    };
}

/**
 * The same call with the server's own identity (`service_role`), for functions granted only
 * to it: background workers and webhook intake. There is no `auth.uid()` inside.
 */
export function postgresServiceRpc(
  pool: Pool,
  translate: (failure: DatabaseFailure, operation: string) => Error = toStoreError,
  options: PostgresRpcOptions = {},
): Rpc {
  const keepNulls = options.keepNulls === true;
  return async <T>(name: string, args: Record<string, unknown>, rows = false): Promise<T> => {
    try {
      return await withServiceRole(pool, (client) =>
        callFunction<T>(client, name, args, rows, keepNulls),
      );
    } catch (error) {
      if (error instanceof StoreUnavailableError) throw error;
      throw translate(pgFailure(error), name);
    }
  };
}

export function pgFailure(error: unknown): DatabaseFailure {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database error',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

/** Whether each public function returns a set, read once from the catalogue. */
const SET_RETURNING = new Map<string, boolean>();

/**
 * The SQL for calling a public database function so the answer matches what Supabase's
 * `rpc()` returns: a set-returning function (`returns table` / `setof`) comes back as one
 * JSON array of its rows (empty when there are none) instead of one composite per row, and
 * any other function as its single value. Without this a list function answered "no row"
 * when empty and unreadable composites otherwise.
 */
export async function functionCallSql(
  client: { query: <R>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }> },
  name: string,
  named: string,
): Promise<string> {
  let set = SET_RETURNING.get(name);
  if (set === undefined) {
    const result = await client.query<{ retset: boolean | null }>(
      `select bool_or(p.proretset) as retset from pg_catalog.pg_proc p
         where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
      [name],
    );
    set = result.rows[0]?.retset === true;
    SET_RETURNING.set(name, set);
  }
  return set
    ? `select coalesce(json_agg(t), '[]'::json) as value from public.${name}(${named}) t`
    : `select public.${name}(${named}) as value`;
}
