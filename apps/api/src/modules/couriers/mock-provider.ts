import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CourierCapabilities, CourierProviderId, ShipmentStatus } from '@nilzora/contracts';
import { z } from 'zod';
import type {
  BookedParcel,
  CourierProvider,
  HeaderReader,
  ParsedWebhook,
  ProviderResult,
  ProviderQuote,
  TrackedEvent,
  WebhookVerification,
} from './types';

/*
 * The local mock courier (COURIER_MODE=mock). It makes no network call and everything it
 * answers is derived from its input, so the same booking always looks the same:
 *
 *  - Quotes: a fixed table by zone and weight (never a real price; flagged isMock).
 *  - Bookings: the consignment id is `MK-<hash of courier and merchant ref>-<booking time>`
 *    and the tracking code `MKT<hash>`. A shipment note containing `[mock:reject]` makes
 *    the mock refuse (a `failed` booking); `[mock:timeout]` makes it not answer (an
 *    `uncertain` booking, never retried).
 *  - Tracking: the parcel moves along MOCK_TIMELINE by the minutes elapsed since the booking
 *    time carried in the consignment id. Each status has a fixed time, so a repeated poll
 *    produces the same events (and the database ignores the repeats).
 *  - Webhooks: signed with HMAC-SHA256 over `${timestamp}.${rawBody}` using
 *    COURIER_MOCK_WEBHOOK_SECRET, sent as
 *        X-Nilzora-Mock-Timestamp: <unix seconds>
 *        X-Nilzora-Mock-Signature: <hex digest>   (an optional `sha256=` prefix is accepted)
 *    and accepted within five minutes of the timestamp (replay protection).
 */

export const MOCK_TIMESTAMP_HEADER = 'x-nilzora-mock-timestamp';
export const MOCK_SIGNATURE_HEADER = 'x-nilzora-mock-signature';
/** How far a webhook timestamp may be from now, either way. */
export const MOCK_WEBHOOK_TOLERANCE_SECONDS = 300;

export const MOCK_REJECT_MARKER = '[mock:reject]';
export const MOCK_TIMEOUT_MARKER = '[mock:timeout]';

/** Minutes after booking at which the mock parcel reaches each status. */
export const MOCK_TIMELINE: readonly { minutes: number; providerStatus: string }[] = [
  { minutes: 5, providerStatus: 'pending_pickup' },
  { minutes: 15, providerStatus: 'picked' },
  { minutes: 30, providerStatus: 'in_transit' },
  { minutes: 60, providerStatus: 'out_for_delivery' },
  { minutes: 90, providerStatus: 'delivered' },
];

/** The mock courier's own status words and what each one means. */
export const MOCK_STATUS_MAP: Readonly<Record<string, ShipmentStatus>> = {
  pending_pickup: 'pickup_pending',
  picked: 'picked_up',
  in_transit: 'in_transit',
  hold: 'on_hold',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  partial_delivered: 'partially_delivered',
  delivery_failed: 'delivery_failed',
  returning: 'return_initiated',
  returned: 'returned',
  cancelled: 'cancelled',
};

/** Per-courier price table of the mock, in poisha. Test data, never a real price. */
const MOCK_PRICES: Readonly<
  Record<CourierProviderId, { inside: number; outside: number; perExtraHalfKg: number }>
> = {
  steadfast: { inside: 6_000, outside: 11_000, perExtraHalfKg: 1_500 },
  pathao: { inside: 6_500, outside: 10_500, perExtraHalfKg: 1_300 },
};
/** 1% of the cash collected. */
const MOCK_COD_FEE_BP = 100;

const MOCK_CAPABILITIES = (webhooks: boolean): CourierCapabilities => ({
  quote: 'available',
  book: 'available',
  track: 'available',
  cancel: 'available',
  webhook: webhooks ? 'available' : 'unsupported',
  returnPickup: 'available',
  locations: 'unsupported',
});

const CONSIGNMENT = /^MK-([0-9A-F]{10})-([0-9A-Z]{1,12})$/;

/** Whether a consignment id has the mock's own format (only the mock creates them). */
export function isMockConsignment(consignmentId: string): boolean {
  return CONSIGNMENT.test(consignmentId);
}

const webhookBodySchema = z.object({
  eventId: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,100}$/)
    .optional(),
  consignmentId: z.string().min(1).max(80).optional(),
  merchantRef: z
    .string()
    .regex(/^[A-Z0-9-]{3,40}$/)
    .optional(),
  status: z.string().regex(/^[a-z_]{1,40}$/),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

/** A mock status word as a shipment status; anything unknown (or inherited) is `unknown`. */
export function mockStatus(providerStatus: string): ShipmentStatus {
  return Object.hasOwn(MOCK_STATUS_MAP, providerStatus)
    ? (MOCK_STATUS_MAP[providerStatus] ?? 'unknown')
    : 'unknown';
}

function hash10(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10).toUpperCase();
}

