import { addressSchema, type Address, type addressInputSchema } from '@nilzora/contracts';
import type { Pool } from 'pg';
import type { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, StoreUnavailableError, toStoreError } from '../commerce/errors';

/** A validated address from POST /me/addresses or PUT /me/addresses/:id. */
export type AddressFields = z.output<typeof addressInputSchema>;

/**
 * The caller's own delivery addresses, read and written as the user (RLS applies).
 * Another account's address behaves exactly like one that does not exist.
 */
export interface AddressStore {
  list(accessToken: string, userId: string): Promise<Address[]>;
  /** Refused with address_limit_reached once the account keeps the maximum. */
  create(accessToken: string, userId: string, fields: AddressFields): Promise<Address>;
  /** Replaces every field; null when no such address belongs to the caller. */
  update(
    accessToken: string,
    userId: string,
    addressId: string,
    fields: AddressFields,
  ): Promise<Address | null>;
  /** False when no such address belongs to the caller. */
  remove(accessToken: string, userId: string, addressId: string): Promise<boolean>;
}

const ADDRESS_COLUMNS =
  'id, label, recipient_name, phone, division, district, area, address_line, postal_code, landmark, is_default, created_at, updated_at, district_info:bd_districts!addresses_district_division_fkey(delivery_zone)';

/** The same columns for direct SQL: the district's zone as a flat column (see the join below). */
const SQL_ADDRESS_COLUMNS = `a.id, a.label, a.recipient_name, a.phone, a.division, a.district, a.area,
  a.address_line, a.postal_code, a.landmark, a.is_default, a.created_at, a.updated_at,
  d.delivery_zone`;

const DISTRICT_JOIN = `left join public.bd_districts d
  on d.name = a.district and d.division = a.division`;

interface AddressRow {
  id: string;
  label: string | null;
  recipient_name: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  address_line: string;
  postal_code: string | null;
  landmark: string | null;
  is_default: boolean;
  /** A Date from the direct connection, PostgREST's ISO string otherwise. */
  created_at: string | Date;
  updated_at: string | Date;
  delivery_zone: string | null;
}

interface PostgrestAddressRow extends Omit<AddressRow, 'delivery_zone'> {
  created_at: string;
  updated_at: string;
  district_info: { delivery_zone: string } | null;
}

function toAddress(row: AddressRow): Address {
  return conform(
    addressSchema,
    {
      id: row.id,
      label: row.label,
      recipientName: row.recipient_name,
      phone: row.phone,
      division: row.division,
      district: row.district,
      area: row.area,
      addressLine: row.address_line,
      postalCode: row.postal_code,
      landmark: row.landmark,
      isDefault: row.is_default,
      deliveryZone: row.delivery_zone ?? undefined,
      createdAt: isoTimestamp(row.created_at),
      updatedAt: isoTimestamp(row.updated_at),
    },
    'addresses',
  );
}

function fromPostgrest(row: PostgrestAddressRow): Address {
  return toAddress({ ...row, delivery_zone: row.district_info?.delivery_zone ?? null });
}

/**
 * Column values for an insert or a full replacement. Only `isDefault: true` is
 * applied: the default moves by choosing another address, so an account with
 * addresses always keeps exactly one default (the database clears the old one).
 */
function toColumns(fields: AddressFields) {
  return {
    label: fields.label ?? null,
    recipient_name: fields.recipientName,
    phone: fields.phone,
    division: fields.division,
    district: fields.district,
    area: fields.area,
    address_line: fields.addressLine,
    postal_code: fields.postalCode ?? null,
    landmark: fields.landmark ?? null,
    ...(fields.isDefault === true ? { is_default: true } : {}),
  };
}

