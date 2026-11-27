import { orderNumberSchema } from '@nilzora/contracts';
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { ReturnRequestForm } from '@/components/returns/return-request-form';
import type { CsrfField } from '@/components/auth/form-kit';
import { BackLink, PageFrame } from '@/components/checkout/page-parts';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { readAccount } from '@/lib/account-read';
import { requestReturnAction } from '@/lib/return-actions';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Send something back',
  robots: { index: false, follow: false },
};

/**
 * The return form for one order. Eligibility is decided by the API when the request is
 * sent, so this page never promises an outcome; it only asks what is coming back and why,
 * and shows the API's own refusal when the order does not qualify.
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const orderNumber = orderNumberSchema.safeParse(singleParam(await searchParams, 'order') ?? '');
  if (!orderNumber.success) notFound();

  const read = await readAccount((api, accessToken) => api.getOrder(accessToken, orderNumber.data));
  if (read.kind === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(`/account/returns/new?order=${orderNumber.data}`)}`);
  }
  if (read.kind === 'not_found') notFound();

  const header = (
    <>
      <BackLink href="/account/orders">Your orders</BackLink>
      <PageHeader
        title="Send something back"
        description="Tell us what is coming back and why. Nilzora reviews the request before anything is returned."
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
          title="We could not load this order"
          retryHref={`/account/orders/${orderNumber.data}` as Route}
        />
      </PageFrame>
    );
  }

  const { order } = read.value;
  const csrf: CsrfField = { name: CSRF_FIELD, token: await session.csrfToken() };

  return (
    <PageFrame>
      {header}
      <Card>
        <CardHeader>
          <CardTitle as="h2">Order {order.orderNumber}</CardTitle>
        </CardHeader>
        <CardContent>
          <ReturnRequestForm
            action={requestReturnAction}
            csrf={csrf}
            orderNumber={order.orderNumber}
            items={order.items}
          />
        </CardContent>
      </Card>
    </PageFrame>
  );
}
