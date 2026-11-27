'use client';

import { cn } from '@nilzora/ui';
import { ArrowRight, Search } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { openCommandPalette, useModifierLabel } from './command-palette';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

export interface QuickSearchScope {
  value: string;
  label: string;
  /** The list page that accepts `?q=`, e.g. `/admin/products`. */
  href: Route;
}

export interface QuickSearchProps {
  /** The lists this account may search, in menu order; the first is the default. */
  scopes: readonly QuickSearchScope[];
  /** Shown at every width (inside the phone drawer) instead of only on wide screens. */
  inline?: boolean;
  /** Names the form for assistive technology; the drawer uses its own name. */
  label?: string;
  /** Called after a search is sent (the phone drawer closes itself). */
  onSubmitted?: () => void;
  className?: string;
}

/**
 * The top bar's search: it hands the term to an existing list filter (`?q=`), so it
 * searches exactly what those pages already search — nothing is invented here. Without
 * JavaScript the form submits to the first scope's list as a normal GET.
 *
 * Pressing "/" anywhere outside a field focuses it, the way most dashboards behave.
 */
export function QuickSearch({
  scopes,
  inline = false,
  label = 'Search the workspace',
  onSubmitted,
  className,
}: QuickSearchProps) {
  const tx = useTx();
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<string>(scopes[0]?.value ?? '');
  const id = useId();
  const first = scopes[0];
  const modifier = useModifierLabel();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      field.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!first) return null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = field.current?.value.trim() ?? '';
    const target = scopes.find((option) => option.value === scope) ?? first;
    if (!target) return;
    router.push(term === '' ? target.href : `${target.href}?q=${encodeURIComponent(term)}`);
    onSubmitted?.();
  }

  return (
    <form
      action={first.href}
      method="get"
      role="search"
      aria-label={label}
      onSubmit={onSubmit}
      className={cn(
        'min-w-0 items-center gap-1.5 rounded-2xl border border-border/80 bg-surface/70 py-1 pr-1 pl-2 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-all',
        'focus-within:border-info-line focus-within:bg-surface focus-within:ring-4 focus-within:ring-info-soft',
        inline ? 'flex' : 'hidden w-80 2xl:flex',
        className,
      )}
    >
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <label htmlFor={id} className="sr-only">
        <AutoText>Search term</AutoText>
      </label>
      <input
        ref={field}
        id={id}
        name="q"
        type="search"
        autoComplete="off"
        placeholder={tx('Search products, orders, customers…')}
        className="h-7 w-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {scopes.length > 1 ? (
        <>
          <label htmlFor={`${id}-scope`} className="sr-only">
            <AutoText>Search in</AutoText>
          </label>
          <select
            id={`${id}-scope`}
            name="scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className="h-7 shrink-0 cursor-pointer rounded-lg border border-border/70 bg-surface-muted/70 px-2 text-xs font-medium text-body outline-none transition-colors hover:border-border-strong focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring"
          >
            {scopes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {inline ? null : (
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={tx('Open the command palette')}
          title={tx('Search pages and actions')}
          className="hidden shrink-0 rounded-md border border-border/80 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground 2xl:block"
        >
          {modifier} K
        </button>
      )}
      <button
        type="submit"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={tx('Search')}
      >
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
    </form>
  );
}
