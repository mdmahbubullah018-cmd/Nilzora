import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresAddressStore, type AddressFields } from '../../modules/addresses/store';
import { CommerceRefusalError, StoreUnavailableError } from '../../modules/commerce/errors';

/*
 * Real integration test for the direct-PostgreSQL addresses store: no Supabase Auth and
 * no PostgREST, only a connection that assumes each account's identity the way PostgREST
 * did. Fixtures are real `auth.users` rows (their trigger creates the profile) and are
 * deleted afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const addresses = createPostgresAddressStore(pool);

/** The shared store interface still passes an access token; the direct connection does not use it. */
const NO_TOKEN = 'direct-connection';

const run = randomUUID().slice(0, 8);
const created: string[] = [];
let district: { name: string; division: AddressFields['division'] };

async function createAccount(label: string): Promise<string> {
  const id = randomUUID();
  // Nilzora owns accounts now: provision_account() creates the profile and its customer role.
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-${run}-${label}@example.com`,
    `Account ${label}`,
  ]);
  created.push(id);
  return id;
}

function fields(overrides: Partial<AddressFields> = {}): AddressFields {
  return {
    recipientName: 'Nilzora Customer',
    phone: '+8801712345678',
    division: district.division,
    district: district.name,
    area: 'Gulshan',
    addressLine: 'House 12, Road 5',
    postalCode: '1212',
    landmark: 'Near the lake',
    ...overrides,
  };
}

beforeAll(async () => {
  // Reference data from the migrations; the test asserts the join to it still works.
  const result = await pool.query<{ name: string; division: AddressFields['division'] }>(
    'select name, division from public.bd_districts order by name limit 1',
  );
  const row = result.rows[0];
  if (!row) throw new Error('bd_districts is empty; run the migrations first');
  district = row;
});

afterAll(async () => {
  if (created.length > 0) {
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created]);
  }
  await pool.end();
});

describe('addresses over the direct connection', () => {
  it('creates, lists, updates and deletes an address', async () => {
    const owner = await createAccount('crud');

    const createdAddress = await addresses.create(NO_TOKEN, owner, fields({ label: 'Home' }));
    expect(createdAddress).toMatchObject({
      label: 'Home',
      recipientName: 'Nilzora Customer',
      district: district.name,
      isDefault: true,
    });
    // The delivery zone comes from the bd_districts reference row.
    expect(typeof createdAddress.deliveryZone).toBe('string');

    const listed = await addresses.list(NO_TOKEN, owner);
    expect(listed.map((address) => address.id)).toEqual([createdAddress.id]);

    const updated = await addresses.update(NO_TOKEN, owner, createdAddress.id, {
      ...fields({ label: 'Office', area: 'Banani' }),
      isDefault: true,
    });
    if (!updated) throw new Error('the address was not updated');
    expect(updated).toMatchObject({ id: createdAddress.id, label: 'Office', area: 'Banani' });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(createdAddress.updatedAt),
    );

    await expect(addresses.remove(NO_TOKEN, owner, createdAddress.id)).resolves.toBe(true);
    await expect(addresses.list(NO_TOKEN, owner)).resolves.toEqual([]);
    await expect(addresses.remove(NO_TOKEN, owner, createdAddress.id)).resolves.toBe(false);
  });

  it('keeps one account from reading, changing or deleting another account address', async () => {
    const alice = await createAccount('alice');
    const bob = await createAccount('bob');
    const aliceAddress = await addresses.create(NO_TOKEN, alice, fields({ label: 'Alice home' }));

    await expect(addresses.list(NO_TOKEN, bob)).resolves.toEqual([]);
    await expect(
      addresses.update(NO_TOKEN, bob, aliceAddress.id, fields({ label: 'Hijacked' })),
    ).resolves.toBeNull();
    await expect(addresses.remove(NO_TOKEN, bob, aliceAddress.id)).resolves.toBe(false);

    // Alice's address is untouched and still hers.
    const aliceList = await addresses.list(NO_TOKEN, alice);
    expect(aliceList.map((address) => address.id)).toEqual([aliceAddress.id]);
    expect(aliceList[0]?.label).toBe('Alice home');
    expect(aliceList[0]?.recipientName).toBe('Nilzora Customer');
  });

  it('refuses an identity that is not a verified account id', async () => {
    await expect(addresses.list(NO_TOKEN, 'not-a-uuid')).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });

  it('reports a database failure instead of answering with data', async () => {
    const owner = await createAccount('bad-district');
    await expect(
      addresses.create(NO_TOKEN, owner, fields({ district: 'No Such District' })),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
    await expect(addresses.list(NO_TOKEN, owner)).resolves.toEqual([]);
  });

  it('keeps the single default and promotes another address when it is deleted', async () => {
    const owner = await createAccount('defaults');
    const first = await addresses.create(NO_TOKEN, owner, fields({ label: 'First' }));
    const second = await addresses.create(NO_TOKEN, owner, fields({ label: 'Second' }));
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);

    const promoted = await addresses.create(
      NO_TOKEN,
      owner,
      fields({ label: 'Chosen', isDefault: true }),
    );
    const afterMove = await addresses.list(NO_TOKEN, owner);
    expect(afterMove.filter((address) => address.isDefault).map((address) => address.id)).toEqual([
      promoted.id,
    ]);

    await addresses.remove(NO_TOKEN, owner, promoted.id);
    const afterDelete = await addresses.list(NO_TOKEN, owner);
    expect(afterDelete).toHaveLength(2);
    expect(afterDelete.filter((address) => address.isDefault)).toHaveLength(1);
  });

  it('reports the database address limit as a business refusal', async () => {
    const owner = await createAccount('limit');
    for (let index = 0; index < 10; index += 1) {
      await addresses.create(NO_TOKEN, owner, fields({ label: `Address ${index}` }));
    }
    const refusal = addresses.create(NO_TOKEN, owner, fields({ label: 'One too many' }));
    await expect(refusal).rejects.toBeInstanceOf(CommerceRefusalError);
    await expect(refusal).rejects.toMatchObject({ refusal: 'address_limit_reached' });
  });
});
