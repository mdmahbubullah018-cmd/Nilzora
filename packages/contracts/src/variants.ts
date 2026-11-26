import { z } from 'zod';
import { moneyMinorSchema, slugSchema } from './catalog';

/*
 * Admin variants contract
 * -----------------------
 * Attributes are reusable across products; a variant is one combination of their
 * values for a single product. Prices are in poisha and null means "use the
 * product price". Stock is never sent by a client that is not allowed to set it.
 */

/** What an attribute is; a colour is drawn as a swatch, a size as a chip. */
export const ATTRIBUTE_KINDS = ['color', 'size', 'other'] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

/** A #RRGGBB swatch; null renders the value as text. */
export const swatchHexSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: 'Use a colour such as #0F172A' })
  .nullable();

export const attributeValueSchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  value: z.string().min(1).max(40),
  position: z.number().int().min(0),
  /** Absent on older payloads and on attributes without colour identity. */
  swatchHex: swatchHexSchema.optional(),
});

export const adminAttributeSchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  name: z.string().min(1).max(40),
  position: z.number().int().min(0),
  isActive: z.boolean(),
  /** Absent on older payloads. */
  kind: z.enum(ATTRIBUTE_KINDS).optional(),
  values: z.array(attributeValueSchema).default([]),
});

export const adminAttributesResponseSchema = z.object({
  attributes: z.array(adminAttributeSchema),
});

export const adminSaveAttributeRequestSchema = z.strictObject({
  /** Omit (or send null) to create a new attribute. */
  attributeId: z.uuid().nullable().optional(),
  slug: slugSchema,
  name: z.string().trim().min(1).max(40),
  position: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  kind: z.enum(ATTRIBUTE_KINDS).default('other'),
});

export const adminSaveAttributeValueRequestSchema = z.strictObject({
  valueId: z.uuid().nullable().optional(),
  attributeId: z.uuid(),
  slug: slugSchema,
  value: z.string().trim().min(1).max(40),
  position: z.number().int().min(0).max(999).default(0),
  swatchHex: swatchHexSchema.optional(),
});

export const adminVariantSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  /** Null when the variant inherits the product price. */
  priceMinor: moneyMinorSchema.nullable(),
  compareAtPriceMinor: moneyMinorSchema.nullable(),
  stockQuantity: z.number().int().min(0),
  imageUrl: z.string().nullable(),
  position: z.number().int().min(0),
  isActive: z.boolean(),
  /** The rendered options, e.g. 'Size: M / Colour: Navy'. */
  label: z.string().nullable(),
  /** The attribute values this variant stands for, one per attribute. */
  attributeValueIds: z.array(z.uuid()),
});

export const adminProductVariantsResponseSchema = z.object({
  variants: z.array(adminVariantSchema),
});

export const adminSaveVariantRequestSchema = z.strictObject({
  variantId: z.uuid().nullable().optional(),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, { error: 'Use capital letters, digits and hyphens' }),
  priceMinor: moneyMinorSchema.nullable().default(null),
  compareAtPriceMinor: moneyMinorSchema.nullable().default(null),
  imageUrl: z.string().trim().max(500).nullable().default(null),
  position: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  attributeValueIds: z.array(z.uuid()).min(1),
});

export const adminAdjustVariantStockRequestSchema = z.strictObject({
  change: z
    .number()
    .int()
    .refine((value) => value !== 0 && Math.abs(value) <= 1_000_000, {
      error: 'The change must be a whole number, not zero',
    }),
  note: z.string().trim().min(3).max(300),
});

export const adminSetVariantStockRequestSchema = z.strictObject({
  stock: z.number().int().min(0).max(1_000_000),
  note: z.string().trim().min(3).max(300),
});

export type AttributeValue = z.infer<typeof attributeValueSchema>;
export type AdminAttribute = z.infer<typeof adminAttributeSchema>;
export type AdminAttributesResponse = z.infer<typeof adminAttributesResponseSchema>;
export type AdminSaveAttributeRequest = z.infer<typeof adminSaveAttributeRequestSchema>;
export type AdminSaveAttributeValueRequest = z.infer<typeof adminSaveAttributeValueRequestSchema>;
export type AdminVariant = z.infer<typeof adminVariantSchema>;
export type AdminProductVariantsResponse = z.infer<typeof adminProductVariantsResponseSchema>;
export type AdminSaveVariantRequest = z.input<typeof adminSaveVariantRequestSchema>;
export type AdminAdjustVariantStockRequest = z.infer<typeof adminAdjustVariantStockRequestSchema>;
export type AdminSetVariantStockRequest = z.infer<typeof adminSetVariantStockRequestSchema>;
