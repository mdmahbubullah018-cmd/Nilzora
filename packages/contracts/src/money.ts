import { z } from 'zod';

/*
 * Money
 * -----
 * Every amount the store handles is an integer number of poisha (1 BDT = 100 poisha),
 * never a float. This lives in its own module because both the catalog contracts and the
 * campaign contracts describe prices, and one importing the other would be a cycle.
 */

export const CURRENCY = 'BDT';

/** An amount in poisha. */
export const moneyMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
