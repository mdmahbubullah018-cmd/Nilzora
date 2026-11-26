import { ShareButton } from '@nilzora/ui';
import { Share2 } from 'lucide-react';
import { productShareTarget } from '@/lib/storefront-url';

/*
 * Sharing a product from the workspace
 * ------------------------------------
 * Only a product that is live on the storefront has a page to point at, so only that product gets
 * a working share. Everything else explains itself rather than offering a link that would 404 —
 * and a draft is never given a preview address, because no secure preview is part of this
 * architecture.
 *
 * The address always comes from `storefrontProductPath`, so an admin route can never be shared by
 * mistake. The control reads the same product the page already shows; it asks for no extra
 * permission, because a published product page is public by definition.
 */

/** The fields the share needs; a list row and the detail page both have them. */
export interface ShareableProductState {
  slug: string;
  name: string;
  summary?: string | null;
  status: 'draft' | 'active' | 'archived';
  image?: { url: string } | null;
}

const REASONS: Record<Exclude<ShareableProductState['status'], 'active'>, string> = {
  draft: 'This product is not on sale, so it has no public page to share yet.',
  archived: 'This product is archived and no longer appears on the storefront.',
};

const UNAVAILABLE_STORE = 'Set STOREFRONT_URL to share links to the public storefront.';

export interface ProductShareProps {
  product: ShareableProductState;
  /** `label` beside the page title; `icon` in a list row. */
  variant?: 'icon' | 'label';
}

export function ProductShare({ product, variant = 'label' }: ProductShareProps) {
  const target = product.status === 'active' ? productShareTarget(product) : null;
  if (target !== null) return <ShareButton target={target} variant={variant} />;

  // A dense table row shows nothing rather than a control that cannot work.
  if (variant === 'icon') return null;

  const reason = product.status === 'active' ? UNAVAILABLE_STORE : REASONS[product.status];
  return (
    <span
      title={reason}
      className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-full border border-border bg-surface-muted px-3.5 text-sm font-semibold text-muted-foreground"
    >
      <Share2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
      Share
      <span className="sr-only">— {reason}</span>
    </span>
  );
}
