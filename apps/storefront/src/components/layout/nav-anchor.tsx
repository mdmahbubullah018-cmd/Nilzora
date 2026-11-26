import type { Route } from 'next';
import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';

/** A link the store manages: a label and either a store path or an https address. */
export interface NavLinkItem {
  label: string;
  href: string;
}

/** An https address, as opposed to a path inside the store. */
export function isExternalHref(href: string): boolean {
  return href.startsWith('https://');
}

/** A path inside the store (not protocol-relative). */
function isStorePath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

/**
 * One managed link. A store path is a normal client-side link; an https address opens in a
 * new tab without giving the page access to this one. Anything else (the API already refuses
 * it) renders nothing rather than a link that could run code.
 */
export function NavAnchor({
  href,
  className,
  onClick,
  children,
}: {
  href: string;
  className?: string | undefined;
  onClick?: MouseEventHandler<HTMLAnchorElement> | undefined;
  children: ReactNode;
}) {
  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  if (!isStorePath(href)) return null;
  return (
    <Link href={href as Route} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
