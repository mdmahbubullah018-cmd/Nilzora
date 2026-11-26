import { returnDetailSchema } from '@nilzora/contracts';
import { buttonClasses, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import { Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import type { CsrfField } from '@/components/auth/form-kit';
import { ShipmentTrackingCard } from '@/components/orders/shipment-tracking';
import { CancelReturnForm } from '@/components/returns/cancel-return-form';
import { BackLink, PageFrame, SummaryList, SummaryRow } from '@/components/checkout/page-parts';
import { readAccount } from '@/lib/account-read';
import { formatLongDate, formatMoney } from '@/lib/format';
import { readOrderShipments } from '@/lib/order-shipments';
import { cancelReturnAction } from '@/lib/return-actions';
import { session } from '@/lib/session';
import { returnPickups } from '@/lib/shipment-view';
import { refundStatusLabel, returnStatusLabel } from '../page-labels';

export const metadata: Metadata = {
  title: 'Return details',
  robots: { index: false, follow: false },
};

const ACTOR_LABELS: Record<string, string> = {
  customer: 'You',
  staff: 'Nilzora',
  system: 'Nilzora',
};

export default async function ReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ returnId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { returnId } = await params;
  if (!returnDetailSchema.shape.id.safeParse(returnId).success) notFound();
  const query = await searchParams;
  const justRequested = query.requested === '1';
  const justCancelled = query.cancelled === '1';

  const read = await readAccount((api, accessToken) => api.myReturn(accessToken, returnId));
  if (read.kind === 'signed_out') redirect(`/login?next=/account/returns/${returnId}`);
  if (read.kind === 'not_found') notFound();

  const header = (
    <>
      <BackLink href="/account/returns">Your returns</BackLink>
      <PageHeader
        title="Return details"
        description="What you asked to send back, and where the request has got to."
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
        <UnavailableState
          title="We could not load this return"
          retryHref={`/account/returns/${returnId}` as Route}
        />
      </PageFrame>
    );
  }

  const request = read.value.return;
  const cancellable = request.status === 'requested';
  const csrf: CsrfField = { name: CSRF_FIELD, token: await session.csrfToken() };
  // A courier collects the items only after Nilzora approves the return.
  const pickupStage = ['approved', 'received', 'completed'].includes(request.status);
  const shipments = pickupStage ? await readOrderShipments(request.orderNumber) : null;
  const pickups = shipments === null ? [] : returnPickups(shipments, request.id);

  return (
    <PageFrame>
      {header}

      {justRequested ? (
        <Card>
          <CardContent>
            <p className="text-sm text-slate-700">
              Thank you. Nilzora will review your request and reply here. Keep the items until then.
            </p>
          </CardContent>
        </Card>
      ) : null}
      {justCancelled ? (
        <Card>
          <CardContent>
            <p className="text-sm text-slate-700">This return has been cancelled.</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Return for order {request.orderNumber}</CardTitle>
        </CardHeader>
        <CardContent>
          <SummaryList>
            <SummaryRow label="Where it is">{returnStatusLabel(request.status)}</SummaryRow>
            <SummaryRow label="Asked on">{formatLongDate(request.requestedAt)}</SummaryRow>
            <SummaryRow label="Reason you gave">{request.reason}</SummaryRow>
            {request.description === null ? null : (
              <SummaryRow label="In your words">{request.description}</SummaryRow>
            )}
            {request.decisionNote === null ? null : (
              <SummaryRow label="Note from Nilzora">{request.decisionNote}</SummaryRow>
            )}
            <SummaryRow label="Refundable for these items">
              {formatMoney(request.refundableMinor)}
            </SummaryRow>
          </SummaryList>
        </CardContent>
      </Card>

      <ShipmentTrackingCard title="Return pickup" shipments={pickups} />

      <Card>
        <CardHeader>
          <CardTitle as="h2">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3">
            {request.items.map((item) => (
              <li key={item.orderItemId} className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-slate-900">
                  {item.productName}
                  {item.variantLabel === null ? null : (
                    <span className="text-slate-500"> · {item.variantLabel}</span>
                  )}
                </span>
                <span className="text-slate-600">
                  {item.quantity}
                  {item.orderedQuantity === undefined ? null : ` of ${item.orderedQuantity}`} · SKU{' '}
                  {item.sku}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {request.refunds === undefined || request.refunds.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Refunds</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-slate-600">
              Nilzora pays Cash on Delivery refunds back by hand. A refund counts as paid only once
              its reference is recorded, so the date below is when that happened.
            </p>
            <ul className="grid gap-3">
              {request.refunds.map((refund) => (
                <li key={refund.id} className="grid gap-1 text-sm">
                  <span className="font-medium text-slate-900">
                    {formatMoney(refund.amountMinor)}
                  </span>
                  <span className="text-slate-600">
                    {refundStatusLabel(refund.status)} ·{' '}
                    {refund.method === 'cod_manual' ? 'cash paid back by hand' : refund.method}
                  </span>
                  <span className="text-slate-500">
                    Asked on {formatLongDate(refund.requestedAt)}
                    {refund.completedAt === null
                      ? ''
                      : ` · paid on ${formatLongDate(refund.completedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">What has happened</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm">
            {request.history.map((entry) => (
              <li key={`${entry.at}-${entry.toStatus}`} className="text-slate-700">
                <span className="font-medium">{ACTOR_LABELS[entry.actorKind] ?? 'Nilzora'}</span>{' '}
                {returnStatusLabel(entry.toStatus).toLowerCase()} · {formatLongDate(entry.at)}
                {entry.note === null ? '' : ` — ${entry.note}`}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/account/orders/${request.orderNumber}` as Route}
          className={buttonClasses({ variant: 'outline' })}
        >
          View the order
        </Link>
        {cancellable ? (
          <CancelReturnForm action={cancelReturnAction} csrf={csrf} returnId={request.id} />
        ) : null}
      </div>

      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Undo2 aria-hidden="true" className="size-4" />
        Nothing is refunded automatically. Nilzora contacts you before any money is handed back.
      </p>
    </PageFrame>
  );
}
