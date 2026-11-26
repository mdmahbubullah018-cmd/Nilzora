import { cn } from '@nilzora/ui';
import type { ReactNode } from 'react';
import { Container, SectionHeading } from '@/components/layout/section';

/** One home page band with the shared vertical rhythm; `muted` tints it to group content. */
export function HomeSection({
  id,
  title,
  eyebrow,
  description,
  action,
  muted = false,
  joined = false,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  muted?: boolean;
  /**
   * Set on a band that continues the one above it (the collections under the categories):
   * it drops its top padding, so the pair reads as one block instead of two strangers.
   */
  joined?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn(
        // One rhythm for the whole page: 24px a side on a phone, 32px from `sm`. Two
        // neighbouring bands therefore sit 48px (phone) or 64px (desktop) apart, which
        // separates them without the empty stretch the page used to have.
        'py-6 sm:py-8',
        joined && 'pt-0 sm:pt-0',
        muted && 'border-y border-border/70 bg-surface-muted/60',
      )}
    >
      {/*
        One column that is allowed to shrink: `grid-cols-[minmax(0,1fr)]`. A bare `grid` has an
        implicit `auto` column, and a grid item's automatic minimum size is its min-content width
        (an `overflow-x-auto` rail inside it does not make the wrapper around it shrinkable). The
        category rail's cards are sized in percentages, which cannot resolve while the column is
        being measured, so the column grew to the rail's full width (479px) and pushed the page
        past a 360-412px viewport. `minmax(0,1fr)` pins the column to the container, so every rail
        below (categories, brands, products, collections) scrolls inside it. Desktop is unchanged:
        the container was already the column's width there. */}
      <Container className="nz-reveal grid grid-cols-[minmax(0,1fr)] gap-5 sm:gap-7">
        <SectionHeading
          id={id}
          title={title}
          {...(eyebrow === undefined ? {} : { eyebrow })}
          {...(description === undefined ? {} : { description })}
          action={action}
        />
        {children}
      </Container>
    </section>
  );
}