export function createSupabaseAddressStore(clients: SupabaseClients): AddressStore {
  return {
    async list(accessToken, userId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('addresses')
        .select(ADDRESS_COLUMNS)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id');
      if (error) throw toStoreError(error, 'addresses');
      return data.map(fromPostgrest);
    },

    async create(accessToken, _userId, fields) {
      // The owner is not a writable column: the database sets it from the token.
      const { data, error } = await clients
        .asUser(accessToken)
        .from('addresses')
        .insert(toColumns(fields))
        .select(ADDRESS_COLUMNS)
        .single();
      if (error) throw toStoreError(error, 'addresses');
      return fromPostgrest(data);
    },

    async update(accessToken, userId, addressId, fields) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('addresses')
        .update(toColumns(fields))
        .eq('id', addressId)
        .eq('user_id', userId)
        .select(ADDRESS_COLUMNS)
        .maybeSingle();
      if (error) throw toStoreError(error, 'addresses');
      return data ? fromPostgrest(data) : null;
    },

    async remove(accessToken, userId, addressId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('addresses')
        .delete()
        .eq('id', addressId)
        .eq('user_id', userId)
        .select('id');
      if (error) throw toStoreError(error, 'addresses');
      return data.length > 0;
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ421`) as a string `code` and DETAIL as `detail`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

/**
 * The same address operations over a direct PostgreSQL connection instead of Supabase's
 * Data API. Every statement runs inside `withUser`, which assumes the `authenticated`
 * role and the JWT claims behind `auth.uid()`, so the existing RLS policies, column
 * grants and triggers (address limit, single default, default promotion) behave exactly
 * as they did for PostgREST requests.
 *
 * The access token stays in the interface because the other stores still use it as
 * their RLS context; here the verified account id is enough and the token is never read.
 */
export function createPostgresAddressStore(pool: Pool): AddressStore {
  function failure(error: unknown): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toStoreError(pgFailure(error), 'addresses');
  }

  return {
    async list(_accessToken, userId) {
      const sql = `select ${SQL_ADDRESS_COLUMNS}
        from public.addresses a
        ${DISTRICT_JOIN}
        where a.user_id = $1
        order by a.is_default desc, a.created_at desc, a.id`;
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<AddressRow>(sql, [userId]);
          return result.rows.map(toAddress);
        });
      } catch (error) {
        throw failure(error);
      }
    },

    async create(_accessToken, userId, fields) {
      // The owner is not a writable column: the column default takes it from auth.uid().
      const sql = `with written as (
          insert into public.addresses (
            label, recipient_name, phone, division, district, area, address_line,
            postal_code, landmark, is_default
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning *
        )
        select ${SQL_ADDRESS_COLUMNS}
        from written a
        ${DISTRICT_JOIN}`;
      const parameters = [
        fields.label ?? null,
        fields.recipientName,
        fields.phone,
        fields.division,
        fields.district,
        fields.area,
        fields.addressLine,
        fields.postalCode ?? null,
        fields.landmark ?? null,
        fields.isDefault === true,
      ];
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<AddressRow>(sql, parameters);
          const row = result.rows[0];
          if (!row) throw new StoreUnavailableError('addresses returned no inserted row');
          return toAddress(row);
        });
      } catch (error) {
        throw failure(error);
      }
    },

    async update(_accessToken, userId, addressId, fields) {
      // A full replacement of the editable columns. `is_default` is only ever set to
      // true: choosing another address moves the default, so it is never cleared here.
      const assignments = [
        'label = $1',
        'recipient_name = $2',
        'phone = $3',
        'division = $4',
        'district = $5',
        'area = $6',
        'address_line = $7',
        'postal_code = $8',
        'landmark = $9',
      ];
      const parameters: unknown[] = [
        fields.label ?? null,
        fields.recipientName,
        fields.phone,
        fields.division,
        fields.district,
        fields.area,
        fields.addressLine,
        fields.postalCode ?? null,
        fields.landmark ?? null,
      ];
      if (fields.isDefault === true) {
        parameters.push(true);
        assignments.push(`is_default = $${parameters.length}`);
      }
      parameters.push(addressId, userId);
      const idParameter = parameters.length - 1;
      const ownerParameter = parameters.length;

      const sql = `with written as (
          update public.addresses
          set ${assignments.join(', ')}
          where id = $${idParameter} and user_id = $${ownerParameter}
          returning *
        )
        select ${SQL_ADDRESS_COLUMNS}
        from written a
        ${DISTRICT_JOIN}`;
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<AddressRow>(sql, parameters);
          return result.rows[0] ? toAddress(result.rows[0]) : null;
        });
      } catch (error) {
        throw failure(error);
      }
    },

    async remove(_accessToken, userId, addressId) {
      const sql = 'delete from public.addresses where id = $1 and user_id = $2 returning id';
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query(sql, [addressId, userId]);
          return (result.rowCount ?? 0) > 0;
        });
      } catch (error) {
        throw failure(error);
      }
    },
  };
}
