import type { Address, DeliveryZone } from '@nilzora/contracts';

/*
 * How a saved address is written on screen. Same wording as the storefront, so a customer
 * sees the same address on the website and in the app.
 */

export const DELIVERY_ZONE_LABELS: Readonly<Record<DeliveryZone, string>> = {
  inside_dhaka: 'Inside Dhaka',
  outside_dhaka: 'Outside Dhaka',
};

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

/**
 * "+8801712345678" as it is written locally: "01712-345678". Anything that is not a
 * normalised Bangladeshi mobile number is returned unchanged.
 */
export function formatBdPhone(value: string): string {
  const match = /^\+880(1\d{3})(\d{6})$/.exec(value);
  if (!match?.[1] || !match[2]) return value;
  return `0${match[1]}-${match[2]}`;
}

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

/** The address's heading: its label when it has one, otherwise the recipient. */
export function addressTitle(address: Pick<Address, 'label' | 'recipientName'>): string {
  return address.label ?? address.recipientName;
}

/** Default address first, otherwise the server's order. */
export function sortAddresses(addresses: readonly Address[]): Address[] {
  return [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
