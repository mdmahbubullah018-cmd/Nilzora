import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';
import { createPostgresAdminOrderStore } from '../../modules/admin/orders-store';
import { AdminRefusalError } from '../../modules/admin/errors';
import { createPostgresCourierStore } from '../../modules/couriers/store';

/*
 * The courier store over the direct connection, against the real functions of
 * 20261223091000_courier_foundation.sql. Read-only on purpose: shipment events and the COD
 * ledger are append-only, so a fixture shipment could never be removed again. Every call
 * here either reads nothing that exists or is refused, which still proves the call shapes
 * (named arguments with explicit nulls), the service-role path and the refusal mapping.
 * The writing workflows are covered by supabase/tests/couriers.test.sql (rolled back).
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 2 });
const store = createPostgresCourierStore(pool);

/** An account id that exists nowhere: it holds no permission. */
const stranger = { accessToken: 'direct-connection', userId: randomUUID() };

afterAll(async () => {
  await pool.end();
});

describe('courier store over the direct connection', () => {
  it('refuses a caller without courier permissions with the mapped refusal', async () => {
    await expect(store.config(stranger)).rejects.toBeInstanceOf(AdminRefusalError);
    await expect(store.config(stranger)).rejects.toMatchObject({ refusal: 'missing_permission' });
    await expect(
      store.listShipments(
        stranger,
        {
          status: null,
          provider: null,
          kind: null,
          query: null,
          from: null,
          to: null,
          includeMock: false,
        },
        { limit: 10, offset: 0 },
      ),
    ).rejects.toMatchObject({ refusal: 'missing_permission' });
  });

  it('reaches admin_record_portal_booking (explicit nulls) and refuses a stranger', async () => {
    await expect(
      store.recordPortalBooking(stranger, 'NZ999999999', {
        returnId: null,
        bookingKey: randomUUID(),
        provider: 'steadfast',
        weightGrams: 500,
        consignmentId: 'never-recorded',
        trackingCode: null,
        chargeMinor: null,
        note: 'Integration check only',
        recommendedProvider: null,
        selectionReason: null,
        isMock: false,
      }),
    ).rejects.toMatchObject({ refusal: 'missing_permission' });
  });

  it('reads the operating settings with the service role (no secrets in them)', async () => {
    const runtime = await store.runtime();
    expect(['off', 'mock', 'live']).toContain(runtime.mode);
    expect(runtime.trackingSyncIntervalSeconds).toBeGreaterThanOrEqual(60);
    expect(runtime.providers.map((p) => p.provider).sort()).toEqual(['pathao', 'steadfast']);
    // Credentials come back as a plain map; their values are never printed here.
    const values = await store.credentials('steadfast');
    expect(typeof values).toBe('object');
  });

  it('refuses a stranger every operations change, before anything is written', async () => {
    await expect(
      store.saveOperations(stranger, {
        mode: 'off',
        bookingEnabled: false,
        trackingSyncEnabled: false,
        trackingSyncIntervalSeconds: 300,
        httpTimeoutMs: 15_000,
        confirmation: null,
      }),
    ).rejects.toMatchObject({ refusal: 'missing_permission' });
    await expect(
      store.setCredential(stranger, 'steadfast', 'api_key', 'never-stored'),
    ).rejects.toMatchObject({ refusal: 'missing_permission' });
    await expect(store.saveBaseUrl(stranger, 'steadfast', null)).rejects.toMatchObject({
      refusal: 'missing_permission',
    });
    await expect(store.setLiveVerified(stranger, 'steadfast', false, null)).rejects.toMatchObject({
      refusal: 'missing_permission',
    });
  });

  it('lists orders with the new sort and zone filter (nothing visible to a stranger)', async () => {
    const orders = createPostgresAdminOrderStore(pool);
    for (const sort of ['newest', 'oldest', 'total_high', 'total_low'] as const) {
      await expect(
        orders.listOrders(
          stranger.accessToken,
          stranger.userId,
          {
            sort,
            deliveryZone: 'outside_dhaka',
            orderNumbers: ['NZ999999999'],
            includeArchived: true,
          },
          { limit: 10, offset: 0 },
        ),
      ).resolves.toEqual({ orders: [], total: 0 });
    }
  });

  it('answers no parcels to a caller without shipments.read', async () => {
    const states = await withUser(pool, stranger.userId, async (client) => {
      const result = await client.query<{ states: unknown }>(
        'select public.admin_order_shipment_states($1::text[]) as states',
        [['NZ999999999']],
      );
      return result.rows[0]?.states;
    });
    expect(states).toEqual([]);
  });

  it('answers "not found" for a customer reading an order that is not theirs', async () => {
    await expect(store.myOrderShipments(stranger, 'NZ999999999')).rejects.toMatchObject({
      refusal: 'not_found',
    });
  });

  it('reaches the service-role functions with explicit null arguments', async () => {
    await expect(store.findShipment('steadfast', null, null)).resolves.toBeNull();
    await expect(store.findShipment('pathao', 'no-such-consignment', null)).resolves.toBeNull();
    await expect(store.bookingPayload(randomUUID())).resolves.toBeNull();
  });
});
