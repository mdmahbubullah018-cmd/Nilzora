'use client';

import type { ReviewImage } from '@nilzora/contracts';
import { useState } from 'react';
import { ImageLightbox } from '@/components/catalog/image-lightbox';

/**
 * A published review's photos as small tiles that open full screen. The API returns photos
 * only with approved reviews, so these have passed the store's moderation with the review.
 */
export function ReviewGallery({
  images,
  author,
}: {
  images: readonly ReviewImage[];
  author: string;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (images.length === 0) return null;
  const pictures = images.map((image, index) => ({
    url: image.url,
    thumbUrl: image.thumbUrl,
    alt: `Photo ${index + 1} from ${author}'s review`,
  }));
  return (
    <>
      <ul role="list" aria-label={`Photos from ${author}`} className="flex flex-wrap gap-2">
        {pictures.map((picture, index) => (
          <li key={picture.url}>
            <button
              type="button"
              onClick={() => setViewing(index)}
              aria-label={`View ${picture.alt.toLowerCase()} full screen`}
              className="block size-20 cursor-zoom-in overflow-hidden rounded-lg bg-surface-muted ring-1 ring-border ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:size-24"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
              <img
                src={picture.thumbUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
      <ImageLightbox
        images={pictures}
        index={viewing}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
        label={`Photos from ${author}'s review`}
      />
    </>
  );
}
