import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface SegmentedNavOption {
  key: string;
  /** Text, or a translated fragment (`<AutoText>Today</AutoText>`). */
  label: ReactNode;
  href: Route;
}

export interface SegmentedNavProps {
  options: readonly SegmentedNavOption[];
  /** The key of the option in effect. */
  current: string;
  /** Names the control, e.g. "Sales period". */
  label: string;
  className?: string;
}

/**
 * A compact switch between views of the same page (e.g. 7, 30 or 90 days). Each option
 * is a link, so it works without JavaScript and every view has its own address; the
 * option in effect is marked with aria-current and drawn on the workspace's outlined
 * strip, the same language the Communication tabs use.
 */
export function SegmentedNav({ options, current, label, className }: SegmentedNavProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="nz-strip w-max min-w-0">
        {options.map((option) => {
          const active = option.key === current;
          return (
            <li key={option.key} className="shrink-0">
              <Link
                href={option.href}
                aria-current={active ? 'true' : undefined}
                scroll={false}
                className="nz-strip-item tabular-nums"
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
