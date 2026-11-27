'use client';

import type { CouponRecipient } from '@nilzora/contracts';
import { Input } from '@nilzora/ui';
import { Search, UserRound, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { searchCouponCustomersAction } from '@/lib/coupon-actions';
import { formatBdPhone } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * Chooses the customers a coupon is meant for. The chosen customers travel as repeated
 * `customerIds` fields; the search runs through a Server Action (no API token in the
 * browser). The API and the database check again that every id is a customer account, so
 * nothing here is a security boundary.
 */

const MAX_RECIPIENTS = 500;

function label(customer: CouponRecipient): string {
  return customer.name ?? customer.email ?? 'Customer';
}

function contact(customer: CouponRecipient): string {
  return [customer.email, customer.phone ? formatBdPhone(customer.phone) : null]
    .filter(Boolean)
    .join(' · ');
}

export function CustomerPicker({
  selected,
  csrf,
  canSearch,
  error,
}: {
  selected: readonly CouponRecipient[];
  csrf: CsrfInput;
  /** customers.read: without it the current recipients are listed but cannot be changed. */
  canSearch: boolean;
  error?: string | undefined;
}) {
  const tx = useTx();
  const [chosen, setChosen] = useState<readonly CouponRecipient[]>(selected);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<readonly CouponRecipient[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const latest = useRef(0);
  const listId = useId();

  const text = query.trim();
  // Too little to search for: nothing is listed, whatever an earlier search found.
  const searching = canSearch && text.length >= 2;

  useEffect(() => {
    if (!searching) {
      // A late answer to an earlier search must not appear after the box was cleared.
      latest.current += 1;
      return;
    }
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setStatus('searching');
      const body = new FormData();
      body.set(csrf.name, csrf.token);
      body.set('q', text);
      searchCouponCustomersAction(body).then(
        (answer) => {
          if (ticket !== latest.current) return;
          if (answer.ok) {
            setMatches(answer.customers);
            setStatus('idle');
            setMessage(null);
          } else {
            setMatches([]);
            setStatus('failed');
            setMessage(answer.message);
          }
        },
        () => {
          if (ticket !== latest.current) return;
          setStatus('failed');
          setMessage('Customers could not be searched. Check your connection and try again.');
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [text, searching, csrf.name, csrf.token]);

  const chosenIds = new Set(chosen.map((customer) => customer.id));
  const candidates = searching ? matches.filter((customer) => !chosenIds.has(customer.id)) : [];

  return (
    <div className="grid gap-3">
      {chosen.map((customer) => (
        <input key={customer.id} type="hidden" name="customerIds" value={customer.id} />
      ))}

      <p className="text-xs text-muted-foreground">
        Only these customers can see, collect or use this coupon. Anyone else is refused by the
        server, whatever code they type.
      </p>

      {canSearch ? (
        <div className="grid gap-2">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label={tx('Search customers by name, email or phone')}
              aria-controls={listId}
              placeholder={tx('Search by name, email or phone')}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                // Enter must not submit the whole coupon form while the admin is searching.
                if (event.key === 'Enter') event.preventDefault();
              }}
              className="pl-9 max-sm:h-11"
            />
          </div>
          <div id={listId} aria-live="polite">
            {!searching ? null : status === 'searching' ? (
              <p className="text-sm text-muted-foreground">
                <AutoText>Searching…</AutoText>
              </p>
            ) : status === 'failed' ? (
              <p className="text-sm text-danger-ink">
                <AutoText value={message} />
              </p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {matches.length > 0
                  ? 'Every match is already chosen.'
                  : 'No active customer matches that search.'}
              </p>
            ) : candidates.length > 0 ? (
              <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-xl border border-border bg-surface-muted/40 p-1.5">
                {candidates.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (chosen.length >= MAX_RECIPIENTS) return;
                        setChosen([...chosen, customer]);
                      }}
                      disabled={chosen.length >= MAX_RECIPIENTS}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                    >
                      <UserRound
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="grid min-w-0">
                        <span className="truncate font-medium text-foreground">
                          <AutoText value={label(customer)} />
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          <AutoText value={contact(customer)} />
                        </span>
                      </span>
                      <span className="ml-auto text-xs font-semibold text-link">
                        <AutoText>Add</AutoText>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-hairline bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          Searching for customers needs the “View customers” permission. You can still remove the
          customers listed below.
        </p>
      )}

      <div className="grid gap-1.5">
        <p className="text-sm font-medium text-foreground">
          {chosen.length === 0
            ? 'No customers chosen yet.'
            : `${String(chosen.length)} ${chosen.length === 1 ? 'customer' : 'customers'} chosen`}
        </p>
        {chosen.length > 0 ? (
          <ul className="grid max-h-60 gap-1 overflow-y-auto">
            {chosen.map((customer) => (
              <li
                key={customer.id}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-surface px-3 py-1.5"
              >
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium text-foreground">
                    <AutoText value={label(customer)} />
                  </span>
                  {contact(customer) ? (
                    <span className="truncate text-xs text-muted-foreground">
                      <AutoText value={contact(customer)} />
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setChosen(chosen.filter((entry) => entry.id !== customer.id));
                  }}
                  aria-label={`Remove ${label(customer)}`}
                  className="ml-auto grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary sm:size-9"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="text-sm text-danger-ink">
            <AutoText value={error} />
          </p>
        ) : null}
      </div>
    </div>
  );
}
