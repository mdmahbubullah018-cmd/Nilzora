import { describe, expect, it } from 'vitest';
import { productVariantOptionSchema } from './catalog';
import {
  adminSaveAttributeRequestSchema,
  adminSaveAttributeValueRequestSchema,
  adminAttributeSchema,
  adminSetVariantStockRequestSchema,
} from './variants';

describe('attribute kind and swatch', () => {
  it('defaults a new attribute to "other" and accepts colour and size', () => {
    const base = { slug: 'colour', name: 'Colour', position: 0, isActive: true };
    expect(adminSaveAttributeRequestSchema.parse(base).kind).toBe('other');
    expect(adminSaveAttributeRequestSchema.parse({ ...base, kind: 'color' }).kind).toBe('color');
    expect(adminSaveAttributeRequestSchema.parse({ ...base, kind: 'size' }).kind).toBe('size');
    expect(adminSaveAttributeRequestSchema.safeParse({ ...base, kind: 'fabric' }).success).toBe(
      false,
    );
  });

  it('accepts a #RRGGBB swatch and refuses anything else', () => {
    const base = {
      attributeId: '0d000000-0000-4000-8000-000000000001',
      slug: 'black',
      value: 'Black',
    };
    expect(
      adminSaveAttributeValueRequestSchema.parse({ ...base, swatchHex: '#0F172A' }).swatchHex,
    ).toBe('#0F172A');
    expect(
      adminSaveAttributeValueRequestSchema.safeParse({ ...base, swatchHex: 'navy' }).success,
    ).toBe(false);
    expect(
      adminSaveAttributeValueRequestSchema.safeParse({ ...base, swatchHex: '#FFF' }).success,
    ).toBe(false);
  });

  it('keeps kind and swatch optional so an older payload still parses', () => {
    const attribute = adminAttributeSchema.parse({
      id: '0d000000-0000-4000-8000-000000000001',
      slug: 'size',
      name: 'Size',
      position: 0,
      isActive: true,
      values: [{ id: '0d000000-0000-4000-8000-000000000002', slug: 'm', value: 'M', position: 0 }],
    });
    expect(attribute.kind).toBeUndefined();
    expect(attribute.values[0]?.swatchHex).toBeUndefined();
  });

  it('carries the kind and swatch on a product variant option', () => {
    const option = productVariantOptionSchema.parse({
      attribute: 'Colour',
      attributeSlug: 'colour',
      kind: 'color',
      value: 'Black',
      valueSlug: 'black',
      swatchHex: '#0F172A',
    });
    expect(option.kind).toBe('color');
    expect(option.swatchHex).toBe('#0F172A');
  });
});

describe('set variant stock', () => {
  it('needs a whole count of zero or more and a reason', () => {
    expect(adminSetVariantStockRequestSchema.parse({ stock: 0, note: 'Stocktake' })).toEqual({
      stock: 0,
      note: 'Stocktake',
    });
    expect(
      adminSetVariantStockRequestSchema.safeParse({ stock: -1, note: 'Stocktake' }).success,
    ).toBe(false);
    expect(
      adminSetVariantStockRequestSchema.safeParse({ stock: 4.5, note: 'Stocktake' }).success,
    ).toBe(false);
    expect(adminSetVariantStockRequestSchema.safeParse({ stock: 4, note: 'no' }).success).toBe(
      false,
    );
  });
});
