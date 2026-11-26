'use client';

import type { ProductImage as ProductImageData, ProductVideo } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { ChevronLeft, ChevronRight, Expand, Images } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ImageLightbox, swipeStep, wrapIndex } from './image-lightbox';
import { ProductImage } from './product-image';
import { ProductVideoStage, ProductVideoThumb } from './product-video';
import { useVariantImageHandle, type VariantImage } from './variant-image-context';

export interface ProductGalleryProps {
  images: readonly ProductImageData[];
  /** The product's videos, in the order the admin set; shown after the pictures. */
  videos?: readonly ProductVideo[];
  productName: string;
  categorySlug?: string | null;
  className?: string;
}

type Media =
  | { kind: 'image'; key: string; image: ProductImageData }
  | { kind: 'video'; key: string; video: ProductVideo; number: number };

const roundButton =
  'grid size-11 place-items-center rounded-full bg-surface/90 text-foreground shadow-md ring-1 ring-border backdrop-blur transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The product page's media: one large stage and, when there are several items, a strip of
 * thumbnails that choose it. Pictures come first (the first one is the cover), then the
 * product's videos, each in the order the admin arranged them. A picture opens full screen
 * to look closer; a video plays in place with the browser's own controls.
 *
 * The strip is a group of toggle buttons: each is a tab stop, the arrow, Home and End keys
 * move between them, and the chosen one is announced as pressed. On a touch screen a picture
 * also follows a sideways swipe (a video does not, so its seek bar stays usable).
 */
