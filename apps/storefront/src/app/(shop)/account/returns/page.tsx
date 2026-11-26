import { buttonClasses, Card, EmptyState, PageHeader } from '@nilzora/ui';
import { Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { AccountNav } from '@/components/account/account-nav';
import { PageFrame } from '@/components/checkout/page-parts';
import { readAccount } from '@/lib/account-read';
import { formatLongDate, formatMoney } from '@/lib/format';
import { returnStatusLabel } from './page-labels';

export const metadata: Metadata = {
  title: 'Your returns',
  robots: { index: false, follow: false },
};

export default async function ReturnsPage() {
  const read = await readAccount((api, accessToken) => api.myReturns(accessToken));
  if (read.kind === 'signed_out') redirect('/login?next=/account/returns');

  const header = (
    <>
      <AccountNav current="/account/returns" />
      <PageHeader
        title="Your returns"
        description="Items you asked to send back, and where each request has got to."
      />
    </>
  );
  if (read.kind === 'suspended') {
    return (
      <PageFrame>
        {header}
        <SuspendedState />
      </PageFrame>
    );
  }
  if (read.kind !== 'ok') {
    return (
      <PageFrame>
        {header}
        <UnavailableState title="We could not load your returns" retryHref="/account/returns" />
      </PageFrame>
    );
  }

  const { returns } = read.value;
  if (returns.length === 0) {
    return (
      <PageFrame>
        {header}
        <Card>
          <EmptyState
            icon={Undo2}
            title="No returns yet"
            description="Open a delivered order to ask to send an item back."
            className="py-14"
            action={
              <Link href="/account/orders" className={buttonClasses()}>
                Go to your orders
              </Link>
            }
          />
        </Card>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      {header}
      <div className="grid gap-3">
        {returns.map((request) => (
          <Card key={request.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="grid gap-1">
                <Link
                  href={`/account/returns/${request.id}` as Route}
                  className="font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  Return for order {request.orderNumber}
                </Link>
                <p className="text-sm text-slate-600">{returnStatusLabel(request.status)}</p>
                <p className="text-sm text-slate-500">
                  {request.itemCount === 1 ? '1 item' : `${request.itemCount} items`} · asked on{' '}
                  {formatLongDate(request.requestedAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">Refundable for these items</p>
                <p className="font-medium text-slate-900">{formatMoney(request.refundableMinor)}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageFrame>
  );
}
