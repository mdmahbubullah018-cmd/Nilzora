'use client';

import type { ProductSummary, WishlistItem } from '@nilzora/contracts';
import { Alert, Button, buttonClasses, cn } from '@nilzora/ui';
import { Heart, ShoppingBag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProductImage } from '@/components/catalog/product-image';
import { formatMoney } from '@/lib/format';
import { useWishlist } from './wishlist-provider';

/*
 * The saved products, as the customer sees them.
 *
 * A signed-in list is already in the page (the server read it). A guest's list is in this
 * browser, so its products are asked for by slug; a slug that no longer resolves is dropped
 * from the list rather than shown as a broken card.
 */

interface GuestProductState {
  /** The slug list this answer belongs to, so a newer list is never shown as loaded. */
  key: string;
  products: ProductSummary[];
  error: boolean;
}

interface GuestProducts {
  products: ProductSummary[];
  loading: boolean;
  error: boolean;
}

function useGuestProducts(slugs: readonly string[], enabled: boolean): GuestProducts {
  const [state, setState] = useState<GuestProductState>({
    key: '',
    products: [],
    error: false,
  });
  // A stable key so the effect does not re-run on every render.
  const key = slugs.join(',');

  useEffect(() => {
    if (!enabled || key === '') return;
    const controller = new AbortController();
    void fetch(`/api/wishlist/products?slugs=${encodeURIComponent(key)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('failed');
        const body = (await response.json()) as { products?: ProductSummary[] };
        setState({ key, products: body.products ?? [], error: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ key, products: [], error: true });
      });
    return () => controller.abort();
  }, [enabled, key]);

  // Nothing saved, or a guest page that has not asked: no request and nothing to show.
  if (!enabled || key === '') return { products: [], loading: false, error: false };
  // Loading is derived: an answer for an older list does not count as an answer for this one.
  return {
    products: state.key === key ? state.products : [],
    loading: state.key !== key,
    error: state.key === key && state.error,
  };
}

function SavedCard({
  product,
  onRemove,
  busy,
}: {
  product: ProductSummary;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <li className="group flex gap-3 py-4 sm:gap-4">
      <Link
        href={`/products/${product.slug}`}
        className="relative block size-20 shrink-0 overflow-hidden rounded-xl sm:size-24"
      >
        <ProductImage
          image={product.image}
          productName={product.name}
          categorySlug={product.category.slug}
          className="size-full rounded-xl transition-transform duration-300 ease-soft group-hover:scale-[1.04] motion-reduce:transform-none"
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/products/${product.slug}`}
          className="line-clamp-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {product.name}
        </Link>
        <p className="text-xs text-muted-foreground">{product.category.name}</p>
        <p className="mt-0.5 flex items-baseline gap-2 text-sm font-semibold text-foreground">
          {formatMoney(product.priceMinor)}
          {product.compareAtPriceMinor !== null ? (
            <span className="text-xs font-normal text-muted-foreground line-through">
              {formatMoney(product.compareAtPriceMinor)}
            </span>
          ) : null}
        </p>
        <p
          className={cn(
            'text-xs font-medium',
            product.availability === 'out_of_stock' ? 'text-danger' : 'text-success',
          )}
        >
          {product.availability === 'out_of_stock'
            ? 'Out of stock'
            : product.availability === 'low_stock'
              ? 'Only a few left'
              : 'In stock'}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Link
            href={`/products/${product.slug}`}
            className={buttonClasses({ size: 'sm', variant: 'outline' })}
          >
            <ShoppingBag aria-hidden="true" className="size-4" />
            {product.availability === 'out_of_stock' ? 'View product' : 'Choose options'}
          </Link>
          <Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={busy}>
            <Trash2 aria-hidden="true" className="size-4" />
            Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

/** A saved product that is no longer on sale: it can only be removed. */
function UnavailableRow({
  onRemove,
  busy,
}: {
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">This product is no longer available</p>
        <p className="text-xs text-muted-foreground">
          It has been removed or taken off sale. You can remove it from your wishlist.
        </p>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={busy}>
        <Trash2 aria-hidden="true" className="size-4" />
        Remove
      </Button>
    </li>
  );
}

function EmptyWishlist() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl bg-surface-muted/60 px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-surface text-offer ring-1 ring-border/60">
        <Heart aria-hidden="true" className="size-6" />
      </span>
      <div className="grid gap-1">
        <p className="font-display text-lg font-semibold text-foreground">Nothing saved yet</p>
        <p className="text-sm text-pretty text-muted-foreground">
          Tap the heart on a product to keep it here for later.
        </p>
      </div>
      <Link href="/products" className={buttonClasses()}>
        Browse products
      </Link>
    </div>
  );
}

export function WishlistView({
  signedIn,
  initialItems,
}: {
  signedIn: boolean;
  initialItems: readonly WishlistItem[];
}) {
  const wishlist = useWishlist();
  const guest = useGuestProducts(
    wishlist.guestItems.map((entry) => entry.slug),
    !signedIn,
  );
  const items = signedIn ? wishlist.items : [];
  const saved = items.filter((item) => item.product !== null);
  const unavailable = items.filter((item) => item.product === null);

  // The server list is the source of truth; `initialItems` only seeds the count on first paint.
  const total = signedIn ? items.length : wishlist.guestItems.length;
  void initialItems;

  return (
    <div className="grid gap-6">
      {wishlist.message ? <Alert tone="warning">{wishlist.message}</Alert> : null}

      {total === 0 && !guest.loading ? (
        <EmptyWishlist />
      ) : (
        <>
          {guest.error ? (
            <Alert tone="warning">
              Your saved products could not be loaded.{' '}
              <button
                type="button"
                className="font-semibold underline underline-offset-4"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </Alert>
          ) : null}

          {guest.loading && !signedIn ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading your list…</p>
          ) : null}

          {signedIn ? (
            <ul role="list" className="divide-y divide-border/60">
              {saved.map((item) =>
                item.product === null ? null : (
                  <SavedCard
                    key={item.productId}
                    product={item.product}
                    busy={wishlist.busy(item.productId)}
                    onRemove={() => {
                      void wishlist.toggle({ id: item.productId, slug: item.product?.slug ?? '' });
                    }}
                  />
                ),
              )}
              {unavailable.map((item) => (
                <UnavailableRow
                  key={item.productId}
                  busy={wishlist.busy(item.productId)}
                  onRemove={() => {
                    void wishlist.toggle({ id: item.productId, slug: '' });
                  }}
                />
              ))}
            </ul>
          ) : (
            <ul role="list" className="divide-y divide-border/60">
              {guest.products.map((product) => (
                <SavedCard
                  key={product.id}
                  product={product}
                  busy={wishlist.busy(product.id)}
                  onRemove={() => {
                    void wishlist.toggle({ id: product.id, slug: product.slug });
                  }}
                />
              ))}
            </ul>
          )}

          <div className="flex justify-center border-t border-border/60 pt-6">
            <Link href="/products" className={buttonClasses({ variant: 'outline' })}>
              Continue shopping
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
