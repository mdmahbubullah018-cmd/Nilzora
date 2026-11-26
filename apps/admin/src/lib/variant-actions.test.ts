import type { ApiClient } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateVariantsAction,
  saveAttributeAction,
  saveAttributeValueAction,
  saveVariantAction,
  setValuePictureAction,
} from './variant-actions';

/*
 * Attribute and variant Server Actions: the form text becomes the request the API checks
 * again, blank addresses are made from the name, positions are validated, and generation
 * keeps to the attributes a product's variants already use.
 */

const api = vi.hoisted(() => ({
  adminSaveAttribute: vi.fn(),
  adminSaveAttributeValue: vi.fn(),
  adminSaveVariant:
    vi.fn<(token: string, productId: string, input: SavedVariant) => Promise<unknown>>(),
  adminListAttributes: vi.fn(),
  adminProductVariants: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_form: FormData, call: (client: ApiClient, token: string) => unknown) => ({
      kind: 'ok',
      value: await call(api as unknown as ApiClient, 'access-token'),
    }),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('server-only', () => ({}));

interface SavedVariant {
  sku: string;
  attributeValueIds: string[];
  imageUrl?: string | null;
  priceMinor?: number | null;
  compareAtPriceMinor?: number | null;
  position?: number;
  isActive?: boolean;
}

const IDLE = { status: 'idle' } as const;
const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const SIZE = 'a1000000-0000-4000-8000-000000000001';
const COLOUR = 'a1000000-0000-4000-8000-000000000002';
const M = 'a2000000-0000-4000-8000-000000000001';
const L = 'a2000000-0000-4000-8000-000000000002';
const NAVY = 'a2000000-0000-4000-8000-000000000003';

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  data.set('csrf_token', 'signed');
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(name, entry);
  }
  return data;
}

const attributes = [
  {
    id: SIZE,
    slug: 'size',
    name: 'Size',
    position: 0,
    isActive: true,
    values: [
      { id: M, slug: 'm', value: 'M', position: 0 },
      { id: L, slug: 'l', value: 'L', position: 1 },
    ],
  },
  {
    id: COLOUR,
    slug: 'colour',
    name: 'Colour',
    position: 1,
    isActive: true,
    values: [{ id: NAVY, slug: 'navy', value: 'Navy', position: 0 }],
  },
];

function variant(id: string, valueIds: string[], position = 0) {
  return {
    id,
    sku: `SKU-${id.slice(-2)}`,
    priceMinor: null,
    compareAtPriceMinor: null,
    stockQuantity: 0,
    imageUrl: null,
    position,
    isActive: true,
    label: null,
    attributeValueIds: valueIds,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  revalidatePath.mockReset();
  api.adminSaveAttribute.mockResolvedValue({ attributes });
  api.adminSaveAttributeValue.mockResolvedValue({ attributes });
  api.adminSaveVariant.mockResolvedValue({ variants: [] });
  api.adminListAttributes.mockResolvedValue({ attributes });
});