export function ProductGallery({
  images,
  videos = [],
  productName,
  categorySlug,
  className,
}: ProductGalleryProps) {
  const [selected, setSelected] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  // A swipe ends with a click on the picture; that click must not open the full-screen view.
  const justSwiped = useRef(false);
  /** The chosen variant's own picture, when the page shares one with this gallery. */
  const variantChoice = useVariantImageHandle();
  const variantImage = variantChoice?.image ?? null;
  const asPicture = (variant: VariantImage): ProductImageData => ({
    id: `variant:${variant.url}`,
    url: variant.url,
    thumbUrl: variant.url,
    alt: `${productName}, ${variant.label}`,
    width: 0,
    height: 0,
    position: 0,
  });

  const media: Media[] = [
    ...images.map((image): Media => ({ kind: 'image', key: image.id, image })),
    ...videos.map((video, position): Media => ({
      kind: 'video',
      key: `video:${video.id}`,
      video,
      number: position + 1,
    })),
  ];
  const count = media.length;
  const index = Math.min(selected, count - 1);
  const current = media[index];

  if (!current) {
    return (
      <ProductImage
        image={variantImage === null ? null : asPicture(variantImage)}
        productName={productName}
        categorySlug={categorySlug}
        size="lg"
        className={className}
      />
    );
  }

  const alt = (image: ProductImageData) => image.alt?.trim() || productName;
  // The variant's own picture takes the stage over whatever is chosen, until a choice is made.
  const showingImage = variantImage !== null || current.kind === 'image';

  const choose = (target: number) => {
    // Choosing an item hands control back from the chosen variant's own picture.
    if (variantImage !== null) variantChoice?.setImage(null);
    setSelected(target);
    thumbs.current[target]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, position: number) => {
    const last = count - 1;
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (position + 1) % count
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (position - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    choose(target);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A touch swipe usually ends without a click, so the flag never outlives the next press.
    justSwiped.current = false;
    swipeFrom.current = showingImage ? { x: event.clientX, y: event.clientY } : null;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (!from || count < 2) return;
    const step = swipeStep(event.clientX - from.x, event.clientY - from.y);
    if (step === 0) return;
    justSwiped.current = true;
    setSelected(wrapIndex(index, step, count));
  };

  const itemLabel = (item: Media, position: number) =>
    item.kind === 'image'
      ? `Show picture ${String(position + 1)} of ${String(count)}`
      : `Show ${item.video.title ?? `video ${String(item.number)}`} (${String(position + 1)} of ${String(count)})`;

  return (
    <div className={cn('grid gap-3', className)}>
      <div
        className="group relative touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeFrom.current = null;
        }}
      >
        {variantImage !== null ? (
          <ProductImage
            key={`variant:${variantImage.url}`}
            image={asPicture(variantImage)}
            productName={productName}
            categorySlug={categorySlug}
            variant="full"
            size="lg"
          />
        ) : current.kind === 'image' ? (
          <ProductImage
            // A new element per picture, so the previous one never lingers while it loads.
            key={current.key}
            image={current.image}
            productName={productName}
            categorySlug={categorySlug}
            variant="full"
            priority={index === 0}
            size="lg"
          />
        ) : (
          <ProductVideoStage
            key={current.key}
            video={current.video}
            productName={productName}
            position={current.number}
          />
        )}
        {variantImage === null ? null : (
          <>
            <p className="pointer-events-none absolute top-3 left-3 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border backdrop-blur">
              {variantImage.label}
            </p>
            <button
              type="button"
              onClick={() => {
                variantChoice?.setImage(null);
              }}
              aria-label={`Show the pictures of ${productName}`}
              className={cn(
                roundButton,
                'absolute right-3 top-3 w-auto gap-1.5 px-3 text-xs font-semibold',
              )}
            >
              <Images aria-hidden="true" className="size-4" />
              Pictures
            </button>
          </>
        )}
        {current.kind === 'image' && variantImage === null ? (
          <button
            type="button"
            onClick={() => {
              if (justSwiped.current) {
                justSwiped.current = false;
                return;
              }
              // Pictures come first, so a picture's place in the gallery is its lightbox index.
              setViewing(index);
            }}
            aria-label={`View picture ${String(index + 1)} of ${String(images.length)} full screen`}
            className="absolute inset-0 cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border backdrop-blur">
              <Expand aria-hidden="true" className="size-3.5" />
              {count > 1 ? `${String(index + 1)} / ${String(count)}` : 'Zoom'}
            </span>
          </button>
        ) : null}
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label={videos.length > 0 ? 'Previous' : 'Previous picture'}
              onClick={() => {
                choose(wrapIndex(index, -1, count));
              }}
              className={cn(roundButton, 'absolute top-1/2 left-3 -translate-y-1/2')}
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              aria-label={videos.length > 0 ? 'Next' : 'Next picture'}
              onClick={() => {
                choose(wrapIndex(index, 1, count));
              }}
              className={cn(roundButton, 'absolute top-1/2 right-3 -translate-y-1/2')}
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div
          role="group"
          aria-label={videos.length > 0 ? 'Product pictures and videos' : 'Product pictures'}
          className="flex gap-2 overflow-x-auto p-1 scrollbar-thin"
        >
          {media.map((item, position) => (
            <button
              key={item.key}
              ref={(node) => {
                thumbs.current[position] = node;
              }}
              type="button"
              aria-pressed={position === index && variantImage === null}
              aria-label={itemLabel(item, position)}
              onClick={() => {
                choose(position);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, position);
              }}
              className={cn(
                'size-16 shrink-0 overflow-hidden rounded-md transition-shadow sm:size-20',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                // The chosen one is ringed outside the tile, so a video's overlay cannot hide it.
                position === index && variantImage === null
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : 'ring-1 ring-border ring-inset',
              )}
            >
              {item.kind === 'image' ? (
                <ProductImage
                  image={item.image}
                  productName={productName}
                  categorySlug={categorySlug}
                  size="sm"
                  className="size-full rounded-none ring-0"
                />
              ) : (
                <ProductVideoThumb video={item.video} />
              )}
            </button>
          ))}
        </div>
      ) : null}

      <ImageLightbox
        images={images.map((image) => ({
          url: image.url,
          thumbUrl: image.thumbUrl,
          alt: alt(image),
        }))}
        index={viewing}
        onIndexChange={(target) => {
          setViewing(target);
          setSelected(target);
        }}
        onClose={() => setViewing(null)}
        label={`Pictures of ${productName}`}
      />
    </div>
  );
}
