'use client';

import { cn } from '@nilzora/ui';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

const WIDE = '(min-width: 48rem)';

function isWide(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;
}

/**
 * One footer column. On phones it is an accordion (a native <details>); from tablet width up it
 * is always open and its title is a plain heading. Without JavaScript every column stays open.
 */
export function FooterSection({
  id,
  title,
  as: Wrapper = 'div',
  className,
  children,
}: {
  id: string;
  title: string;
  /** `nav` for columns of links, `div` for contact details or the app. */
  as?: 'nav' | 'div';
  className?: string;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const element = details.current;
    if (!element || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    const sync = () => {
      element.open = query.matches;
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return (
    <Wrapper aria-labelledby={id} className={className}>
      <details ref={details} open className="group/section border-b border-border md:border-0">
        <summary
          onClick={(event) => {
            // Columns are always open on wider screens; only phones collapse them.
            if (isWide()) event.preventDefault();
          }}
          className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 md:pointer-events-none md:mb-4 md:min-h-0 md:cursor-default [&::-webkit-details-marker]:hidden"
        >
          <span
            id={id}
            className="text-xs font-semibold tracking-[0.14em] text-brand-navy uppercase"
          >
            {title}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-200 group-open/section:rotate-180 motion-reduce:transition-none md:hidden',
            )}
          />
        </summary>
        <div className="pb-5 md:pb-0">{children}</div>
      </details>
    </Wrapper>
  );
}
