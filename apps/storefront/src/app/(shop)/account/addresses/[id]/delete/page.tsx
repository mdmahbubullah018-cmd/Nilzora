import { addressSchema } from '@nilzora/contracts';
import { Badge, Card, CardContent, PageHeader } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { DeleteAddressForm } from '@/components/addresses/address-actions-forms';
import { AddressBlock, addressSummary } from '@/components/addresses/address-block';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { BackLink, PageFrame } from '@/components/checkout/page-parts';
import { readAccount } from '@/lib/account-read';
import { deleteAddressAction } from '@/lib/address-actions';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Delete address',
  robots: { index: false, follow: false },
};

/**
 * The confirmation step before deleting an address: a page of its own, so it works
 * the same with or without JavaScript. Orders keep their own copy of the address.
 */
export default async function DeleteAddressPage({ params }: { params: Promise<{ id: string }> }) {
  const id = addressSchema.shape.id.safeParse((await params).id);
  if (!id.success) notFound();

  const read = await readAccount((api, accessToken) => api.listAddresses(accessToken));
  if (read.kind === 'signed_out') redirect('/login?next=/account/addresses');

  const header = (
    <>
      <BackLink href="/account/addresses">Addresses</BackLink>
      <PageHeader title="Delete this address?" />
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
          title="We could not load this address"
          retryHref={`/account/addresses/${id.data}/delete`}
        />
      </PageFrame>
    );
  }

  const { addresses } = read.value;
  const address = addresses.find((candidate) => candidate.id === id.data);
  if (!address) notFound();

  return (
    <PageFrame>
      {header}
      <Card className="max-w-2xl">
        <CardContent className="grid gap-5">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold wrap-break-word text-foreground">
                {address.label ?? address.recipientName}
              </h2>
              {address.isDefault ? <Badge tone="primary">Default</Badge> : null}
            </div>
            <AddressBlock address={address} />
          </div>
          <p className="text-sm text-body">
            The address is removed from your address book. Orders you have already placed keep their
            delivery details.
            {address.isDefault && addresses.length > 1
              ? ' One of your other addresses becomes the default.'
              : ''}
          </p>
          <DeleteAddressForm
            action={deleteAddressAction}
            csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
            addressId={address.id}
            addressName={addressSummary(address)}
            cancelHref="/account/addresses"
          />
        </CardContent>
      </Card>
    </PageFrame>
  );
}
