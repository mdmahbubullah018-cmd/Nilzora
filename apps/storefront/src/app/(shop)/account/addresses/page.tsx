import { MAX_ADDRESSES } from '@nilzora/contracts';
import { Alert, buttonClasses, Card, EmptyState, PageHeader } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import { MapPin, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AddressCard } from '@/components/addresses/address-card';
import type { CsrfField } from '@/components/auth/form-kit';
import { SuspendedState, UnavailableState } from '@/components/checkout/account-states';
import { AccountNav } from '@/components/account/account-nav';
import { PageFrame } from '@/components/checkout/page-parts';
import { readAccount } from '@/lib/account-read';
import { makeDefaultAddressAction } from '@/lib/address-actions';
import { singleParam, type SearchParams } from '@/lib/auth-params';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Addresses',
  robots: { index: false, follow: false },
};

/** Fixed confirmations after a change, chosen by known flags; query text is never shown. */
function noticeFrom(params: SearchParams): string | undefined {
  if (singleParam(params, 'saved') === '1') return 'Your address has been saved.';
  if (singleParam(params, 'deleted') === '1') return 'The address has been deleted.';
  if (singleParam(params, 'default') === '1') return 'Your default address has been updated.';
  return undefined;
}

function AddAddressLink() {
  return (
    <Link href="/account/addresses/new" className={buttonClasses()}>
      <Plus aria-hidden="true" />
      Add an address
    </Link>
  );
}

export default async function AddressesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const read = await readAccount((api, accessToken) => api.listAddresses(accessToken));
  if (read.kind === 'signed_out') redirect('/login?next=/account/addresses');

  const header = (
    <>
      <AccountNav current="/account/addresses" />
      <PageHeader
        title="Addresses"
        description="Where we deliver your orders. Your default address is selected first at checkout."
        actions={
          read.kind === 'ok' && read.value.addresses.length < MAX_ADDRESSES ? (
            <AddAddressLink />
          ) : undefined
        }
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
        <UnavailableState title="We could not load your addresses" retryHref="/account/addresses" />
      </PageFrame>
    );
  }

  const { addresses } = read.value;
  const csrf: CsrfField = { name: CSRF_FIELD, token: await session.csrfToken() };
  const notice = noticeFrom(params);
  return (
    <PageFrame>
      {header}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {addresses.length === 0 ? (
        <Card>
          <EmptyState
            icon={MapPin}
            title="No saved addresses yet"
            description="Add a delivery address and it will be ready at checkout."
            className="py-14"
            action={<AddAddressLink />}
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id}>
              <AddressCard
                address={address}
                csrf={csrf}
                makeDefaultAction={makeDefaultAddressAction}
              />
            </li>
          ))}
        </ul>
      )}
      {addresses.length >= MAX_ADDRESSES ? (
        <p className="text-sm text-muted-foreground">
          You can keep up to {MAX_ADDRESSES} addresses. Delete one to add another.
        </p>
      ) : null}
    </PageFrame>
  );
}
