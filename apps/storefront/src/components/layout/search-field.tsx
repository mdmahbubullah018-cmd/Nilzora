'use client';

import { cn } from '@nilzora/ui';
import { ArrowRight, Camera, Loader2, Search, X } from 'lucide-react';
import type { Route } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { listingHref, MAX_SEARCH_LENGTH, productHref } from '@/lib/catalog-query';
import { formatMoney } from '@/lib/format';
import { suggestionQuery, useSearchSuggestions } from './use-search-suggestions';

const fieldTone = {
  /** Glass over the home banner, then a soft grey field once the header turns solid. */
  header:
    'h-10 bg-white/12 text-white ring-white/30 placeholder:text-white/75 group-data-[solid=true]/header:bg-surface-muted group-data-[solid=true]/header:text-foreground group-data-[solid=true]/header:ring-border group-data-[solid=true]/header:placeholder:text-muted-foreground',
  /** On a white panel, such as the mobile menu. */
  panel: 'h-12 bg-surface-muted text-foreground ring-border placeholder:text-muted-foreground',
  /** The search page's own large field. */
  page: 'h-13 bg-surface text-base text-foreground shadow-xs ring-input-border placeholder:text-muted-foreground',
} as const;

const searchHref = (q: string): Route => listingHref('/search', { q }, 'relevance');

/**
 * The site search: a GET form to /search that works without JavaScript (next/form navigates
 * without a full reload when it can). As the visitor types, it suggests the first products the
 * real search finds, as an ARIA combobox: the arrow keys move through the suggestions, Enter
 * opens the highlighted one (or searches), Escape closes the list and then clears the text.
 * Each instance needs its own `id` so its label stays unique on the page.
 */
