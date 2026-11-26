import { z } from 'zod';
import { slugSchema } from './catalog';

/*
 * Slug availability
 * -----------------
 * The admin product, category and brand forms ask whether an address (slug) is free
 * while staff type it, before saving. The database answers from the real rows, so the
 * answer matches what a save would do: the same shape rules, the brand paths the
 * storefront reserves, and the old brand addresses kept as redirects. A later save can
 * still be refused if someone takes the address in between.
 */

export const SLUG_KINDS = ['product', 'category', 'brand'] as const;
export type SlugKind = (typeof SLUG_KINDS)[number];

/**
 * Why an address cannot be used: another item has it (or, for brands, keeps it as a
 * redirect), the storefront reserves it (brands only), or it is not a valid address.
 */
export const SLUG_UNAVAILABLE_REASONS = ['taken', 'reserved', 'invalid'] as const;
export type SlugUnavailableReason = (typeof SLUG_UNAVAILABLE_REASONS)[number];

/** GET /admin/slugs/availability?kind=product&slug=desk-lamp&excludeId=<uuid> */
export const slugAvailabilityQuerySchema = z.object({
  kind: z.enum(SLUG_KINDS),
  /** Checked as typed: an address with capitals or spaces is reported as invalid. */
  slug: z.string().min(1).max(200),
  /** The item being edited, whose own address counts as free. */
  excludeId: z.uuid().optional(),
});

export const slugAvailabilityResponseSchema = z
  .object({
    available: z.boolean(),
    reason: z.enum(SLUG_UNAVAILABLE_REASONS).nullable(),
    /**
     * The first free `<slug>-2`, `<slug>-3`, … when the address is taken or reserved
     * (shortened to fit when needed); null when it is free or not a valid address.
     */
    suggestion: slugSchema.nullable(),
  })
  .refine((answer) => answer.available === (answer.reason === null), {
    error: 'An address is available exactly when there is no reason against it',
    path: ['reason'],
  });

export type SlugAvailabilityQuery = z.input<typeof slugAvailabilityQuerySchema>;
export type SlugAvailabilityResponse = z.infer<typeof slugAvailabilityResponseSchema>;
