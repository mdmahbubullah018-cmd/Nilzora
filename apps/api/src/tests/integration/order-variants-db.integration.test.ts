import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';

/*
 * What an order records about the variant the customer chose (migration 20261231098000): the exact
 * colour and size as a snapshot inside the order, the right variant's stock moving and no other's,
 * clothing letters, numeric waist sizes and shoe sizes alike, and a snapshot that does not change
 * when the product is edited afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const run = randomUUID().slice(0, 8);
const tag = `nzvr${run}`;
const SKU = run.toUpperCase();

const created = {
  users: [] as string[],
  products: [] as string[],
  attributes: [] as string[],
  categories: [] as string[],
  zones: [] as string[],
};
let category: string;
let customer: string;
let address: string;
let colour: string;
let size: string;
const values = new Map<string, string>();

async function value(attribute: string, text: string, position: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.product_attribute_values (attribute_id, slug, value, position)
     values ($1, $2, $3, $4) returning id`,
    [attribute, `${tag}-${text.toLowerCase().replace(/\s+/g, '-')}`, text, position],
  );
  const id = (result.rows[0] as { id: string }).id;
  values.set(text, id);
  return id;
}

async function attribute(name: string, position: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'insert into public.product_attributes (slug, name, position) values ($1, $2, $3) returning id',
    [`${tag}-${name.toLowerCase()}`, name, position],
  );
  const id = (result.rows[0] as { id: string }).id;
  created.attributes.push(id);
  return id;
}

interface VariantSpec {
  sku: string;
  stock: number;
  options: [string, string][];
}

async function product(
  slug: string,
  variants: VariantSpec[],
): Promise<{ id: string; variants: Record<string, string> }> {
  const made = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status, published_at)
     values ($1, $2, $3, $4, 'fixture', 10000, 0, 10, 'active', now()) returning id`,
    [
      category,
      `${tag}-${slug}`,
      `VR-${SKU}-${slug.toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
      `${tag} ${slug}`,
    ],
  );
  const id = (made.rows[0] as { id: string }).id;
  created.products.push(id);
  const ids: Record<string, string> = {};
  let position = 0;
  for (const spec of variants) {
    const row = await pool.query<{ id: string }>(
      `insert into public.product_variants (product_id, sku, price_minor, stock_quantity, position)
       values ($1, $2, 10000, $3, $4) returning id`,
      [id, `${spec.sku}-${SKU}`, spec.stock, position++],
    );
    const variantId = (row.rows[0] as { id: string }).id;
    ids[spec.sku] = variantId;
    for (const [attr, text] of spec.options) {
      const attributeId = attr === 'Colour' ? colour : size;
      await pool.query(
        'insert into public.product_variant_values (variant_id, attribute_id, attribute_value_id) values ($1, $2, $3)',
        [variantId, attributeId, values.get(text)],
      );
    }
  }
  return { id, variants: ids };
}

async function place(
  items: { productId: string; variantId?: string; quantity: number }[],
  expected: number,
) {
  return withUser(pool, customer, async (client) => {
    const result = await client.query<{ value: { orderId: string } }>(
      'select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, null, $4::bigint, null) as value',
      [randomUUID(), address, JSON.stringify(items), expected],
    );
    return (result.rows[0] as { value: { orderId: string } }).value.orderId;
  });
}

const lines = async (orderId: string) =>
  (
    await pool.query<{
      variant_id: string | null;
      variant_label: string | null;
      variant_options: { name: string; value: string }[] | null;
      sku: string;
      quantity: number;
    }>(
      'select variant_id, variant_label, variant_options, sku, quantity from public.order_items where order_id = $1 order by id',
      [orderId],
    )
  ).rows;

const stockOf = async (variantId: string) =>
  Number(
    (
      await pool.query<{ s: number }>(
        'select stock_quantity as s from public.product_variants where id = $1',
        [variantId],
      )
    ).rows[0]?.s,
  );

beforeAll(async () => {
  category = (
    await pool.query<{ id: string }>(
      `insert into public.categories (slug, name, sort_order, is_active) values ($1, $2, 990, true) returning id`,
      [`${tag}-cat`, `Cat ${run}`],
    )
  ).rows[0]?.id as string;
  created.categories.push(category);
  colour = await attribute('Colour', 990);
  size = await attribute('Size', 991);
  for (const [index, text] of ['Black', 'White', 'Blue'].entries())
    await value(colour, text, index);
  for (const [index, text] of ['S', 'M', 'L', '32', '34', '42', '43', 'One Size'].entries())
    await value(size, text, index);
  created.zones = (
    await pool.query<{ zone: string }>(
      `insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 7000), ('outside_dhaka', 13000)
       on conflict (zone) do nothing returning zone`,
    )
  ).rows.map((row) => row.zone);
  customer = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    customer,
    `it-variant-${run}@example.com`,
    'Variant buyer',
  ]);
  created.users.push(customer);
  address = (
    await pool.query<{ id: string }>(
      `insert into public.addresses (user_id, label, recipient_name, phone, division, district, area, address_line, postal_code)
       values ($1, 'Home', 'Rahima Khatun', '+8801712345678', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 12, Road 5', '1212') returning id`,
      [customer],
    )
  ).rows[0]?.id as string;
});

afterAll(async () => {
  await pool.query('delete from public.orders where user_id = any($1::uuid[])', [created.users]);
  await pool.query('delete from public.inventory_movements where product_id = any($1::uuid[])', [
    created.products,
  ]);
  await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  await pool.query('delete from public.product_attributes where id = any($1::uuid[])', [
    created.attributes,
  ]);
  await pool.query('delete from public.categories where id = any($1::uuid[])', [
    created.categories,
  ]);
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  if (created.zones.length > 0)
    await pool.query('delete from public.delivery_charges where zone::text = any($1::text[])', [
      created.zones,
    ]);
  await pool.end();
});

describe('the options an order keeps', () => {
  it('snapshots colour and size together, takes stock from that variant only, and keeps the SKU', async () => {
    const shirt = await product('shirt', [
      {
        sku: 'SH-BLK-M',
        stock: 5,
        options: [
          ['Colour', 'Black'],
          ['Size', 'M'],
        ],
      },
      {
        sku: 'SH-WHT-L',
        stock: 5,
        options: [
          ['Colour', 'White'],
          ['Size', 'L'],
        ],
      },
    ]);
    const orderId = await place(
      [{ productId: shirt.id, variantId: shirt.variants['SH-WHT-L'], quantity: 2 }],
      2 * 10_000 + 7_000,
    );

    const [line] = await lines(orderId);
    expect(line).toMatchObject({
      variant_id: shirt.variants['SH-WHT-L'],
      variant_label: 'Colour: White / Size: L',
      sku: `SH-WHT-L-${SKU}`,
      quantity: 2,
    });
    expect(line?.variant_options).toEqual([
      { name: 'Colour', value: 'White' },
      { name: 'Size', value: 'L' },
    ]);
    expect(await stockOf(shirt.variants['SH-WHT-L'] as string)).toBe(3);
    expect(await stockOf(shirt.variants['SH-BLK-M'] as string)).toBe(5);
  });

  it('handles numeric clothing sizes, shoe sizes, size-only and colour-only products', async () => {
    const jeans = await product('jeans', [
      { sku: 'JN-32', stock: 4, options: [['Size', '32']] },
      { sku: 'JN-34', stock: 4, options: [['Size', '34']] },
    ]);
    const shoe = await product('shoe', [
      {
        sku: 'SHO-BLU-42',
        stock: 3,
        options: [
          ['Colour', 'Blue'],
          ['Size', '42'],
        ],
      },
      {
        sku: 'SHO-BLU-43',
        stock: 3,
        options: [
          ['Colour', 'Blue'],
          ['Size', '43'],
        ],
      },
    ]);
    const cap = await product('cap', [
      { sku: 'CAP-BLK', stock: 9, options: [['Colour', 'Black']] },
    ]);
    const custom = await product('mug', [
      { sku: 'MUG-ONE', stock: 9, options: [['Size', 'One Size']] },
    ]);

    const orderId = await place(
      [
        { productId: jeans.id, variantId: jeans.variants['JN-34'], quantity: 1 },
        { productId: shoe.id, variantId: shoe.variants['SHO-BLU-43'], quantity: 1 },
        { productId: cap.id, variantId: cap.variants['CAP-BLK'], quantity: 1 },
        { productId: custom.id, variantId: custom.variants['MUG-ONE'], quantity: 1 },
      ],
      4 * 10_000 + 7_000,
    );

    const found = await lines(orderId);
    expect(found.map((line) => line.variant_options)).toEqual([
      [{ name: 'Size', value: '34' }],
      [
        { name: 'Colour', value: 'Blue' },
        { name: 'Size', value: '43' },
      ],
      [{ name: 'Colour', value: 'Black' }],
      [{ name: 'Size', value: 'One Size' }],
    ]);
    expect(await stockOf(jeans.variants['JN-32'] as string)).toBe(4);
    expect(await stockOf(jeans.variants['JN-34'] as string)).toBe(3);
    expect(await stockOf(shoe.variants['SHO-BLU-42'] as string)).toBe(3);
    expect(await stockOf(shoe.variants['SHO-BLU-43'] as string)).toBe(2);
  });

  it('keeps the snapshot when the product is edited or the variant is renamed afterwards', async () => {
    const tee = await product('tee', [
      {
        sku: 'TEE-BLK-S',
        stock: 5,
        options: [
          ['Colour', 'Black'],
          ['Size', 'S'],
        ],
      },
    ]);
    const orderId = await place(
      [{ productId: tee.id, variantId: tee.variants['TEE-BLK-S'], quantity: 1 }],
      10_000 + 7_000,
    );

    // The store later renames the value and changes the variant's own SKU.
    await pool.query(
      "update public.product_attribute_values set value = 'Jet Black' where id = $1",
      [values.get('Black')],
    );
    await pool.query("update public.product_variants set sku = 'RENAMED-' || sku where id = $1", [
      tee.variants['TEE-BLK-S'],
    ]);

    const [line] = await lines(orderId);
    expect(line?.variant_options).toEqual([
      { name: 'Colour', value: 'Black' },
      { name: 'Size', value: 'S' },
    ]);
    expect(line?.sku).toBe(`TEE-BLK-S-${SKU}`);
    await pool.query("update public.product_attribute_values set value = 'Black' where id = $1", [
      values.get('Black'),
    ]);
  });

  it('refuses a variant that is out of stock, and one that belongs to another product', async () => {
    const hat = await product('hat', [{ sku: 'HAT-L', stock: 1, options: [['Size', 'L']] }]);
    const scarf = await product('scarf', [{ sku: 'SCF-L', stock: 5, options: [['Size', 'L']] }]);

    await expect(
      place(
        [{ productId: hat.id, variantId: hat.variants['HAT-L'], quantity: 2 }],
        2 * 10_000 + 7_000,
      ),
    ).rejects.toBeTruthy();
    expect(await stockOf(hat.variants['HAT-L'] as string)).toBe(1);

    await expect(
      place(
        [{ productId: hat.id, variantId: scarf.variants['SCF-L'], quantity: 1 }],
        10_000 + 7_000,
      ),
    ).rejects.toBeTruthy();
    expect(await stockOf(scarf.variants['SCF-L'] as string)).toBe(5);
  });

  it('keeps a simple product line free of options', async () => {
    const plain = await pool.query<{ id: string }>(
      `insert into public.products (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status, published_at)
       values ($1, $2, $3, 'plain', 'fixture', 10000, 5, 10, 'active', now()) returning id`,
      [category, `${tag}-plain`, `VR-${SKU}-PLAIN`],
    );
    const id = (plain.rows[0] as { id: string }).id;
    created.products.push(id);
    const orderId = await place([{ productId: id, quantity: 1 }], 10_000 + 7_000);
    const [line] = await lines(orderId);
    expect(line).toMatchObject({ variant_id: null, variant_label: null, variant_options: null });
  });
});