describe('saveAttributeAction', () => {
  it('makes a blank address from the name and sends the chosen order', async () => {
    const state = await saveAttributeAction(
      IDLE,
      form({ name: 'Fabric weight', slug: '', position: '3', isActive: 'on' }),
    );
    expect(state.status).toBe('success');
    expect(api.adminSaveAttribute).toHaveBeenCalledWith('access-token', {
      attributeId: null,
      slug: 'fabric-weight',
      name: 'Fabric weight',
      position: 3,
      isActive: true,
      kind: 'other',
    });
  });

  it('sends the kind when one is chosen, and falls back to other for anything else', async () => {
    await saveAttributeAction(
      IDLE,
      form({ name: 'Colour', slug: 'colour', position: '', kind: 'color' }),
    );
    expect(api.adminSaveAttribute).toHaveBeenLastCalledWith(
      'access-token',
      expect.objectContaining({ kind: 'color' }),
    );

    await saveAttributeAction(
      IDLE,
      form({ name: 'Material', slug: 'material', position: '', kind: 'nonsense' }),
    );
    expect(api.adminSaveAttribute).toHaveBeenLastCalledWith(
      'access-token',
      expect.objectContaining({ kind: 'other' }),
    );
  });

  it('sends a colour swatch with a value and leaves it out when blank', async () => {
    await saveAttributeValueAction(
      IDLE,
      form({
        attributeId: SIZE,
        valueId: SIZE,
        value: 'Navy',
        valueSlug: 'navy',
        swatchHex: '#0F172A',
      }),
    );
    expect(api.adminSaveAttributeValue).toHaveBeenLastCalledWith(
      'access-token',
      expect.objectContaining({ swatchHex: '#0F172A' }),
    );

    await saveAttributeValueAction(
      IDLE,
      form({ attributeId: SIZE, valueId: SIZE, value: 'Navy', valueSlug: 'navy', swatchHex: '' }),
    );
    const lastCall = api.adminSaveAttributeValue.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(lastCall).not.toHaveProperty('swatchHex');
  });

  it('edits in place by id, and records an attribute switched off', async () => {
    await saveAttributeAction(
      IDLE,
      form({ attributeId: SIZE, name: 'Size', slug: 'size', position: '' }),
    );
    expect(api.adminSaveAttribute).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ attributeId: SIZE, position: 0, isActive: false }),
    );
  });

  it.each(['abc', '-1', '1000', '2.5'])(
    'refuses the order %s without calling the API',
    async (position) => {
      const state = await saveAttributeAction(IDLE, form({ name: 'Size', position }));
      expect(state.status).toBe('error');
      expect(state.status === 'error' && state.fieldErrors?.position).toBeTruthy();
      expect(api.adminSaveAttribute).not.toHaveBeenCalled();
    },
  );

  it('asks for a name', async () => {
    const state = await saveAttributeAction(IDLE, form({ name: '  ' }));
    expect(state.status === 'error' && state.fieldErrors?.name).toBeTruthy();
    expect(api.adminSaveAttribute).not.toHaveBeenCalled();
  });
});

describe('saveAttributeValueAction', () => {
  it('renames a value by id, keeping its attribute', async () => {
    await saveAttributeValueAction(
      IDLE,
      form({ attributeId: SIZE, valueId: M, value: 'Medium', valueSlug: 'm', position: '2' }),
    );
    expect(api.adminSaveAttributeValue).toHaveBeenCalledWith('access-token', {
      valueId: M,
      attributeId: SIZE,
      slug: 'm',
      value: 'Medium',
      position: 2,
    });
  });

  it('makes a blank address from the value', async () => {
    await saveAttributeValueAction(IDLE, form({ attributeId: SIZE, value: 'Extra Large' }));
    expect(api.adminSaveAttributeValue).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ valueId: null, slug: 'extra-large', value: 'Extra Large' }),
    );
  });
});

describe('saveVariantAction', () => {
  it('upper-cases the SKU, converts taka to poisha and sends the picture the form chose', async () => {
    const state = await saveVariantAction(
      IDLE,
      form({
        productId: PRODUCT,
        sku: 'tee-m',
        price: '1200',
        attributeValueIds: [M, NAVY],
        imageUrl: 'https://media.example.com/products/p/1/full.webp',
        isActive: 'on',
      }),
    );
    expect(state.status).toBe('success');
    expect(api.adminSaveVariant).toHaveBeenCalledWith('access-token', PRODUCT, {
      variantId: null,
      sku: 'TEE-M',
      priceMinor: 120_000,
      compareAtPriceMinor: null,
      imageUrl: 'https://media.example.com/products/p/1/full.webp',
      position: 0,
      isActive: true,
      attributeValueIds: [M, NAVY],
    });
  });

  it('refuses a former price without the variant’s own price', async () => {
    const state = await saveVariantAction(
      IDLE,
      form({ productId: PRODUCT, sku: 'TEE-M', compareAtPrice: '1500', attributeValueIds: [M] }),
    );
    expect(state.status === 'error' && state.fieldErrors?.compareAtPrice).toBeTruthy();
    expect(api.adminSaveVariant).not.toHaveBeenCalled();
  });
});

