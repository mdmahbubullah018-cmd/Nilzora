'use client';

import type { Brand } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { useState } from 'react';

/** Up to two initials, for brands without a logo yet. */
export function brandInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  ).toUpperCase();
}

const BOX = { sm: 'size-12', md: 'size-20', lg: 'size-28' } as const;

/**
 * A brand's logo, or its initials when it has none.
 *
 * The logo is served by the media service, so it can fail to load — a deleted object, an
 * unconfigured bucket, a dropped connection. A broken picture is worse than no picture, so the
 * tile falls back to the same initials it shows for a brand that never uploaded one. The failure
 * is remembered with the URL it belongs to, so a brand whose logo changes starts over.
 *
 * `tile` is the square badge used beside a brand's name on its own page. `band` is the
 * banner shape used in lists: the logo is contained in a wide, quiet strip, at whatever
 * height the caller sets, so every logo in a grid carries the same visual weight and none is
 * cropped or stretched to fill a square.
 */
export function BrandMark({
  brand,
  size = 'md',
  shape = 'tile',
  className,
}: {
  brand: Pick<Brand, 'name' | 'logo'>;
  size?: 'sm' | 'md' | 'lg';
  shape?: 'tile' | 'band';
  className?: string;
}) {
  const source = brand.logo?.thumbUrl ?? null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showLogo = source !== null && failedSource !== source;

  return (
    <span
      className={cn(
        shape === 'band'
          ? // A definite height, so the logo's own `100%` resolves against the panel it sits in
            // instead of growing to the picture's natural size and being clipped by it.
            'flex h-full w-full items-center justify-center'
          : cn(
              'grid shrink-0 place-items-center rounded-2xl bg-surface ring-1 ring-border',
              BOX[size],
            ),
        className,
      )}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailedSource(source);
          }}
          className={
            shape === 'band'
              ? 'h-full w-full object-contain'
              : 'size-full object-contain p-2.5'
          }
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'font-display font-semibold tracking-tight text-primary',
            size === 'sm' ? 'text-base' : size === 'md' ? 'text-2xl' : 'text-4xl',
          )}
        >
          {brandInitials(brand.name)}
        </span>
      )}
    </span>
  );
}
