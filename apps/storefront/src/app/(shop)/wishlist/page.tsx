import type { Metadata } from 'next';
import type { WishlistItem } from '@nilzora/contracts';
import Link from 'next/link';
import { WishlistView } from '@/components/wishlist/wishlist-view';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Your wishlist',
  description: 'Products you saved for later at Nilzora.',
  robots: { index: false, follow: true },
};

/**
 * The customer's saved products. A signed-in list is read here, on the server, so the page
 * arrives complete; a guest's list lives in their browser and the view resolves it itself.
 */
export default async function WishlistPage() {
  const current = await session.getSession();
  if (current.status !== 'signed_in') {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Your wishlist
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Saved on this device.{' '}
          <Link
            href="/login?next=/wishlist"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>{' '}
          to keep it with your account and see it in the app.
        </p>
        <div className="mt-8">
          <WishlistView signedIn={false} initialItems={[]} />
        </div>
      </div>
    );
  }

  const list = await session.read((api, accessToken) => api.myWishlist(accessToken));
  const items: readonly WishlistItem[] = list.kind === 'ok' ? list.value.items : [];
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Your wishlist
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {items.length === 0
          ? 'Nothing saved yet.'
          : `${items.length} ${items.length === 1 ? 'product' : 'products'} saved.`}
      </p>
      {list.kind === 'unavailable' ? (
        <p className="mt-6 rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
          Your wishlist could not be loaded just now. Reload the page to try again.
        </p>
      ) : (
        <div className="mt-6">
          <WishlistView signedIn initialItems={items} />
        </div>
      )}
    </div>
  );
}
