/*
 * A voucher a guest chose to collect, remembered across the sign-in trip.
 *
 * The app's return-to paths refuse query strings (see lib/return-to), so the chosen voucher
 * cannot ride along in the address. It waits here instead: the product screen hands it to the
 * sign-in screen's return path, and the same product screen picks it up once the customer is
 * signed in. The entry is dropped after a short while, so a collection started and abandoned
 * never surprises anyone days later.
 */

const MAX_AGE_MS = 10 * 60 * 1000;

interface PendingCollect {
  slug: string;
  voucherId: string;
  at: number;
}

let pending: PendingCollect | null = null;

/** Remembers the voucher a guest asked for, against the product they were reading. */
export function rememberPendingCollect(slug: string, voucherId: string): void {
  pending = { slug, voucherId, at: Date.now() };
}

/**
 * Takes the pending voucher for this product, once. Returns null when there is nothing
 * waiting, when it belongs to another product, or when it is too old to still mean anything.
 */
export function takePendingCollect(slug: string): string | null {
  if (pending === null) return null;
  if (pending.slug !== slug || Date.now() - pending.at > MAX_AGE_MS) {
    pending = null;
    return null;
  }
  const { voucherId } = pending;
  pending = null;
  return voucherId;
}

/** Test hook: forgets anything waiting. */
export function resetPendingCollect(): void {
  pending = null;
}
