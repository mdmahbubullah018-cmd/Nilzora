import { z } from 'zod';

/*
 * Shared pieces of the admin and moderator contracts. Every admin endpoint is
 * authorised twice: the API checks the caller's permission, then the database checks
 * it again for the signed-in account (its functions and Row Level Security), so a
 * client can shape its interface from GET /me but never widen what it may do.
 */

/** Deepest page of an admin listing; the database refuses offsets beyond 100,000 rows. */
export const ADMIN_MAX_PAGE = 1000;
export const ADMIN_MAX_PAGE_SIZE = 100;

/** `page` and `pageSize` of an admin listing's query string. */
export const adminPageQueryShape = {
  page: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE).default(1),
  pageSize: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE_SIZE).default(25),
};

/** The paging fields of an admin listing's response. */
export const pageInfoShape = {
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
};

/** Free-text search of an admin listing. */
export const adminSearchSchema = z.string().trim().min(1).max(100);

/** Optional text that an empty string clears (stored as null). */
export function optionalTextSchema(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
}

/**
 * A staff account named on an admin screen (who submitted, reviewed or changed
 * something). Name and email are null when the caller may not see them.
 */
export const accountRefSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export type AccountRef = z.infer<typeof accountRefSchema>;
