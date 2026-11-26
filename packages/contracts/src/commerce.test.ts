import { describe, expect, it } from 'vitest';
import { addressInputSchema } from './addresses';
import { cartItemsSchema, cartQuoteRequestSchema } from './cart';
import { moneyMinorSchema, productListQuerySchema, slugSchema } from './catalog';
import { BD_DISTRICTS, BD_DIVISIONS, isDistrictOf } from './locations';
import { cancelOrderRequestSchema, orderNumberSchema, placeOrderRequestSchema } from './orders';

const LAMP = '0d000000-0000-4000-8000-000000000001';
const MUG = '0d000000-0000-4000-8000-000000000002';

describe('money and slugs', () => {
  it.each([0, 1, 125_000])('accepts %d poisha', (value) => {
    expect(moneyMinorSchema.parse(value)).toBe(value);
  });

  it.each([-1, 12.5, Number.NaN, '100'])('rejects %j as an amount', (value) => {
    expect(moneyMinorSchema.safeParse(value).success).toBe(false);
  });

  it.each(['rice', 'cotton-bedsheet-set-double', 'usb-c-25w'])('accepts the slug %j', (value) => {
    expect(slugSchema.parse(value)).toBe(value);
  });

  it.each(['', 'Rice', 'rice--1', '-rice', 'rice/1', '../etc', 'a'.repeat(121)])(
    'rejects the slug %j',
    (value) => {
      expect(slugSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('productListQuerySchema', () => {
  it('coerces query strings and applies defaults', () => {
    expect(productListQuerySchema.parse({ page: '2', q: '  rice ' })).toStrictEqual({
      page: 2,
      pageSize: 24,
      q: 'rice',
    });
  });

  it('ignores unknown tracking parameters', () => {
    expect(productListQuerySchema.parse({ utm_source: 'ad' })).toStrictEqual({
      page: 1,
      pageSize: 24,
    });
  });

  it.each([
    { page: '0' },
    { pageSize: '61' },
    { sort: 'random()' },
    { category: 'Not A Slug' },
    { q: '   ' },
    { page: '168', pageSize: '60' },
    { page: '418', pageSize: '24' },
  ])('rejects %j', (query) => {
    expect(productListQuerySchema.safeParse(query).success).toBe(false);
  });

  it('pages exactly as deep as the database allows', () => {
    // (167 - 1) * 60 = 9960 and (417 - 1) * 24 = 9984 are within MAX_CATALOG_OFFSET.
    expect(productListQuerySchema.safeParse({ page: '167', pageSize: '60' }).success).toBe(true);
    expect(productListQuerySchema.safeParse({ page: '417', pageSize: '24' }).success).toBe(true);
  });
});

describe('cart items', () => {
  it('accepts distinct products with whole quantities', () => {
    const items = [
      { productId: LAMP, quantity: 2 },
      { productId: MUG, quantity: 1 },
    ];
    expect(cartItemsSchema.parse(items)).toStrictEqual(items);
  });

  it.each([
    ['an empty cart', []],
    [
      'a repeated product',
      [
        { productId: LAMP, quantity: 1 },
        { productId: LAMP.toUpperCase(), quantity: 1 },
      ],
    ],
    ['a zero quantity', [{ productId: LAMP, quantity: 0 }]],
    ['a fractional quantity', [{ productId: LAMP, quantity: 1.5 }]],
    ['a quantity above the limit', [{ productId: LAMP, quantity: 101 }]],
    ['a client-supplied price', [{ productId: LAMP, quantity: 1, priceMinor: 1 }]],
    ['a product that is not a uuid', [{ productId: 'lamp', quantity: 1 }]],
    [
      'too many lines',
      Array.from({ length: 31 }, (_, index) => ({
        productId: `0d000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        quantity: 1,
      })),
    ],
  ])('rejects %s', (_label, items) => {
    expect(cartItemsSchema.safeParse(items).success).toBe(false);
  });

  it('rejects quote requests that carry anything besides items', () => {
    expect(
      cartQuoteRequestSchema.safeParse({ items: [{ productId: LAMP, quantity: 1 }], totalMinor: 1 })
        .success,
    ).toBe(false);
  });
});

describe('placeOrderRequestSchema', () => {
  const valid = {
    idempotencyKey: 'e1000000-0000-4000-8000-000000000001',
    addressId: 'ad000000-0000-4000-8000-0000000000a1',
    items: [{ productId: LAMP, quantity: 1 }],
    expectedTotalMinor: 16_000,
  };

  it('accepts what to buy, where to deliver and the reviewed total', () => {
    expect(placeOrderRequestSchema.parse({ ...valid, note: '  Call first  ' })).toStrictEqual({
      ...valid,
      note: 'Call first',
    });
  });

  it('treats an empty note as no note', () => {
    expect(placeOrderRequestSchema.parse({ ...valid, note: '   ' }).note).toBeUndefined();
  });

  it.each([
    ['a total', { totalMinor: 1 }],
    ['a delivery charge', { shippingFeeMinor: 0 }],
    ['a discount', { discountMinor: 100_000 }],
    ['a user id', { userId: 'a1a1a1a1-0000-4000-8000-000000000001' }],
    ['a status', { status: 'delivered' }],
  ])('rejects a request that sets %s', (_label, extra) => {
    expect(placeOrderRequestSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });

  it.each(['idempotencyKey', 'addressId', 'items', 'expectedTotalMinor'] as const)(
    'requires %s',
    (field) => {
      const { [field]: _omitted, ...rest } = valid;
      expect(placeOrderRequestSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('limits the note length', () => {
    expect(placeOrderRequestSchema.safeParse({ ...valid, note: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('accepts an optional cancellation reason', () => {
    expect(cancelOrderRequestSchema.parse({})).toStrictEqual({});
    expect(cancelOrderRequestSchema.parse({ reason: ' Wrong size ' })).toStrictEqual({
      reason: 'Wrong size',
    });
    expect(cancelOrderRequestSchema.safeParse({ reason: 'x'.repeat(301) }).success).toBe(false);
  });

  it.each(['NZ100001', 'NZ123456789012'])('accepts the order number %s', (value) => {
    expect(orderNumberSchema.parse(value)).toBe(value);
  });

  it.each(['100001', 'nz100001', 'NZ1', 'NZ100001;drop', "NZ1' or '1'='1"])(
    'rejects the order number %j',
    (value) => {
      expect(orderNumberSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('locations', () => {
  it('lists the 8 divisions and 64 districts, each district once', () => {
    const districts = BD_DIVISIONS.flatMap((division) => BD_DISTRICTS[division]);
    expect(BD_DIVISIONS).toHaveLength(8);
    expect(districts).toHaveLength(64);
    expect(new Set(districts).size).toBe(64);
  });

  it('knows which division a district belongs to', () => {
    expect(isDistrictOf('Dhaka', 'Gazipur')).toBe(true);
    expect(isDistrictOf('Chattogram', "Cox's Bazar")).toBe(true);
    expect(isDistrictOf('Sylhet', 'Dhaka')).toBe(false);
    expect(isDistrictOf('Atlantis', 'Dhaka')).toBe(false);
    expect(isDistrictOf('constructor', 'name')).toBe(false);
  });
});

describe('addressInputSchema', () => {
  const valid = {
    recipientName: ' Rahima Khatun ',
    phone: '01712-345678',
    division: 'Dhaka',
    district: 'Dhaka',
    area: 'Dhanmondi',
    addressLine: 'House 12, Road 5',
  };

  it('normalises an address', () => {
    expect(
      addressInputSchema.parse({ ...valid, postalCode: '1209', label: ' Home ' }),
    ).toStrictEqual({
      ...valid,
      recipientName: 'Rahima Khatun',
      phone: '+8801712345678',
      postalCode: '1209',
      label: 'Home',
    });
  });

  it('turns blank optional fields into null', () => {
    const parsed = addressInputSchema.parse({ ...valid, label: '', postalCode: '', landmark: ' ' });
    expect(parsed).toMatchObject({ label: null, postalCode: null, landmark: null });
  });

  it.each([
    ['a district outside the division', { division: 'Sylhet' }, 'district'],
    ['an unknown division', { division: 'Atlantis' }, 'division'],
    ['a landline phone', { phone: '029661234' }, 'phone'],
    ['a short address line', { addressLine: 'H1' }, 'addressLine'],
    ['a malformed postal code', { postalCode: '12a4' }, 'postalCode'],
  ])('rejects %s', (_label, change, field) => {
    const result = addressInputSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it('rejects an owner or zone set by the client', () => {
    expect(addressInputSchema.safeParse({ ...valid, userId: LAMP }).success).toBe(false);
    expect(addressInputSchema.safeParse({ ...valid, deliveryZone: 'inside_dhaka' }).success).toBe(
      false,
    );
  });
});
