import {
  adminAttributesResponseSchema,
  adminProductVariantsResponseSchema,
} from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { adminSetup, errorOf } from './admin-helpers';

/*
 * Attributes and variants through the admin routes: who may change them, editing an
 * attribute or value in place, and the rule that every variant of one product names the
 * same attributes (a sibling with fewer could never be chosen by a shopper). The database
 * rule itself is covered by supabase/tests/variant_attribute_set.test.sql.
 */

async function attributes(setup: ReturnType<typeof adminSetup>) {
  const size = await setup.call('post', '/admin/attributes', 'staff', {
    slug: 'size',
    name: 'Size',
    position: 0,
    isActive: true,
  });
  expect(size.status).toBe(200);
  const sizeId = adminAttributesResponseSchema.parse(size.body).attributes[0]?.id ?? '';
  const colour = await setup.call('post', '/admin/attributes', 'staff', {
    slug: 'colour',
    name: 'Colour',
    position: 1,
    isActive: true,
  });
  const colourId =
    adminAttributesResponseSchema.parse(colour.body).attributes.find((a) => a.slug === 'colour')
      ?.id ?? '';
  const value = async (attributeId: string, slug: string, text: string) => {
    const response = await setup.call('post', '/admin/attributes/values', 'staff', {
      attributeId,
      slug,
      value: text,
      position: 0,
    });
    expect(response.status).toBe(200);
    const saved = adminAttributesResponseSchema
      .parse(response.body)
      .attributes.flatMap((a) => a.values)
      .find((v) => v.slug === slug);
    return saved?.id ?? '';
  };
  return {
    sizeId,
    m: await value(sizeId, 'm', 'M'),
    l: await value(sizeId, 'l', 'L'),
    navy: await value(colourId, 'navy', 'Navy'),
  };
}

describe('admin attributes and variants', () => {
  it('edits an attribute in place, keeping its id', async () => {
    const setup = adminSetup();
    const { sizeId } = await attributes(setup);
    const response = await setup.call('post', '/admin/attributes', 'staff', {
      attributeId: sizeId,
      slug: 'size',
      name: 'Shirt size',
      position: 4,
      isActive: false,
    });
    expect(response.status).toBe(200);
    const edited = adminAttributesResponseSchema
      .parse(response.body)
      .attributes.find((a) => a.id === sizeId);
    expect(edited).toMatchObject({ name: 'Shirt size', position: 4, isActive: false });
  });

  it('refuses attribute changes to accounts without products.update', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/attributes', 'moderator', {
      slug: 'size',
      name: 'Size',
      position: 0,
      isActive: true,
    });
    expect(response.status).toBe(403);
  });

  it('keeps every variant of a product on the same attributes', async () => {
    const setup = adminSetup();
    const { m, l, navy } = await attributes(setup);
    const productId = setup.products.lamp.id;
    const path = `/admin/products/${productId}/variants`;

    const first = await setup.call('post', path, 'staff', {
      sku: 'LAMP-M-NAVY',
      attributeValueIds: [m, navy],
    });
    expect(first.status).toBe(200);

    // Size alone, beside a Size + Colour sibling, could never be chosen in the storefront.
    const fewer = await setup.call('post', path, 'staff', {
      sku: 'LAMP-L',
      attributeValueIds: [l],
    });
    expect(fewer.status).toBe(400);
    expect(errorOf(fewer.body).code).toBe('variant_required');

    const same = await setup.call('post', path, 'staff', {
      sku: 'LAMP-L-NAVY',
      priceMinor: 12_000,
      attributeValueIds: [l, navy],
    });
    expect(same.status).toBe(200);
    const { variants } = adminProductVariantsResponseSchema.parse(same.body);
    expect(variants.map((variant) => variant.sku).sort()).toEqual(['LAMP-L-NAVY', 'LAMP-M-NAVY']);
  });

  it('refuses to delete a variant that has orders, asking for it to be hidden instead', async () => {
    const setup = adminSetup();
    const { m, navy } = await attributes(setup);
    const productId = setup.products.lamp.id;
    const created = await setup.call('post', `/admin/products/${productId}/variants`, 'staff', {
      sku: 'LAMP-M-NAVY',
      attributeValueIds: [m, navy],
    });
    const variantId = adminProductVariantsResponseSchema.parse(created.body).variants[0]?.id ?? '';
    setup.admin.variantHistory.add(variantId);

    const response = await setup.call(
      'delete',
      `/admin/products/${productId}/variants/${variantId}`,
      'owner',
    );

    expect(response.status).toBe(409);
    // Not the category refusal NZ409 used to answer with.
    expect(errorOf(response.body).code).toBe('variant_has_history');
    expect(errorOf(response.body).message).toMatch(/hide it instead/i);
    const after = await setup.call('get', `/admin/products/${productId}/variants`, 'staff');
    expect(adminProductVariantsResponseSchema.parse(after.body).variants).toHaveLength(1);
  });
});
