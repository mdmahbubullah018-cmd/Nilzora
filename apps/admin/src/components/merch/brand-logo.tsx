'use client';

import type { AdminBrand } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { useState } from 'react';
import { brandInitials } from './brand-initials';

/** The same fallback the customer preview draws, re-exported for the existing callers. */
export { brandInitials };

/**
 * A brand's logo, or its initials on a soft tile.
 *
 * The picture comes from the media service, so it can fail for reasons this page cannot see —
 * a deleted object, a bucket that is not configured, a dropped connection. A broken <img> in an
 * operations table is a dead end, so the tile falls back to the initials exactly as it does for
 * a brand that never had a logo.
 *
 * The failure is remembered with the URL it belongs to: changing a brand's logo (or opening
 * another brand) starts over with the new address instead of inheriting the old failure.
 */
export function BrandLogo({ brand, className }: { brand: AdminBrand; className?: string }) {
  const source = brand.logo?.thumbUrl ?? null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showLogo = source !== null && failedSource !== source;

  return (
    <span
      className={cn(
        'grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-neutral-soft ring-1 ring-hairline',
        className,
      )}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service
        <img
          src={source}
          alt=""
          decoding="async"
          onError={() => {
            setFailedSource(source);
          }}
          className="size-full object-contain p-1.5"
        />
      ) : (
        <span aria-hidden="true" className="font-display text-lg font-semibold text-info-ink">
          {brandInitials(brand.name)}
        </span>
      )}
    </span>
  );
}
