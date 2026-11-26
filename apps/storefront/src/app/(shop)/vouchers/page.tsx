import type { Voucher } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import { BadgePercent, Ticket } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { VoucherCard } from '@/components/vouchers/voucher-card';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Vouchers',
  description: 'Collect Nilzora vouchers and save at checkout.',
};

/** Filters a shopper can narrow the centre by; all of them are read from the voucher itself. */
const FILTERS = [
  { id: 'all', label: 'All vouchers' },
  { id: 'storewide', label: 'Storewide' },
  { id: 'categories', label: 'Categories' },
  { id: 'products', label: 'Products' },
  { id: 'collected', label: 'Collected' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

function filterOf(value: string | string[] | undefined): FilterId {
  const found = FILTERS.find((filter) => filter.id === value);
  return found ? found.id : 'all';
}

function applies(voucher: Voucher, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'collected') return voucher.state === 'collected';
  return voucher.scope === filter;
}

/**
 * The Voucher Center: every voucher the store offers right now (and those that ended in the
 * last 4 days, faded), with Collect and Use. Read on the server as the signed-in customer, so
 * each card already knows whether it was collected.
 */
export default async function VouchersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = filterOf((await searchParams).filter);
  const current = await session.getSession();
  const signedIn = current.status === 'signed_in';
  const read = signedIn
    ? await session.read((api, accessToken) => api.voucherCenter(accessToken))
    : await session
        .publicApi()
        .voucherCenter(null)
        .then((value) => ({ kind: 'ok' as const, value }))
        .catch(() => ({ kind: 'unavailable' as const }));
  const vouchers = read.kind === 'ok' ? read.value.vouchers : [];
  const shown = vouchers.filter((voucher) => applies(voucher, filter));
  const csrf = signedIn ? { name: CSRF_FIELD, token: await session.csrfToken() } : null;
  const collectable = vouchers.filter((voucher) => voucher.state === 'available').length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-primary/15 bg-linear-to-br from-primary/8 via-primary/4 to-surface px-6 py-7 sm:px-9 sm:py-9">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid max-w-xl gap-3">
            <p className="inline-flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary uppercase">
              <BadgePercent aria-hidden="true" className="size-4" /> Voucher Center
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Collect vouchers, save at checkout
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Collect a voucher, then choose it at checkout. One voucher or one coupon code per
              order.
            </p>
          </div>
          <div className="flex items-center gap-4 rounded-xl border border-primary/15 bg-surface px-5 py-4">
            <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
              <Ticket aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="font-display text-2xl font-semibold text-foreground tabular-nums">
                {collectable}
              </p>
              <p className="text-xs text-muted-foreground">ready to collect</p>
            </div>
          </div>
        </div>
      </section>

      <nav aria-label="Voucher filters" className="mt-6 -mx-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-2">
          {FILTERS.map((item) => (
            <li key={item.id}>
              <Link
                href={(item.id === 'all' ? '/vouchers' : `/vouchers?filter=${item.id}`) as Route}
                aria-current={filter === item.id ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors',
                  filter === item.id
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-surface text-foreground hover:border-primary hover:text-primary',
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6">
        {read.kind !== 'ok' ? (
          <p className="rounded-2xl bg-surface-muted px-5 py-4 text-sm text-muted-foreground">
            Vouchers could not be loaded just now. Reload the page to try again.
          </p>
        ) : shown.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-14 text-center">
            <Ticket aria-hidden="true" className="size-10 text-muted-foreground" />
            <p className="font-semibold text-foreground">
              {filter === 'collected'
                ? 'You have not collected any vouchers here yet'
                : 'No vouchers right now'}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              New vouchers appear here when the store launches them. Check back soon.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((voucher) => (
              <li key={voucher.id}>
                <VoucherCard
                  voucher={voucher}
                  csrf={csrf}
                  signedIn={signedIn}
                  returnTo="/vouchers"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {signedIn ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Collected vouchers are kept in{' '}
          <Link
            href="/account/vouchers"
            className="font-semibold text-link underline-offset-4 hover:underline"
          >
            My Vouchers
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
