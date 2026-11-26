import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WishlistItem } from '@nilzora/contracts';

/*
 * The heart, as a customer meets it.
 *
 * A guest's press writes to this browser only and never calls the server. A signed-in press
 * goes through the Server Action carrying the CSRF token, and a refusal leaves the heart
 * unsaved — the state only changes when the API confirms it.
 */

const actions = vi.hoisted(() => ({
  setWishlistItemAction: vi.fn(),
  mergeWishlistAction: vi.fn(),
}));
vi.mock('@/lib/wishlist-actions', () => actions);

const { WishlistProvider } = await import('./wishlist-provider');
const { WishlistButton } = await import('./wishlist-button');
const { writeGuestWishlist } = await import('./guest-wishlist-store');

const CSRF = { name: 'csrf_token', token: 'signed-test-token' };
const PRODUCT = {
  id: '0d000000-0000-4000-8000-000000000001',
  slug: 'casual-t-shirt',
  name: 'Casual T Shirt',
};
const STORAGE_KEY = 'nilzora.wishlist.v1';

const savedItem = {
  productId: PRODUCT.id,
  savedAt: '2026-11-05T10:00:00.000Z',
  product: {
    id: PRODUCT.id,
    slug: PRODUCT.slug,
    sku: 'CST-5',
    name: PRODUCT.name,
    summary: null,
    priceMinor: 10000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    isFeatured: false,
    category: { slug: 't-shirt', name: 'T Shirt' },
    image: null,
    brand: null,
  },
} as unknown as WishlistItem;

const saveLabel = `Save ${PRODUCT.name} to your wishlist`;
const removeLabel = `Remove ${PRODUCT.name} from your wishlist`;

function renderHeart(items: readonly WishlistItem[] | null) {
  return render(
    <WishlistProvider initialItems={items} csrf={CSRF}>
      <WishlistButton product={PRODUCT} />
    </WishlistProvider>,
  );
}

function guestEntries(): { slug: string }[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  const parsed = JSON.parse(raw) as { entries?: { slug: string }[] };
  return parsed.entries ?? [];
}

beforeEach(() => {
  actions.setWishlistItemAction.mockReset();
  // A signed-in page always tries the one-shot merge, so it needs an answer even in tests
  // that do not care about it.
  actions.mergeWishlistAction.mockReset().mockResolvedValue({ ok: true, items: [] });
  // The guest store keeps one snapshot for the whole module: clear both it and the storage.
  writeGuestWishlist([]);
  window.localStorage.clear();
});

describe('the wishlist heart', () => {
  it('saves a product for a guest in this browser, without asking the server', async () => {
    renderHeart(null);

    fireEvent.click(screen.getByRole('button', { name: saveLabel }));

    expect(await screen.findByRole('button', { name: removeLabel })).toBeTruthy();
    expect(actions.setWishlistItemAction).not.toHaveBeenCalled();
    expect(guestEntries().map((entry) => entry.slug)).toEqual([PRODUCT.slug]);
  });

  it('unsaves a guest product on a second press', async () => {
    renderHeart(null);

    fireEvent.click(screen.getByRole('button', { name: saveLabel }));
    fireEvent.click(await screen.findByRole('button', { name: removeLabel }));

    expect(
      (await screen.findByRole('button', { name: saveLabel })).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('saves through the Server Action, with the CSRF token, for a signed-in customer', async () => {
    actions.setWishlistItemAction.mockResolvedValue({ ok: true, items: [savedItem] });
    renderHeart([]);

    fireEvent.click(screen.getByRole('button', { name: saveLabel }));

    await waitFor(() => expect(actions.setWishlistItemAction).toHaveBeenCalledTimes(1));
    const body = actions.setWishlistItemAction.mock.calls[0]?.[0] as FormData;
    expect(body.get('productId')).toBe(PRODUCT.id);
    expect(body.get(CSRF.name)).toBe(CSRF.token);
    expect(body.get('intent')).toBeNull();
    expect(await screen.findByRole('button', { name: removeLabel })).toBeTruthy();
    // A signed-in list is the account's: nothing is written to this browser.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('asks the Server Action to remove a saved product', async () => {
    actions.setWishlistItemAction.mockResolvedValue({ ok: true, items: [] });
    renderHeart([savedItem]);

    fireEvent.click(screen.getByRole('button', { name: removeLabel }));

    await waitFor(() => expect(actions.setWishlistItemAction).toHaveBeenCalledTimes(1));
    expect((actions.setWishlistItemAction.mock.calls[0]?.[0] as FormData).get('intent')).toBe(
      'remove',
    );
    expect(await screen.findByRole('button', { name: saveLabel })).toBeTruthy();
  });

  it('leaves the heart unsaved when the API refuses', async () => {
    actions.setWishlistItemAction.mockResolvedValue({
      ok: false,
      items: [],
      message: 'This product is no longer available to save.',
    });
    renderHeart([]);

    fireEvent.click(screen.getByRole('button', { name: saveLabel }));

    await waitFor(() => expect(actions.setWishlistItemAction).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: saveLabel }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('leaves the heart unsaved when the action throws', async () => {
    actions.setWishlistItemAction.mockRejectedValue(new Error('network down'));
    renderHeart([]);

    fireEvent.click(screen.getByRole('button', { name: saveLabel }));

    await waitFor(() => expect(actions.setWishlistItemAction).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: saveLabel }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('shows an account product as already pressed', () => {
    renderHeart([savedItem]);

    expect(screen.getByRole('button', { name: removeLabel }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('folds a guest list into the account once the page knows who is signed in', async () => {
    actions.mergeWishlistAction.mockResolvedValue({ ok: true, items: [savedItem] });
    writeGuestWishlist([
      { id: PRODUCT.id, slug: PRODUCT.slug, savedAt: '2026-11-05T09:00:00.000Z' },
    ]);

    renderHeart([]);

    await waitFor(() => expect(actions.mergeWishlistAction).toHaveBeenCalledTimes(1));
    const body = actions.mergeWishlistAction.mock.calls[0]?.[0] as FormData;
    expect(body.get('slugs')).toBe(PRODUCT.slug);
    expect(body.get(CSRF.name)).toBe(CSRF.token);
    // The device's copy is dropped only after the account accepted it.
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
  });
});
