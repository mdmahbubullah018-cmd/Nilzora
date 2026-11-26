'use client';

import type { ProductImage as ProductImageData } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { useState } from 'react';
import { ProductVisual, type ProductVisualProps } from './product-visual';

/**
 * The fields every picture on screen needs. A catalogue image has pixel dimensions, a cart
 * line's picture does not: the frame sets the layout either way.
 */
export type PictureData = Pick<ProductImageData, 'url' | 'thumbUrl' | 'alt'> &
  Partial<Pick<ProductImageData, 'width' | 'height'>>;

export interface ProductImageProps {
  /** The product's picture, or null/undefined for the branded placeholder tile. */
  image: PictureData | null | undefined;
  /** Used as the picture's description when it has none of its own. */
  productName: string;
  categorySlug?: string | null;
  /** `thumb` (up to 480px) for listings, `full` (up to 1600px) for the product page. */
  variant?: 'thumb' | 'full';
  /** Load immediately instead of lazily: only for the picture at the top of a page. */
  priority?: boolean;
  /** Hide the picture from screen readers: the product name is always shown as text beside it. */
  decorative?: boolean;
  size?: ProductVisualProps['size'];
  className?: string;
}

/**
 * A product picture in a square frame that keeps its size before, while and after the
 * file loads (the frame, not the file, sets the layout). The files are already resized
 * WebP from the media service, so a plain <img> is used. When there is no picture, or it
 * fails to load, the same frame shows the branded placeholder instead.
 */
export function ProductImage({
  image,
  productName,
  categorySlug,
  variant = 'thumb',
  priority = false,
  decorative = false,
  size = 'md',
  className,
}: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = image ? (variant === 'full' ? image.url : image.thumbUrl) : null;

  if (!image || src === null || failedSrc === src) {
    return <ProductVisual categorySlug={categorySlug} size={size} className={className} />;
  }

  return (
    <div
      aria-hidden={decorative || undefined}
      className={cn(
        'relative aspect-square w-full overflow-hidden bg-surface-muted ring-1 ring-border ring-inset',
        size === 'lg' ? 'rounded-xl' : 'rounded-lg',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
      <img
        src={src}
        alt={decorative ? '' : image.alt?.trim() || productName}
        width={image.width}
        height={image.height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        draggable={false}
        // A file that fails while the page is still loading never reaches onError (the event
        // fires before React attaches it), so a mounted image is checked once as well.
        ref={(node) => {
          if (node?.complete && node.naturalWidth === 0) setFailedSrc(src);
        }}
        onError={() => {
          setFailedSrc(src);
        }}
        className="absolute inset-0 size-full object-cover"
      />
    </div>
  );
}
