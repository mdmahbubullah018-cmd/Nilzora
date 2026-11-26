import { addressSchema } from '@nilzora/contracts';
import { Card, CardContent, PageHeader } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AddressForm } from '@/components/addresses/address-form';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { BackLink, PageFrame } from '@/components/checkout/page-parts';
import { readAccount } from '@/lib/account-read';
import { saveAddressAction } from '@/lib/address-actions';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { addressReturnPathFrom } from '@/lib/auth-routes';
import { formatBdPhone } from '@/lib/format';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Edit address',
  robots: { index: false, follow: false },
};

export default async function EditAddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const id = addressSchema.shape.id.safeParse((await params).id);
  if (!id.success) notFound();
  const next = addressReturnPathFrom(singleParam(await searchParams, 'next'));
  const fromCheckout = next === '/checkout';
  // This page again, still leading back to checkout when it came from there.
  const self = fromCheckout
    ? (`/account/addresses/${id.data}/edit?next=/checkout` as const)
    : (`/account/addresses/${id.data}/edit` as const);

  const read = await readAccount((api, accessToken) => api.listAddresses(accessToken));
  if (read.kind === 'signed_out') redirect(`/login?next=${encodeURIComponent(self)}`);

  const header = (
    <>
      <BackLink href={next}>{fromCheckout ? 'Back to checkout' : 'Addresses'}</BackLink>
      <PageHeader title="Edit address" />
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
        <UnavailableState title="We could not load this address" retryHref={self} />
      </PageFrame>
    );
  }

  // Only the customer's own addresses are listed, so anyone else's id is not found.
  const address = read.value.addresses.find((candidate) => candidate.id === id.data);
  if (!address) notFound();

  return (
    <PageFrame>
      {header}
      <Card className="max-w-2xl">
        <CardContent>
          <AddressForm
            action={saveAddressAction}
            csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
            addressId={address.id}
            next={next}
            initial={{
              label: address.label ?? '',
              recipientName: address.recipientName,
              phone: formatBdPhone(address.phone),
              division: address.division,
              district: address.district,
              area: address.area,
              addressLine: address.addressLine,
              postalCode: address.postalCode ?? '',
              landmark: address.landmark ?? '',
            }}
            defaultChoice={address.isDefault ? 'current' : 'offer'}
            submitLabel="Save changes"
            cancelHref={next}
          />
        </CardContent>
      </Card>
    </PageFrame>
  );
}
