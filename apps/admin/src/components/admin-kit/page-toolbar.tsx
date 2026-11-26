import { cn } from '@nilzora/ui';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { AutoText } from '@/components/i18n/translate';
import type { ReactNode } from 'react';

export interface PageToolbarProps {
  /** The page's h1. */
  title: ReactNode;
  /** A small icon that names the page's area, shown in a chip beside the title. */
  icon?: LucideIcon;
  description?: ReactNode;
  /** A small label above the title, e.g. a status badge or the section name. */
  eyebrow?: ReactNode;
  /** A link back to the parent list, e.g. `{ href: '/admin/orders', label: 'Orders' }`. */
  back?: { href: Route; label: string };
  /** Facts under the title, e.g. badges or "Placed 25 Oct 2026". */
  meta?: ReactNode;
  /**
   * A picture to show instead of the icon chip — a customer's avatar on their own page, where
   * the face is more useful than a generic user glyph.
   */
  avatar?: ReactNode;
  /** Page-level actions (buttons, links, ConfirmForm), aligned to the end. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The top of a workspace page: optional back link, eyebrow, title, meta and
 * description on one side, page actions on the other. On phones the actions wrap below.
 */
export function PageToolbar({
  title,
  icon: Icon,
  description,
  eyebrow,
  back,
  meta,
  avatar,
  actions,
  className,
}: PageToolbarProps) {
  return (
    <div className={cn('grid gap-3', className)}>
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {avatar ? (
            <span className="mt-0.5 shrink-0"><AutoText value={avatar} /></span>
          ) : Icon ? (
            <span
              aria-hidden="true"
              className="mt-0.5 hidden size-12 shrink-0 place-items-center rounded-2xl border border-info-line bg-info-soft text-info-ink shadow-glass-xs sm:grid"
            >
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
          ) : null}
          <div className="grid min-w-0 gap-1.5">
            {eyebrow ? <div className="flex flex-wrap items-center gap-2"><AutoText value={eyebrow} /></div> : null}
            <h1 className="font-display text-[1.6rem] leading-tight font-semibold tracking-tight wrap-break-word text-foreground sm:text-[1.9rem]">
              {<AutoText value={title} />}
            </h1>
            {meta ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                {meta}
              </div>
            ) : null}
            {description ? (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {<AutoText value={description} />}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2"><AutoText value={actions} /></div>
        ) : null}
      </div>
    </div>
  );
}
