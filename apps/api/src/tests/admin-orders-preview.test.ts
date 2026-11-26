import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresAdminOrderStore } from '../modules/admin/orders-store';

/*
 * The admin order list shows what each order holds: the first lines with the picture the
 * customer saw (resolved from the stored key, never trusted from a client), their options
 * and quantity, plus the coupon that priced a discounted order. One query fetches the lines
 * of the whole page and one the coupons: never one per order.
 */

const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e3333';
const COUPON = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e4444';
const MEDIA = 'https://media.example.test';

function order(number: string, id: string, discountMinor: number) {
  return {
    id,
    order_number: number,
    user_id: USER,
    status: 'pending',
    payment_method: 'cod',
    payment_status: 'pending',
    item_count: 3,
    total_minor: 250_000,
    discount_minor: discountMinor,
    placed_at: new Date('2026-11-09T08:00:00.000Z'),
    ship_recipient_name: 'Rahima Khatun',
    ship_phone: '+8801712345678',
    delivery_zone: 'inside_dhaka',
    total: '2',
  };
}

function poolAnswering() {
  const statements: string[] = [];
  const client = {
    query: (sql: string) => {
      statements.push(sql);
      if (sql.includes('count(*) over ()')) {
        return Promise.resolve({
          rows: [order('NZ100001', 'o1', 5000), order('NZ100002', 'o2', 0)],
        });
      }
      if (sql.includes('from public.order_items')) {
        return Promise.resolve({
          rows: [
            {
              order_id: 'o1',
              product_name: 'Cotton Panjabi',
              variant_label: 'Size: M / Colour: Navy',
              quantity: 2,
              image_key: 'products/a/b',
              image_alt: 'A navy panjabi',
            },
            {
              order_id: 'o1',
              product_name: 'Prayer cap',
              variant_label: null,
              quantity: 1,
              image_key: null,
              image_alt: null,
            },
            {
              order_id: 'o2',
              product_name: 'Kettle',
              variant_label: null,
              quantity: 3,
              image_key: null,
              image_alt: null,
            },
          ],
        });
      }
      if (sql.includes('admin_order_coupons')) {
        return Promise.resolve({
          rows: [
            {
              coupons: [
                {
                  orderNumber: 'NZ100001',
                  couponId: COUPON,
                  code: 'EID50',
                  title: null,
                  isVoucher: false,
                  discountMinor: 5000,
                },
              ],
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  return { pool: { connect: () => Promise.resolve(client) } as unknown as Pool, statements };
}

describe('the admin order list', () => {
  it('previews each order with variant, quantity, picture and the coupon behind its discount', async () => {
    const { pool, statements } = poolAnswering();
    const { orders, total } = await createPostgresAdminOrderStore(pool, {
      mediaBaseUrl: MEDIA,
    }).listOrders('token', USER, {}, { limit: 25, offset: 0 });

    expect(total).toBe(2);
    const [first, second] = orders;
    expect(first?.preview).toHaveLength(2);
    expect(first?.preview[0]).toMatchObject({
      productName: 'Cotton Panjabi',
      variantLabel: 'Size: M / Colour: Navy',
      quantity: 2,
      image: { alt: 'A navy panjabi' },
    });
    expect(first?.preview[0]?.image?.thumbUrl.startsWith(MEDIA)).toBe(true);
    expect(first?.preview[1]?.image).toBeNull();
    expect(first?.discountMinor).toBe(5000);
    expect(first?.coupon).toMatchObject({ code: 'EID50', discountMinor: 5000, isVoucher: false });
    expect(second?.discountMinor).toBe(0);
    expect(second?.coupon).toBeNull();
    // One query for the page's lines and one for its coupons, whatever the page size.
    expect(statements.filter((sql) => sql.includes('from public.order_items'))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('admin_order_coupons'))).toHaveLength(1);
  });

  it('leaves out pictures when media storage is not configured', async () => {
    const { pool } = poolAnswering();
    const { orders } = await createPostgresAdminOrderStore(pool).listOrders(
      'token',
      USER,
      {},
      { limit: 25, offset: 0 },
    );
    expect(orders[0]?.preview[0]?.image).toBeNull();
    expect(orders[0]?.preview[0]?.productName).toBe('Cotton Panjabi');
  });
});