describe('generateVariantsAction', () => {
  it('creates every combination for a product without variants', async () => {
    api.adminProductVariants.mockResolvedValue({ variants: [] });
    const state = await generateVariantsAction(
      IDLE,
      form({ productId: PRODUCT, skuPrefix: 'tee', generateValueIds: [M, L, NAVY] }),
    );
    expect(state.status).toBe('success');
    expect(api.adminSaveVariant).toHaveBeenCalledTimes(2);
    expect(api.adminSaveVariant.mock.calls.map((call) => call[2].sku)).toEqual([
      'TEE-M-NAVY',
      'TEE-L-NAVY',
    ]);
  });

  it('keeps to the attributes the product already uses, and says what is missing', async () => {
    // The product is sold by Size and Colour already.
    api.adminProductVariants.mockResolvedValue({
      variants: [variant('77777777-7777-4777-8777-777777777701', [M, NAVY])],
    });
    const state = await generateVariantsAction(
      IDLE,
      form({ productId: PRODUCT, skuPrefix: 'tee', generateValueIds: [L] }),
    );
    expect(state.status).toBe('error');
    expect(state.status === 'error' && state.message).toContain('Colour');
    expect(api.adminSaveVariant).not.toHaveBeenCalled();
  });

  it('skips combinations the product already sells', async () => {
    api.adminProductVariants.mockResolvedValue({
      variants: [variant('77777777-7777-4777-8777-777777777701', [M, NAVY])],
    });
    const state = await generateVariantsAction(
      IDLE,
      form({ productId: PRODUCT, skuPrefix: 'tee', generateValueIds: [M, L, NAVY] }),
    );
    expect(state.status).toBe('success');
    expect(api.adminSaveVariant).toHaveBeenCalledTimes(1);
    expect(api.adminSaveVariant.mock.calls[0]?.[2].attributeValueIds).toEqual([L, NAVY]);
    // The product page summarises variants too, so it is refreshed along with the variants page.
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/products/${PRODUCT}`);
  });
});

describe('setValuePictureAction', () => {
  const NAVY_M = '77777777-7777-4777-8777-777777777711';
  const NAVY_L = '77777777-7777-4777-8777-777777777712';

  it('puts one picture on every size of the colour and changes nothing else', async () => {
    api.adminProductVariants.mockResolvedValue({
      variants: [
        { ...variant(NAVY_M, [M, NAVY], 3), stockQuantity: 4, isActive: false },
        variant(NAVY_L, [L, NAVY], 4),
      ],
    });

    const state = await setValuePictureAction(
      IDLE,
      form({
        productId: PRODUCT,
        attributeValueId: NAVY,
        imageUrl: 'https://media.example.com/products/p/navy/full.webp',
      }),
    );

    expect(state.status).toBe('success');
    expect(state.status === 'success' && state.message).toContain('2 variants');
    expect(api.adminSaveVariant).toHaveBeenCalledTimes(2);
    // Each save carries the variant's own figures back untouched, only the picture changes.
    expect(api.adminSaveVariant).toHaveBeenNthCalledWith(1, 'access-token', PRODUCT, {
      variantId: NAVY_M,
      sku: 'SKU-11',
      priceMinor: null,
      compareAtPriceMinor: null,
      imageUrl: 'https://media.example.com/products/p/navy/full.webp',
      position: 3,
      isActive: false,
      attributeValueIds: [M, NAVY],
    });
    expect(api.adminSaveVariant.mock.calls[1]?.[2].attributeValueIds).toEqual([L, NAVY]);
  });

  it('clears the picture when the field is emptied', async () => {
    api.adminProductVariants.mockResolvedValue({ variants: [variant(NAVY_M, [M, NAVY])] });

    const state = await setValuePictureAction(
      IDLE,
      form({ productId: PRODUCT, attributeValueId: NAVY, imageUrl: '' }),
    );

    expect(state.status).toBe('success');
    expect(api.adminSaveVariant.mock.calls[0]?.[2].imageUrl).toBeNull();
  });

  it('says so when no variant uses the colour yet', async () => {
    api.adminProductVariants.mockResolvedValue({ variants: [variant(NAVY_M, [M])] });

    const state = await setValuePictureAction(
      IDLE,
      form({ productId: PRODUCT, attributeValueId: NAVY, imageUrl: '' }),
    );

    expect(state.status).toBe('error');
    expect(api.adminSaveVariant).not.toHaveBeenCalled();
  });

  it('refuses an address that is not a link to a picture', async () => {
    const state = await setValuePictureAction(
      IDLE,
      form({ productId: PRODUCT, attributeValueId: NAVY, imageUrl: 'javascript:alert(1)' }),
    );

    expect(state.status === 'error' && state.fieldErrors?.imageUrl).toBeTruthy();
    expect(api.adminProductVariants).not.toHaveBeenCalled();
  });
});
