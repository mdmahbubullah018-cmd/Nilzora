import type { PublicStoreProfile } from '../store-profile';
import type { InfoSection } from './info-pages';

/*
 * The contact block the information pages end with
 * ------------------------------------------------
 * A policy that says "contact us" without saying how is not useful, and a placeholder email
 * would be worse than none. The store's published profile is the only source: whatever the
 * owner has entered in the admin workspace is shown, in the same order, on the website and in
 * the app.
 *
 * Three states are kept apart, because they mean different things:
 *   null                        the profile could not be read — say so, do not guess
 *   published, with details     show exactly those details
 *   published, without details  say plainly that nothing has been published
 */

export interface StoreContactDetails {
  /** The support address the store published, else its general contact address. */
  email: string | null;
  phone: string | null;
  /** The postal address, one line, made of the parts the store filled in. */
  address: string | null;
}

const CONTACT_HEADING = 'Contacting Nilzora';

const ORDERS_ARE_THE_RECORD =
  'Help & support in your account opens a conversation with the store, and your order history and order pages remain the record of what you bought.';

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** What the store published, resolved the way the Contact page resolves it. */
export function storeContactDetails(profile: PublicStoreProfile): StoreContactDetails {
  const address = [profile.addressLine, profile.addressArea, profile.addressDistrict]
    .map((part) => text(part))
    .filter((part): part is string => part !== null)
    .join(', ');
  return {
    email: text(profile.supportEmail) ?? text(profile.contactEmail),
    phone: text(profile.supportPhone) ?? text(profile.contactPhone),
    address: address === '' ? null : address,
  };
}

/**
 * The closing section of the privacy policy and the terms: the store's own details when it has
 * published any, and otherwise an honest sentence plus the route that always exists (support).
 *
 * `null` means the profile could not be read — never that the store published nothing.
 */
export function storeContactSection(profile: PublicStoreProfile | null): InfoSection {
  if (profile === null) {
    return {
      heading: CONTACT_HEADING,
      paragraphs: [
        `The store’s contact details could not be read just now. ${ORDERS_ARE_THE_RECORD}`,
      ],
    };
  }

  const details = storeContactDetails(profile);
  const bullets: string[] = [];
  if (details.email !== null) bullets.push(`Email: ${details.email}`);
  if (details.phone !== null) bullets.push(`Phone: ${details.phone}`);
  if (details.address !== null) bullets.push(`Address: ${details.address}`);

  if (bullets.length === 0) {
    return {
      heading: CONTACT_HEADING,
      paragraphs: [`The store has not published contact details yet. ${ORDERS_ARE_THE_RECORD}`],
    };
  }

  return {
    heading: CONTACT_HEADING,
    paragraphs: [
      'These are the details the store publishes. Use them, or open Help & support in your account, to ask about this page, your account or an order.',
    ],
    bullets,
  };
}
