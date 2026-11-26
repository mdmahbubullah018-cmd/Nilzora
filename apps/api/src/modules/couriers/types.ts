import type {
  CourierCapabilities,
  CourierProviderId,
  ShipmentKind,
  ShipmentStatus,
} from '@nilzora/contracts';

/*
 * What every courier adapter offers. Results never throw for an expected answer: each one
 * says which of four things happened, because the booking workflow must tell them apart.
 *
 *  - ok: the courier answered and accepted.
 *  - refused: the courier answered "no" (a validation error, an unknown consignment).
 *    Nothing was created, so a booking becomes `failed`.
 *  - uncertain: no clear answer (a timeout, a dropped connection, a 5xx, an unreadable
 *    body). The courier may have acted, so a booking becomes `uncertain` and is NEVER
 *    retried automatically: staff check the courier's portal and resolve it.
 *  - awaiting_documentation / unsupported: the adapter did not call anything.
 *
 * Messages are fixed, safe text: never a credential, a recipient's details or raw
 * provider output.
 */

export type ProviderFailure =
  | { kind: 'refused'; message: string }
  | { kind: 'uncertain'; message: string }
  | { kind: 'awaiting_documentation'; message: string }
  | { kind: 'unsupported'; message: string };

export type ProviderResult<T> = { kind: 'ok'; value: T } | ProviderFailure;

export interface QuoteRequest {
  weightGrams: number;
  zone: 'inside_dhaka' | 'outside_dhaka';
  codAmountMinor: number;
}

export interface ProviderQuote {
  kind: 'live' | 'provider_estimate';
  deliveryChargeMinor: number;
  codFeeMinor: number | null;
  returnChargeMinor: number | null;
  details: Record<string, string | number>;
}

/** Everything a courier needs to deliver one parcel. Holds personal data: never log it. */
export interface BookingRequest {
  shipmentId: string;
  merchantRef: string;
  kind: ShipmentKind;
  codAmountMinor: number;
  weightGrams: number;
  deliveryZone: 'inside_dhaka' | 'outside_dhaka';
  destination: Record<string, unknown>;
  note: string | null;
  itemCount: number;
  recipient: {
    name: string;
    phone: string;
    addressLine: string;
    area: string;
    district: string;
    division: string;
    postalCode: string | null;
    landmark: string | null;
  };
  providerSettings: Record<string, unknown>;
}

export interface BookedParcel {
  consignmentId: string;
  trackingCode: string | null;
  /** https only (the database refuses anything else); null when the courier gives none. */
  trackingUrl: string | null;
  providerStatus: string | null;
  chargeMinor: number | null;
}

export interface TrackRequest {
  consignmentId: string;
  trackingCode: string | null;
  merchantRef: string;
}

export interface TrackedEvent {
  status: ShipmentStatus;
  providerStatus: string;
  /** ISO timestamp the courier gives for the status (stable across polls). */
  occurredAt: string;
}

export interface CancelRequest {
  consignmentId: string;
  merchantRef: string;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: 'missing_signature' | 'bad_signature' | 'stale' | 'not_configured' };

/**
 * A verified webhook reduced to the fields the processor needs. `payload` is an
 * allow-list (event id, provider status, time): names, phones and addresses never get in.
 */
export interface ParsedWebhook {
  eventId: string | null;
  eventType: string | null;
  consignmentId: string | null;
  merchantRef: string | null;
  providerStatus: string;
  occurredAt: string | null;
  payload: Record<string, string | null>;
}

export type HeaderReader = (name: string) => string | undefined;

/**
 * What a live adapter is given for one call: the courier's credentials (from Vault, or the
 * environment per field as a fallback), its base URL (allow-listed) and the request timeout
 * from the operations settings. Holds secrets: never log it. The mock ignores it.
 */
export interface AdapterContext {
  credentials: Readonly<Record<string, string>>;
  baseUrl: string | undefined;
  timeoutMs: number;
}

export interface CourierProvider {
  readonly id: CourierProviderId;
  readonly displayName: string;
  /** Mock adapters create test data (shipments flagged is_mock). */
  readonly isMock: boolean;
  /**
   * Whether this adapter's calls are implemented against VERIFIED courier documentation.
   * False for both real adapters today (they call nothing); the local mock answers only for
   * itself, so it reports true. A real courier can be verified for live use only when this
   * is true.
   */
  readonly verified: boolean;
  /** Why real calls are blocked, when they are. */
  readonly blockedReason: string | null;
  capabilities(): CourierCapabilities;
  quote(request: QuoteRequest, context?: AdapterContext): Promise<ProviderResult<ProviderQuote>>;
  book(request: BookingRequest, context?: AdapterContext): Promise<ProviderResult<BookedParcel>>;
  /** Every status reached so far, oldest first. */
  track(request: TrackRequest, context?: AdapterContext): Promise<ProviderResult<TrackedEvent[]>>;
  cancel(
    request: CancelRequest,
    context?: AdapterContext,
  ): Promise<ProviderResult<{ providerStatus: string | null }>>;
  checkConnection(context?: AdapterContext): Promise<ProviderResult<{ message: string }>>;
  verifyWebhook(header: HeaderReader, rawBody: Buffer, nowMs: number): WebhookVerification;
  /** Null when the body is not a webhook this adapter understands. */
  parseWebhook(rawBody: Buffer): ParsedWebhook | null;
  /** The shipment status a provider status means (`unknown` when it is not known). */
  mapStatus(providerStatus: string): ShipmentStatus;
}
