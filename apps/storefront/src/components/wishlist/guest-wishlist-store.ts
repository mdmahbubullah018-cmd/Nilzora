'use client';

/*
 * A guest's wishlist, kept in this browser
 * ----------------------------------------
 * Before anyone signs in there is no account to store a list against, so the heart writes
 * here: a small, versioned record of the products this browser saved, read through
 * useSyncExternalStore so every heart and the wishlist page always agree, and so a second tab
 * showing the same shop updates too.
 *
 * Nothing personal or secret is stored: product ids and addresses only, never a token.
 */

const STORAGE_KEY = 'nilzora.wishlist.v1';
/** Far beyond this a hand-made list stops being useful; it also caps the merge payload. */
const MAX_ENTRIES = 100;

export interface GuestEntry {
  id: string;
  slug: string;
  savedAt: string;
}

const EMPTY: readonly GuestEntry[] = [];
const listeners = new Set<() => void>();
/** The one snapshot React reads; replaced only when the list really changes. */
let snapshot: readonly GuestEntry[] = EMPTY;
let loaded = false;

function parse(raw: string): GuestEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const entries = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return [];
    const kept: GuestEntry[] = [];
    for (const value of entries) {
      if (typeof value !== 'object' || value === null) continue;
      const { id, slug, savedAt } = value as Partial<GuestEntry>;
      if (typeof id !== 'string' || typeof slug !== 'string') continue;
      if (kept.some((entry) => entry.id === id)) continue;
      kept.push({
        id,
        slug,
        savedAt: typeof savedAt === 'string' ? savedAt : new Date(0).toISOString(),
      });
      if (kept.length >= MAX_ENTRIES) break;
    }
    return kept;
  } catch {
    return [];
  }
}

function readStorage(): readonly GuestEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? EMPTY : parse(raw);
  } catch {
    return EMPTY;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Reads the saved list once per page, then keeps it in memory. */
function ensureLoaded(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  snapshot = readStorage();
}

function onStorage(event: StorageEvent): void {
  // Another tab changed the list: adopt it, so both tabs show the same hearts.
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  snapshot = readStorage();
  emit();
}

export function subscribeGuestWishlist(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export function guestWishlistSnapshot(): readonly GuestEntry[] {
  ensureLoaded();
  return snapshot;
}

/** The server knows nothing about a browser's list, so it renders an empty one. */
export function guestWishlistServerSnapshot(): readonly GuestEntry[] {
  return EMPTY;
}

/** Replaces the guest list. Empty removes the record entirely. */
export function writeGuestWishlist(entries: readonly GuestEntry[]): void {
  snapshot = entries.length === 0 ? EMPTY : entries;
  loaded = true;
  try {
    if (entries.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries }));
  } catch {
    // Blocked or full storage must never break the page; the list simply is not kept.
  }
  emit();
}
