import { MAX_ADDRESSES } from '@nilzora/contracts';
import { Alert, Card, CardContent, PageHeader } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AddressForm } from '@/components/addresses/address-form';
import { EMPTY_ADDRESS } from '@/components/addresses/address-values';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { BackLink, PageFrame } from '@/components/checkout/page-parts';
import { readAccount } from '@/lib/account-read';
import { saveAddressAction } from '@/lib/address-actions';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { addressReturnPathFrom } from '@/lib/auth-routes';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Add an address',
  robots: { index: false, follow: false },
};

export default async function NewAddressPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Only checkout or the address book; any other `next` is ignored.
  const next = addressReturnPathFrom(singleParam(await searchParams, 'next'));
  const fromCheckout = next === '/checkout';

  const read = await readAccount((api, accessToken) => api.listAddresses(accessToken));
  if (read.kind === 'signed_out') {
    redirect(
      fromCheckout
        ? `/login?next=${encodeURIComponent('/account/addresses/new?next=/checkout')}`
        : '/login?next=/account/addresses/new',
    );
  }

  const header = (
    <>
      <BackLink href={next}>{fromCheckout ? 'Back to checkout' : 'Addresses'}</BackLink>
      <PageHeader
        title="Add an address"
        description="We deliver to every district of Bangladesh. The courier calls the number you give."
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
          title="We could not open the address form"
          retryHref={
            fromCheckout ? '/account/addresses/new?next=/checkout' : '/account/addresses/new'
          }
        />
      </PageFrame>
    );
  }

  const { addresses } = read.value;
  if (addresses.length >= MAX_ADDRESSES) {
    return (
      <PageFrame>
        {header}
        <Alert tone="warning" title="Your address book is full">
          You can keep up to {MAX_ADDRESSES} addresses. Delete one to add another.
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      {header}
      <Card className="max-w-2xl">
        <CardContent>
          <AddressForm
            action={saveAddressAction}
            csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
            next={next}
            initial={EMPTY_ADDRESS}
            defaultChoice={addresses.length === 0 ? 'first' : 'offer'}
            submitLabel={fromCheckout ? 'Save and use this address' : 'Save address'}
            cancelHref={next}
          />
        </CardContent>
      </Card>
    </PageFrame>
  );
}
