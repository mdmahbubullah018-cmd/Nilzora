'use client';

import type { MediaPicture } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { useState } from 'react';
import { ProductVisual } from './product-visual';

export interface CategoryCoverProps {
  /** The category's cover, or null/undefined for the branded placeholder. */
  image: MediaPicture | null | undefined;
  /** The category name, used as the picture's description. */
  name: string;
  /**
   * Description for screen readers; defaults to `name`. Pass `''` where the picture is
   * decorative because something next to it already names the category (a tile link).
   */
  alt?: string;
  categorySlug?: string | null;
  /** `thumb` (up to 480px) for lists, `full` (up to 1600px) for the category page. */
  variant?: 'thumb' | 'full';
  /** Load immediately instead of lazily: only for the cover at the top of a page. */
  priority?: boolean;
  /**
   * Fill the parent instead of holding a square of its own. Used when the cover is the
   * background of a whole card, where the card's own aspect ratio sets the shape.
   */
  fill?: boolean;
  className?: string;
}

/**
 * A category cover in a frame that keeps its shape whether or not there is a picture. The
 * files are already resized WebP from the media service, so a plain <img> is used; when the
 * category has no cover, or it fails to load, the branded category tile shows instead.
 */
export function CategoryCover({
  image,
  name,
  alt,
  categorySlug,
  variant = 'thumb',
  priority = false,
  fill = false,
  className,
}: CategoryCoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = image ? (variant === 'full' ? image.url : image.thumbUrl) : null;
  const frame = fill ? 'absolute inset-0 size-full' : 'relative aspect-square w-full';

  if (!image || src === null || failedSrc === src) {
    return (
      <ProductVisual
        categorySlug={categorySlug}
        size="md"
        className={cn(fill ? 'size-full rounded-none' : 'aspect-square w-full rounded-lg', className)}
      />
    );
  }

  return (
    <div
      className={cn(
        frame,
        'overflow-hidden bg-surface-muted ring-1 ring-border ring-inset',
        fill ? 'rounded-none' : 'rounded-lg',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
      <img
        src={src}
        alt={alt ?? name}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        draggable={false}
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