export function SearchField({
  id,
  variant = 'panel',
  defaultValue = '',
  className,
  visualSearch = true,
}: {
  id: string;
  variant?: keyof typeof fieldTone;
  /** Text to start with, e.g. the search on screen. */
  defaultValue?: string;
  className?: string;
  /** The camera button that opens image search (always on in the shop). */
  visualSearch?: boolean;
}) {
  const router = useRouter();
  const inputId = `${id}-input`;
  const listId = `${id}-suggestions`;
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = useSearchSuggestions(text);
  const query = suggestionQuery(text);

  const items = suggestions.status === 'ready' ? suggestions.items : [];
  // The products, then "see all results" — every row is a place to go.
  const targets: Route[] = [...items.map((item) => productHref(item.slug)), searchHref(query)];
  const expanded = open && query !== '';
  const highlighted = expanded && active >= 0 && active < targets.length ? active : -1;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const go = (href: Route) => {
    close();
    router.push(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (query === '') return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => {
        const from = expanded ? current : -1;
        const next = from + step;
        if (next < -1) return targets.length - 1;
        if (next >= targets.length) return -1;
        return next;
      });
      return;
    }
    if (event.key === 'Enter' && highlighted >= 0) {
      const target = targets[highlighted];
      if (target) {
        event.preventDefault();
        go(target);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault();
        close();
      } else if (text !== '') {
        event.preventDefault();
        setText('');
      }
    }
  };

  const announcement = !expanded
    ? ''
    : suggestions.status === 'ready'
      ? items.length === 0
        ? 'No matching products. Press Enter to search.'
        : `${items.length} ${items.length === 1 ? 'product' : 'products'} suggested. Use the arrow keys to choose.`
      : suggestions.status === 'error'
        ? 'Suggestions are not available. Press Enter to search.'
        : '';

  return (
    <Form
      action="/search"
      role="search"
      aria-label={variant === 'page' ? 'Refine your search' : 'Site search'}
      className={cn('relative', className)}
      onSubmit={close}
    >
      <label htmlFor={inputId} className="sr-only">
        Search products
      </label>
      <div className="relative w-full">
        {variant === 'page' ? (
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-muted-foreground"
          />
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          name="q"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${id}-option-${highlighted}` : undefined}
          aria-describedby={statusId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={close}
          onKeyDown={onKeyDown}
          maxLength={MAX_SEARCH_LENGTH}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={variant === 'page' ? 'What are you looking for?' : 'Search products'}
          className={cn(
            'w-full rounded-full pr-12 text-sm ring-1 transition-[background-color,color,box-shadow] duration-300 outline-none ring-inset focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-search-cancel-button]:hidden',
            variant === 'page' ? 'pl-11' : 'pl-4',
            visualSearch && (variant === 'page' ? 'pr-28' : 'pr-20'),
            fieldTone[variant],
          )}
        />
        {text !== '' && variant === 'page' ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setText('');
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-20 grid w-10 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        {visualSearch ? (
          <Link
            href="/search/image"
            aria-label="Search by photo"
            title="Search by photo"
            className={cn(
              // Always the brand blue: the camera is a destination, not a hint, so it keeps its
              // colour over the banner and on the frosted bar alike.
              'absolute inset-y-0 grid w-10 cursor-pointer place-items-center rounded-full text-primary transition-colors hover:text-primary-action',
              // A step in from the left of the trailing slot: the camera sits centred under the
              // thumb instead of hugging the edge of its action area.
              variant === 'page' ? 'right-10' : 'right-9',
            )}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Camera aria-hidden="true" className="size-4.5" strokeWidth={1.9} />
          </Link>
        ) : null}
        {/* The hit area is the field's full height; the circle is visual. */}
        <button
          type="submit"
          className="group/submit absolute inset-y-0 right-0 grid w-12 cursor-pointer place-items-center rounded-full"
        >
          <span className="grid size-8 place-items-center rounded-full bg-primary-action text-primary-action-foreground transition-colors group-hover/submit:bg-primary-action-hover">
            <Search aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </span>
          <span className="sr-only">Search</span>
        </button>
      </div>

      <p id={statusId} role="status" className="sr-only">
        {announcement}
      </p>

      {expanded ? (
        <div
          // Keeps focus in the field while a suggestion is pressed.
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            'absolute top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-xl shadow-brand-navy/10',
            variant === 'header' ? 'right-0 w-[min(28rem,calc(100vw-2rem))]' : 'inset-x-0',
          )}
        >
          {suggestions.status === 'loading' && items.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              Searching…
            </p>
          ) : null}
          {suggestions.status === 'error' ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {suggestions.reason === 'rate_limited'
                ? 'Searching too quickly. Pause for a moment, or press Enter to search.'
                : 'Suggestions are not available right now. Press Enter to search.'}
            </p>
          ) : null}
          {suggestions.status === 'ready' && items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No products match <q className="wrap-anywhere">{query}</q> yet.
            </p>
          ) : null}
          <ul id={listId} role="listbox" aria-label="Suggested products" className="grid">
            {items.map((item, index) => {
              const selected = index === highlighted;
              return (
                <li
                  key={item.slug}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => go(productHref(item.slug))}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors',
                    selected ? 'bg-surface-muted' : 'hover:bg-surface-muted',
                  )}
                >
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-surface-muted ring-1 ring-border ring-inset">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    ) : (
                      <Search
                        aria-hidden="true"
                        className="absolute inset-0 m-auto size-4 text-muted-foreground"
                      />
                    )}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.brandName ? `${item.brandName} · ` : ''}
                      {item.categoryName}
                      {item.soldOut ? ' · Sold out' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatMoney(item.priceMinor)}
                  </span>
                </li>
              );
            })}
            <li
              id={`${id}-option-${items.length}`}
              role="option"
              aria-selected={highlighted === items.length}
              onClick={() => go(searchHref(query))}
              onMouseEnter={() => setActive(items.length)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm font-semibold text-link transition-colors',
                highlighted === items.length ? 'bg-surface-muted' : 'hover:bg-surface-muted',
              )}
            >
              <span className="min-w-0 truncate">
                {suggestions.status === 'ready' && suggestions.total > items.length
                  ? `See all ${suggestions.total} results for “${query}”`
                  : `Search for “${query}”`}
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </li>
          </ul>
        </div>
      ) : null}
    </Form>
  );
}
