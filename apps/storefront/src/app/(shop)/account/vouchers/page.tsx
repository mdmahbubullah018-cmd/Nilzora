import type { Voucher } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { Ticket } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountNav } from '@/components/account/account-nav';
import { VoucherCard } from '@/components/vouchers/voucher-card';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'My Vouchers',
  robots: { index: false, follow: false },
};

const TABS = [
  { id: 'available', label: 'Available' },
  { id: 'used', label: 'Used' },
  { id: 'expired', label: 'Expired' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Which tab a collected voucher belongs to; "upcoming" ones wait under Available. */
function tabOf(voucher: Voucher): TabId {
  if (voucher.state === 'used') return 'used';
  if (voucher.state === 'expired') return 'expired';
  return 'available';
}

/**
 * The signed-in customer's collected vouchers. The API leaves out vouchers that ended more
 * than 4 days ago (the collection itself is kept); expired ones until then show faded.
 */
export default async function MyVouchersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await session.getSession();
  if (current.status !== 'signed_in') redirect('/login?next=/account/vouchers');

  const requested = (await searchParams).tab;
  const tab: TabId = TABS.find((item) => item.id === requested)?.id ?? 'available';
  const read = await session.read((api, accessToken) => api.myVouchers(accessToken));
  if (read.kind === 'signed_out') redirect('/login?next=/account/vouchers');
  const vouchers = read.kind === 'ok' ? read.value.vouchers : [];
  const counts = Object.fromEntries(
    TABS.map((item) => [item.id, vouchers.filter((voucher) => tabOf(voucher) === item.id).length]),
  ) as Record<TabId, number>;
  const shown = vouchers.filter((voucher) => tabOf(voucher) === tab);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <AccountNav current="/account/vouchers" />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            My Vouchers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a voucher at checkout. One voucher or one coupon code per order.
          </p>
        </div>
        <Link
          href="/vouchers"
          className="inline-flex min-h-10 items-center rounded-full bg-primary-action px-5 text-sm font-semibold text-primary-action-foreground transition-colors hover:bg-primary-action-hover"
        >
          Collect more vouchers
        </Link>
      </div>

      {/*
        Three statuses with their counts. On the narrowest phones the row is a scroll rail
        rather than three shrinking pills: the labels keep their size and the page never
        widens to fit them.
      */}
      <div
        role="tablist"
        aria-label="Voucher status"
        className="nz-tab-rail mt-6 flex min-w-0 gap-1 overflow-x-auto rounded-full bg-surface-muted p-1 sm:w-fit sm:overflow-visible"
      >
        {TABS.map((item) => (
          <Link
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            href={`/account/vouchers?tab=${item.id}` as Route}
            className={cn(
              'flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors sm:flex-1 sm:px-4',
              tab === item.id
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            <span className="rounded-full bg-background px-1.5 text-xs tabular-nums">
              {counts[item.id]}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        {read.kind !== 'ok' ? (
          <p className="rounded-2xl bg-surface-muted px-5 py-4 text-sm text-muted-foreground">
            Your vouchers could not be loaded just now. Reload the page to try again.
          </p>
        ) : shown.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-14 text-center">
            <Ticket aria-hidden="true" className="size-10 text-muted-foreground" />
            <p className="font-semibold text-foreground">
              {tab === 'available' ? 'No vouchers ready to use' : tab === 'used' ? 'No used vouchers' : 'No expired vouchers'}
            </p>
            {tab === 'available' ? (
              <Link href="/vouchers" className="text-sm font-semibold text-link underline-offset-4 hover:underline">
                Browse the Voucher Center
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {shown.map((voucher) => (
              <li key={voucher.id}>
                <VoucherCard voucher={voucher} csrf={null} signedIn returnTo="/account/vouchers" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
