import type { Address } from '@nilzora/contracts';
import { Badge, buttonClasses, Card, CardContent } from '@nilzora/ui';
import { Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { CsrfField, FormAction } from '../auth/form-kit';
import { DELIVERY_ZONE_LABELS } from '../orders/order-status';
import { MakeDefaultForm } from './address-actions-forms';
import { AddressBlock, addressSummary } from './address-block';

/** One saved address in the address book, with its edit, delete and default controls. */
export function AddressCard({
  address,
  csrf,
  makeDefaultAction,
}: {
  address: Address;
  csrf: CsrfField;
  makeDefaultAction: FormAction;
}) {
  const name = addressSummary(address);
  return (
    <Card className="h-full">
      <CardContent className="grid h-full content-start gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold wrap-break-word text-foreground">
            {address.label ?? address.recipientName}
          </h2>
          {address.isDefault ? <Badge tone="primary">Default</Badge> : null}
        </div>
        <AddressBlock address={address} />
        <p className="text-xs text-muted-foreground">
          Delivery zone: {DELIVERY_ZONE_LABELS[address.deliveryZone]}
        </p>
        <div className="flex flex-wrap items-start gap-2 border-t border-border pt-4">
          <Link
            href={`/account/addresses/${address.id}/edit`}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            <Pencil aria-hidden="true" />
            Edit<span className="sr-only">: {name}</span>
          </Link>
          <Link
            href={`/account/addresses/${address.id}/delete`}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            <Trash2 aria-hidden="true" />
            Delete<span className="sr-only">: {name}</span>
          </Link>
          {address.isDefault ? null : (
            <MakeDefaultForm
              action={makeDefaultAction}
              csrf={csrf}
              addressId={address.id}
              addressName={name}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
