'use client';

import {
  FAQ_CATEGORY_LABELS,
  FAQ_ENTRIES,
  groupFaq,
  searchFaq,
  type FaqCategory,
  type FaqEntry,
} from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { ChevronDown, Search, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';

/*
 * The FAQ: one search box, a row of topics, and the questions as native <details> accordions.
 * Native elements are used on purpose — each one is keyboard operable, announced correctly and
 * works with JavaScript off — and the wording comes from @nilzora/contracts, so the app answers
 * the same questions in the same words.
 */

const ALL = 'all' as const;
type CategoryFilter = FaqCategory | typeof ALL;

const chipClass =
  'min-h-10 rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring';
const chipIdle =
  'border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground';
const chipChosen = 'border-primary bg-primary/10 text-primary';

export function FaqExplorer({ entries = FAQ_ENTRIES }: { entries?: readonly FaqEntry[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>(ALL);
  const searchId = useId();
  const countId = useId();

  const found = useMemo(
    () =>
      searchFaq(query, entries).filter((entry) => category === ALL || entry.category === category),
    [query, category, entries],
  );
  const groups = useMemo(() => groupFaq(found), [found]);
  const typed = query.trim();
  const searching = typed !== '' || category !== ALL;
  // A search shows its answers; browsing keeps them folded until asked for.
  const openCases = typed !== '';

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label htmlFor={searchId} className="text-sm font-semibold text-foreground">
            Search the questions
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Delivery, refund, password…"
              autoComplete="off"
              aria-describedby={countId}
              className="h-11 w-full rounded-xl border border-input-border bg-surface pr-3 pl-10 text-sm text-foreground placeholder:text-muted-foreground hover:border-body focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setCategory(ALL);
            }}
            aria-pressed={category === ALL}
            className={cn(chipClass, category === ALL ? chipChosen : chipIdle)}
          >
            All topics
          </button>
          {(Object.keys(FAQ_CATEGORY_LABELS) as FaqCategory[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setCategory(category === key ? ALL : key);
              }}
              aria-pressed={category === key}
              className={cn(chipClass, category === key ? chipChosen : chipIdle)}
            >
              {FAQ_CATEGORY_LABELS[key]}
            </button>
          ))}
        </div>

        <p id={countId} role="status" className="text-xs text-muted-foreground tabular-nums">
          {found.length === 0
            ? 'No questions match'
            : `${String(found.length)} ${found.length === 1 ? 'question' : 'questions'}${
                searching ? ' match' : ''
              }`}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-xl border border-border bg-surface p-5">
          <SearchX aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-sm font-semibold wrap-break-word text-foreground">
            Nothing matches “{typed || FAQ_CATEGORY_LABELS[category as FaqCategory]}”
          </p>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Try one or two words, or choose another topic. If the answer is not here, the store can
            answer it directly.
          </p>
          <Link
            href="/contact"
            className="inline-flex min-h-9 items-center rounded-md text-sm font-semibold text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Ask the store through Help &amp; support
          </Link>
        </div>
      ) : (
        <div className="grid gap-8">
          {groups.map((group) => (
            <section
              key={group.category}
              aria-labelledby={`faq-${group.category}`}
              className="grid gap-3"
            >
              <h2
                id={`faq-${group.category}`}
                className="font-display text-lg font-semibold tracking-tight text-foreground"
              >
                {group.label}
              </h2>
              <div className="grid divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {group.entries.map((entry) => (
                  <details key={entry.id} id={`faq-${entry.id}`} open={openCases} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 wrap-break-word">{entry.question}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                      />
                    </summary>
                    <p className="max-w-[68ch] px-4 pb-4 text-sm leading-relaxed wrap-break-word text-body">
                      {entry.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