/** Constant-time comparison of two hex strings (false when the lengths differ). */
function sameDigest(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The signature the mock expects (exported for tests and local tooling). */
export function signMockWebhook(
  secret: string,
  timestamp: string,
  rawBody: string | Buffer,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export interface MockProviderOptions {
  id: CourierProviderId;
  displayName: string;
  /** Unset: mock webhooks are not accepted. */
  webhookSecret: string | undefined;
  now?: () => number;
}

export function createMockProvider(options: MockProviderOptions): CourierProvider {
  const { id, displayName, webhookSecret } = options;
  const now = options.now ?? Date.now;
  const prices = MOCK_PRICES[id];

  function deliveryCharge(zone: 'inside_dhaka' | 'outside_dhaka', grams: number): number {
    const base = zone === 'inside_dhaka' ? prices.inside : prices.outside;
    const extraHalfKgs = Math.max(0, Math.ceil((grams - 1_000) / 500));
    return base + extraHalfKgs * prices.perExtraHalfKg;
  }

  return {
    id,
    displayName,
    isMock: true,
    // The mock answers only for itself: nothing about a real courier is assumed.
    verified: true,
    blockedReason: null,
    capabilities: () => MOCK_CAPABILITIES(webhookSecret !== undefined),

    quote(request): Promise<ProviderResult<ProviderQuote>> {
      const delivery = deliveryCharge(request.zone, request.weightGrams);
      return Promise.resolve({
        kind: 'ok',
        value: {
          kind: 'live',
          deliveryChargeMinor: delivery,
          codFeeMinor: Math.ceil((request.codAmountMinor * MOCK_COD_FEE_BP) / 10_000),
          returnChargeMinor: Math.ceil(delivery / 2),
          details: { source: 'mock' },
        },
      });
    },

    book(request): Promise<ProviderResult<BookedParcel>> {
      const note = request.note ?? '';
      if (note.includes(MOCK_REJECT_MARKER)) {
        return Promise.resolve({
          kind: 'refused',
          message: 'The mock courier refused the booking (test scenario)',
        });
      }
      if (note.includes(MOCK_TIMEOUT_MARKER)) {
        return Promise.resolve({
          kind: 'uncertain',
          message: 'The mock courier did not answer in time (test scenario)',
        });
      }
      const digest = hash10(`${id}:${request.merchantRef}`);
      const bookedAt = Math.floor(now() / 1000)
        .toString(36)
        .toUpperCase();
      return Promise.resolve({
        kind: 'ok',
        value: {
          consignmentId: `MK-${digest}-${bookedAt}`,
          trackingCode: `MKT${digest}`,
          trackingUrl: null,
          providerStatus: 'booked',
          chargeMinor: deliveryCharge(request.deliveryZone, request.weightGrams),
        },
      });
    },

    track(request): Promise<ProviderResult<TrackedEvent[]>> {
      const match = CONSIGNMENT.exec(request.consignmentId);
      const seconds = match?.[2] === undefined ? Number.NaN : parseInt(match[2], 36);
      if (!Number.isFinite(seconds)) {
        return Promise.resolve({
          kind: 'refused',
          message: 'The mock courier does not know this consignment',
        });
      }
      const bookedMs = seconds * 1000;
      const elapsedMinutes = (now() - bookedMs) / 60_000;
      const events = MOCK_TIMELINE.filter((step) => step.minutes <= elapsedMinutes).map((step) => ({
        status: mockStatus(step.providerStatus),
        providerStatus: step.providerStatus,
        occurredAt: new Date(bookedMs + step.minutes * 60_000).toISOString(),
      }));
      return Promise.resolve({ kind: 'ok', value: events });
    },

    cancel() {
      return Promise.resolve({ kind: 'ok', value: { providerStatus: 'cancelled' } });
    },

    checkConnection() {
      return Promise.resolve({
        kind: 'ok',
        value: {
          message: 'The mock courier answered (local test mode, no real courier was called)',
        },
      });
    },

    verifyWebhook(header: HeaderReader, rawBody: Buffer, nowMs: number): WebhookVerification {
      if (webhookSecret === undefined) return { ok: false, reason: 'not_configured' };
      const timestamp = header(MOCK_TIMESTAMP_HEADER)?.trim();
      const given = header(MOCK_SIGNATURE_HEADER)
        ?.trim()
        .replace(/^sha256=/i, '')
        .toLowerCase();
      if (!timestamp || !given) return { ok: false, reason: 'missing_signature' };
      if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_signature' };
      if (Math.abs(nowMs / 1000 - Number(timestamp)) > MOCK_WEBHOOK_TOLERANCE_SECONDS) {
        return { ok: false, reason: 'stale' };
      }
      const expected = signMockWebhook(webhookSecret, timestamp, rawBody);
      return sameDigest(expected, given) ? { ok: true } : { ok: false, reason: 'bad_signature' };
    },

    parseWebhook(rawBody: Buffer): ParsedWebhook | null {
      let json: unknown;
      try {
        json = JSON.parse(rawBody.toString('utf8')) as unknown;
      } catch {
        return null;
      }
      // Only these fields are read; anything else in the body (a name, a phone) is dropped.
      const parsed = webhookBodySchema.safeParse(json);
      if (!parsed.success) return null;
      const body = parsed.data;
      if (body.consignmentId === undefined && body.merchantRef === undefined) return null;
      const occurredAt =
        body.occurredAt === undefined ? null : new Date(body.occurredAt).toISOString();
      return {
        eventId: body.eventId ?? null,
        eventType: 'status_update',
        consignmentId: body.consignmentId ?? null,
        merchantRef: body.merchantRef ?? null,
        providerStatus: body.status,
        occurredAt,
        payload: { eventId: body.eventId ?? null, status: body.status, occurredAt },
      };
    },

    mapStatus: mockStatus,
  };
}
