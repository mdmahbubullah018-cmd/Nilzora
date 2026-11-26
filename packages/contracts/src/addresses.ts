import { bdMobilePhoneSchema, fullNameSchema } from '@nilzora/validation';
import { z } from 'zod';
import { BD_DIVISIONS, DELIVERY_ZONES, isDistrictOf } from './locations';

/*
 * Delivery addresses. Each belongs to one customer; the API and the database both
 * enforce ownership. Orders copy the address, so editing it never changes past orders.
 */

export const MAX_ADDRESSES = 10;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/**
 * POST /me/addresses and PUT /me/addresses/:id (replaces every address field).
 * `isDefault: true` makes the address the default; `false` is ignored, because the
 * default only moves when another address is chosen (an account keeps one default).
 */
export const addressInputSchema = z
  .strictObject({
    label: optionalText(40),
    recipientName: fullNameSchema,
    phone: bdMobilePhoneSchema,
    division: z.enum(BD_DIVISIONS, { error: 'Choose a division' }),
    district: z.string().trim().min(1, { error: 'Choose a district' }).max(40),
    area: z.string().trim().min(2, { error: 'Enter the area, thana or upazila' }).max(80),
    addressLine: z.string().trim().min(5, { error: 'Enter the house, road and block' }).max(200),
    postalCode: z
      .string()
      .trim()
      .regex(/^(\d{4})?$/, { error: 'Postal codes have 4 digits' })
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    landmark: optionalText(120),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => isDistrictOf(value.division, value.district), {
    error: 'Choose a district in the selected division',
    path: ['district'],
  });

export const addressSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  recipientName: z.string(),
  phone: z.string(),
  division: z.enum(BD_DIVISIONS),
  district: z.string(),
  area: z.string(),
  addressLine: z.string(),
  postalCode: z.string().nullable(),
  landmark: z.string().nullable(),
  isDefault: z.boolean(),
  deliveryZone: z.enum(DELIVERY_ZONES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const addressListResponseSchema = z.object({ addresses: z.array(addressSchema) });
export const addressResponseSchema = z.object({ address: addressSchema });

export type AddressInput = z.input<typeof addressInputSchema>;
export type Address = z.infer<typeof addressSchema>;
export type AddressListResponse = z.infer<typeof addressListResponseSchema>;
export type AddressResponse = z.infer<typeof addressResponseSchema>;
