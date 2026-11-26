import { placeOrderRequestSchema, type CartItem } from '@nilzora/contracts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

/*
 * Idempotency keys for placing an order
 * -------------------------------------
 * The API treats the same key as the same order: a repeat answers with the original order
 * instead of creating another. So a key must outlive anything that can leave the outcome
 * unknown: a timeout, a lost connection, a 5xx, or the app being killed after the server
 * saved the order and before the customer saw the answer. Only a definitive answer (the order
 * was saved, or it was refused) lets the next attempt start a new key.
 *
 * Each attempt is therefore written to the device BEFORE the request is sent, one record per
 * account (`nilzora.checkout.attempt.v1:<userId>`), and removed only once the outcome is
 * known. A record holds the key, a fingerprint of the order it was made for (product ids,
 * quantities, address and a hash of the note: no text of the note itself) and the time it was
 * started. After a restart the record is found again and its key reused. If the customer
 * changed the order in between and the first attempt had in fact been saved, the API refuses
 * the key as used for a different order (idempotency_conflict): that is safe, whereas a fresh
 * key there could place the order twice. Records older than 12 hours are dropped, unreadable
 * or malformed ones are ignored, and a storage that cannot be written does not stop the order
 * (the key is still kept in memory for this run).
 */

/** Prefix of the storage key; the account id follows. */
export const ATTEMPT_STORAGE_PREFIX = 'nilzora.checkout.attempt.v1:';
/** An attempt older than this is forgotten: the customer is no longer retrying it. */
export const ATTEMPT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** A record dated further ahead than this (a clock set back) is not trusted. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const STORAGE_FORMAT = 1;
/** One record is about 150 bytes; anything far beyond that is not something this app wrote. */
const MAX_RECORD_LENGTH = 1024;

export interface AttemptRecord {
  v: typeof STORAGE_FORMAT;
  key: string;
  fingerprint: string;
  startedAt: number;
}

export interface Attempt {
  /** The idempotency key to send. */
  key: string;
  /** An earlier, unresolved attempt was found and its key is being reused. */
  resumed: boolean;
  /** The earlier attempt was made for the same order (same items, address and note). */
  sameOrder: boolean;
}

export interface OrderToFingerprint {
  addressId: string;
  items: readonly CartItem[];
  note: string;
}

/** cyrb53: a small non-cryptographic hash; the fingerprint only has to tell two orders apart. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * A deterministic fingerprint of an order: the same address, products, variants, quantities
 * and note give the same text whatever the order of the lines. The note is only hashed, and
 * nothing else in it is secret (ids and quantities).
 *
 * The variant is part of a line: the same product in another size or colour is another
 * order, and calling it the same one would let a resumed key answer for the wrong basket.
 */
export function fingerprintOrder({ addressId, items, note }: OrderToFingerprint): string {
  const lines = items
    .map(({ productId, variantId, quantity }) =>
      [productId.toLowerCase(), variantId?.toLowerCase() ?? '-', `x${quantity}`].join(':'),
    )
    .sort()
    .join(',');
  return `2:${hash(`${addressId.toLowerCase()}|${lines}|${note.trim()}`)}`;
}

const unresolved = new Map<string, AttemptRecord>();

const storageKey = (userId: string) => `${ATTEMPT_STORAGE_PREFIX}${userId}`;

function isRecord(value: unknown): value is AttemptRecord {
  if (typeof value !== 'object' || value === null) return false;
  const { v, key, fingerprint, startedAt } = value as Record<string, unknown>;
  return (
    v === STORAGE_FORMAT &&
    placeOrderRequestSchema.shape.idempotencyKey.safeParse(key).success &&
    typeof fingerprint === 'string' &&
    fingerprint.length > 0 &&
    fingerprint.length <= 64 &&
    typeof startedAt === 'number' &&
    Number.isFinite(startedAt)
  );
}

function isFresh(record: AttemptRecord, now: number): boolean {
  const age = now - record.startedAt;
  return age <= ATTEMPT_MAX_AGE_MS && age >= -CLOCK_SKEW_MS;
}

/** The saved record, or null when there is none or it cannot be used. Never throws. */
async function readRecord(userId: string): Promise<AttemptRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (raw === null || raw.length > MAX_RECORD_LENGTH) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Unreadable or corrupt: behave as if nothing was saved.
    return null;
  }
}

async function removeRecord(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch {
    console.warn('[nilzora] a finished checkout attempt could not be cleared on this device');
  }
}

/**
 * The key for this account's next attempt, saved to the device before it is returned (so
 * before the order is sent). An unresolved, fresh attempt is resumed: its key is returned
 * even if the order has changed since. Otherwise a new key is made and recorded.
 */
export async function beginAttempt(
  userId: string,
  order: OrderToFingerprint,
  now: number = Date.now(),
): Promise<Attempt> {
  const fingerprint = fingerprintOrder(order);
  const saved = unresolved.get(userId) ?? (await readRecord(userId));

  if (saved !== null && isFresh(saved, now)) {
    unresolved.set(userId, saved);
    return { key: saved.key, resumed: true, sameOrder: saved.fingerprint === fingerprint };
  }

  // Nothing usable (none, too old, or unreadable): this attempt starts afresh. Writing the new
  // record below replaces whatever stale or malformed text was there.
  const record: AttemptRecord = {
    v: STORAGE_FORMAT,
    key: randomUUID(),
    fingerprint,
    startedAt: now,
  };
  unresolved.set(userId, record);
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(record));
  } catch {
    // The order can still be sent; only a restart before the answer would lose the key.
    console.warn('[nilzora] the checkout attempt could not be saved on this device');
  }
  return { key: record.key, resumed: false, sameOrder: true };
}

/** The outcome is known (saved, or refused): the next attempt gets a new key. */
export async function settleAttempt(userId: string): Promise<void> {
  unresolved.delete(userId);
  await removeRecord(userId);
}

/** True while an earlier attempt may have saved the order without the app knowing. */
export async function hasUnresolvedAttempt(userId: string): Promise<boolean> {
  return unresolved.has(userId) || (await readRecord(userId)) !== null;
}

/** Tests only: forget what this run remembers, as if the app had been restarted. */
export function simulateRestart(): void {
  unresolved.clear();
}
