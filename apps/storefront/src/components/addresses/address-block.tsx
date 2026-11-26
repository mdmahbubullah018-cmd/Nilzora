import type { Address } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { formatBdPhone } from '@/lib/format';

/** The postal parts shared by saved addresses and the copy kept on each order. */
export type PostalAddress = Pick<
  Address,
  | 'recipientName'
  | 'phone'
  | 'division'
  | 'district'
  | 'area'
  | 'addressLine'
  | 'postalCode'
  | 'landmark'
>;

/** The address as written on a parcel, one line per entry (without name and phone). */
export function addressLines(address: PostalAddress): string[] {
  const lines = [address.addressLine];
  if (address.landmark) lines.push(`Near ${address.landmark}`);
  lines.push(
    `${address.area}, ${address.district}${address.postalCode ? ` ${address.postalCode}` : ''}`,
  );
  lines.push(`${address.division} Division`);
  return lines;
}

/** A short reference for choosing between addresses, e.g. "Home · Dhanmondi, Dhaka". */
export function addressSummary(address: Pick<Address, 'label' | 'area' | 'district'>): string {
  const place = `${address.area}, ${address.district}`;
  return address.label ? `${address.label} · ${place}` : place;
}

export function AddressBlock({
  address,
  className,
}: {
  address: PostalAddress;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-0.5 text-sm leading-relaxed text-body', className)}>
      <p className="font-semibold wrap-break-word text-foreground">{address.recipientName}</p>
      {addressLines(address).map((line, index) => (
        // Lines can repeat each other's text; their order never changes, so position is the key.
        <p key={index} className="wrap-break-word">
          {line}
        </p>
      ))}
      <p>
        <span className="sr-only">Phone: </span>
        {formatBdPhone(address.phone)}
      </p>
    </div>
  );
}
