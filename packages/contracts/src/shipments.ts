import { z } from 'zod';
import { adminPageQueryShape, pageInfoShape } from './admin-common';
import { moneyMinorSchema } from './money';

/*
 * Courier shipments contract
 * --------------------------
 * Nilzora books parcels with external couriers (Steadfast, Pathao) from the admin
 * workspace. A shipment has its own lifecycle, separate from the order's: courier events
 * move the shipment, never the order, and a delivery never marks cash as collected.
 *
 * Money is integer poisha. The customer's shipping charge (on the order), the courier's
 * delivery charge, its COD fee, its return charge and the settlement it pays out are
 * separate numbers and are never mixed. Quotes say where their price comes from: the
 * courier's API (`live`), the courier's own estimate (`provider_estimate`), the admin's
 * negotiated rate card (`internal_estimate`, shown as "Internal Estimate") or nothing
 * (`unavailable`).
 *
 * Booking is idempotent: the admin screen creates a booking key once per attempt and
 * sends it with every retry, so a double click or a lost response never books twice. A
 * booking the courier did not clearly answer is `uncertain` and is never retried
 * automatically: staff resolve it after checking the courier's portal.
 *
 * "Mock" shipments come from the local mock courier (COURIER_MODE=mock). They are test
 * data: flagged everywhere and left out of every real total unless asked for.
 */

const timestampSchema = z.iso.datetime({ offset: true });

/** A courier tracking page: https only (the database refuses anything else). */
export const trackingUrlSchema = z
  .string()
  .regex(/^https:\/\/[A-Za-z0-9.-]+\//, 'Tracking links must be https');

/** Courier ids the platform knows; the database row is the source of truth. */
export const COURIER_PROVIDER_IDS = ['steadfast', 'pathao'] as const;
export const courierProviderIdSchema = z.enum(COURIER_PROVIDER_IDS);
export type CourierProviderId = (typeof COURIER_PROVIDER_IDS)[number];

export const SHIPMENT_STATUSES = [
  'draft',
  'quoted',
  'booking_pending',
  'booking_failed',
  'booked',
  'pickup_pending',
  'picked_up',
  'in_transit',
  'on_hold',
  'out_for_delivery',
  'delivered',
  'partially_delivered',
  'delivery_failed',
  'cancelled',
  'return_initiated',
  'returned',
  'unknown',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES);

/** Statuses after which a shipment never moves again. */
export const TERMINAL_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  'booking_failed',
  'cancelled',
  'delivered',
  'returned',
];

/** Statuses staff may record by hand (booking statuses are set by the booking itself). */
export const MANUAL_SHIPMENT_STATUSES = [
  'pickup_pending',
  'picked_up',
  'in_transit',
  'on_hold',
  'out_for_delivery',
  'delivered',
  'partially_delivered',
  'delivery_failed',
  'return_initiated',
  'returned',
] as const satisfies readonly ShipmentStatus[];

/** Words for each status, shared by the admin workspace, the shop and the app. */
export const SHIPMENT_STATUS_LABELS: Readonly<Record<ShipmentStatus, string>> = {
  draft: 'Draft',
  quoted: 'Quoted',
  booking_pending: 'Booking pending',
  booking_failed: 'Booking failed',
  booked: 'Booked',
  pickup_pending: 'Awaiting pickup',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  on_hold: 'On hold',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  partially_delivered: 'Partly delivered',
  delivery_failed: 'Delivery failed',
  cancelled: 'Cancelled',
  return_initiated: 'Returning to store',
  returned: 'Returned to store',
  unknown: 'Unknown',
};

export const SHIPMENT_KINDS = ['forward', 'return_pickup', 'exchange'] as const;
export type ShipmentKind = (typeof SHIPMENT_KINDS)[number];
export const shipmentKindSchema = z.enum(SHIPMENT_KINDS);

export const COURIER_QUOTE_KINDS = [
  'live',
  'provider_estimate',
  'internal_estimate',
  'unavailable',
] as const;
export type CourierQuoteKind = (typeof COURIER_QUOTE_KINDS)[number];
export const courierQuoteKindSchema = z.enum(COURIER_QUOTE_KINDS);

export const COURIER_QUOTE_KIND_LABELS: Readonly<Record<CourierQuoteKind, string>> = {
  live: 'Live quote',
  provider_estimate: 'Courier estimate',
  internal_estimate: 'Internal Estimate',
  unavailable: 'No price',
};

/** How the API talks to couriers: not at all, the local mock, or the real APIs. */
export const COURIER_MODES = ['off', 'mock', 'live'] as const;
export type CourierMode = (typeof COURIER_MODES)[number];
export const courierModeSchema = z.enum(COURIER_MODES);

/**
 * What a courier adapter can do. `awaiting_documentation`: the operation exists at the
 * courier but its API has not been verified against the merchant documentation, so the
 * platform does not call it. `unsupported`: the courier offers no API for it (staff use
 * the courier's portal and record the result).
 */
export const COURIER_CAPABILITY_STATES = [
  'available',
  'unsupported',
  'awaiting_documentation',
] as const;
export const courierCapabilityStateSchema = z.enum(COURIER_CAPABILITY_STATES);
export type CourierCapabilityState = (typeof COURIER_CAPABILITY_STATES)[number];

export const COURIER_CAPABILITIES = [
  'quote',
  'book',
  'track',
  'cancel',
  'webhook',
  'returnPickup',
  'locations',
] as const;
export type CourierCapability = (typeof COURIER_CAPABILITIES)[number];

export const courierCapabilitiesSchema = z.object(
  Object.fromEntries(COURIER_CAPABILITIES.map((c) => [c, courierCapabilityStateSchema])) as Record<
    CourierCapability,
    typeof courierCapabilityStateSchema
  >,
);

/** Up to 50 kg, in grams. */
export const parcelWeightGramsSchema = z.number().int().min(1).max(50_000);
export const deliveryZoneSchema = z.enum(['inside_dhaka', 'outside_dhaka']);

/**
 * A courier's own location choice (a Pathao city/zone/area id): a small object of ids and
 * names. The database refuses anything else.
 */
export const courierDestinationSchema = z
  .record(
    z.string().regex(/^[a-z][a-zA-Z0-9_]{0,40}$/),
    z.union([z.string().max(120), z.number(), z.null()]),
  )
  .refine((value) => Object.keys(value).length <= 12, 'Too many location fields');
export type CourierDestination = z.infer<typeof courierDestinationSchema>;

const reasonSchema = z.string().trim().min(3).max(300);
const noteSchema = z.string().trim().max(300);

// ---------------------------------------------------------------------------
// Shipments and events (staff)
// ---------------------------------------------------------------------------

export const shipmentEventSourceSchema = z.enum(['booking', 'webhook', 'poll', 'manual', 'system']);

export const shipmentEventSchema = z.object({
  id: z.number().int(),
  status: shipmentStatusSchema,
  providerStatus: z.string().nullable(),
  source: shipmentEventSourceSchema,
  occurredAt: timestampSchema,
  recordedAt: timestampSchema,
  /** False when the event was recorded but did not move the shipment (older, or not allowed). */
  applied: z.boolean(),
  note: z.string().nullable(),
});

export const COD_STATES = ['open', 'disputed', 'reconciled'] as const;
export const codStateSchema = z.enum(COD_STATES);
export type CodState = (typeof COD_STATES)[number];

export const shipmentSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  kind: shipmentKindSchema,
  returnRequestId: z.uuid().nullable(),
  parentShipmentId: z.uuid().nullable(),
  provider: z.string(),
  providerName: z.string(),
  status: shipmentStatusSchema,
  isMock: z.boolean(),
  /** Nilzora's own reference sent to the courier (order number, kind and sequence). */
  merchantRef: z.string(),
  consignmentId: z.string().nullable(),
  trackingCode: z.string().nullable(),
  trackingUrl: trackingUrlSchema.nullable(),
  weightGrams: z.number().int(),
  /** Cash the courier collects on delivery (0 for a return pickup or a paid order). */
  codAmountMinor: moneyMinorSchema,
  deliveryZone: deliveryZoneSchema,
  destination: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  quoteId: z.uuid().nullable(),
  recommendedProvider: z.string().nullable(),
  selectionReason: z.string().nullable(),
  /** The courier's expected charges; null when the caller may not see courier money. */
  expectedChargeMinor: moneyMinorSchema.nullable(),
  expectedCodFeeMinor: moneyMinorSchema.nullable(),
  providerStatus: z.string().nullable(),
  /** The courier did not answer the booking clearly: check its portal, then resolve. */
  bookingUncertain: z.boolean(),
  bookingError: z.string().nullable(),
  providerCallStartedAt: timestampSchema.nullable(),
  bookedAt: timestampSchema.nullable(),
  pickedUpAt: timestampSchema.nullable(),
  deliveredAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  cancelReason: z.string().nullable(),
  lastEventAt: timestampSchema.nullable(),
  nextSyncAt: timestampSchema.nullable(),
  syncError: z.string().nullable(),
  codState: codStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const COD_LEDGER_ENTRY_TYPES = [
  'cod_expected',
  'cod_collected',
  'delivery_charge',
  'cod_fee',
  'return_charge',
  'other_deduction',
  'settlement',
  'adjustment',
] as const;
export const codLedgerEntryTypeSchema = z.enum(COD_LEDGER_ENTRY_TYPES);

export const codLedgerEntrySchema = z.object({
  id: z.number().int(),
  entryType: codLedgerEntryTypeSchema,
  /** Poisha; only an adjustment may be negative. */
  amountMinor: z.number().int(),
  settlementId: z.uuid().nullable(),
  evidenceRef: z.string().nullable(),
  isMock: z.boolean(),
  note: z.string().nullable(),
  createdAt: timestampSchema,
});

export const COD_POSITION_STATUSES = [
  'pending',
  'collected',
  'partially_settled',
  'settled',
  'disputed',
  'reconciled',
] as const;
export const codPositionStatusSchema = z.enum(COD_POSITION_STATUSES);
export type CodPositionStatus = (typeof COD_POSITION_STATUSES)[number];

export const codPositionSchema = z.object({
  expectedMinor: z.number().int(),
  collectedMinor: z.number().int(),
  deductionsMinor: z.number().int(),
  adjustmentsMinor: z.number().int(),
  /** collected − deductions + adjustments: what the courier should pay out. */
  expectedSettlementMinor: z.number().int(),
  settledMinor: z.number().int(),
  /** settled − expected settlement: positive means the courier paid more. */
  differenceMinor: z.number().int(),
  status: codPositionStatusSchema,
  codState: codStateSchema,
});

/** GET /admin/shipments/:shipmentId */
export const shipmentDetailResponseSchema = z.object({
  shipment: shipmentSchema,
  events: z.array(shipmentEventSchema),
  /** Null when the caller lacks couriers.cod.read. */
  ledger: z.array(codLedgerEntrySchema).nullable(),
  codPosition: codPositionSchema.nullable(),
});

export const shipmentWithEventsSchema = z.object({
  shipment: shipmentSchema,
  events: z.array(shipmentEventSchema),
});

/** GET /admin/orders/:orderNumber/shipments and GET /admin/returns/:returnId/shipments */
export const shipmentHistoryResponseSchema = z.object({
  shipments: z.array(shipmentWithEventsSchema),
});

/** GET /admin/shipments */
export const adminShipmentListQuerySchema = z.object({
  status: z.union([shipmentStatusSchema, z.literal('all')]).default('all'),
  provider: z.union([z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), z.literal('all')]).default('all'),
  kind: z.union([shipmentKindSchema, z.literal('all')]).default('all'),
  q: z.string().trim().max(100).default(''),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  includeMock: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .default(false),
  ...adminPageQueryShape,
});

export const shipmentListResponseSchema = z.object({
  shipments: z.array(shipmentSchema),
  ...pageInfoShape,
});

// ---------------------------------------------------------------------------
// Configuration: providers, settings, rate cards, location mappings
// ---------------------------------------------------------------------------

export const courierSettingsSchema = z.object({
  defaultParcelWeightGrams: parcelWeightGramsSchema,
  quoteValidityMinutes: z.number().int().min(1).max(1440),
  preferredProvider: z.string().nullable(),
  minHistorySample: z.number().int().min(1).max(10_000),
  updatedAt: timestampSchema,
});

export const courierProviderSchema = z.object({
  provider: z.string(),
  displayName: z.string(),
  /** Enabled by the owner for real bookings (mock bookings do not need it). */
  isEnabled: z.boolean(),
  /** Non-secret settings (a Pathao store id). Credentials are stored encrypted, apart. */
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** COD fee in basis points of the cash collected (100 = 1%), for internal estimates. */
  codFeeBp: z.number().int().min(0).max(10_000).nullable(),
  returnChargeMinor: moneyMinorSchema.nullable(),
  lastCheckAt: timestampSchema.nullable(),
  lastCheckOk: z.boolean().nullable(),
  lastCheckMode: z.enum(['mock', 'live']).nullable(),
  lastCheckMessage: z.string().nullable(),
  updatedAt: timestampSchema,
  /** Whether the API holds the credentials this courier needs (never the values). */
  credentialsConfigured: z.boolean(),
  /** What the API can do with this courier in the current mode. */
  capabilities: courierCapabilitiesSchema,
  /** Why real calls are blocked, when they are. */
  blockedReason: z.string().nullable(),
  /** The courier's API base URL (non-secret), from the admin settings or the environment. */
  apiBaseUrl: z.string().nullable(),
  /** When the owner verified this courier for live use; null = not verified. */
  liveVerifiedAt: timestampSchema.nullable(),
  /** The credential fields this courier's adapter uses. */
  credentialFields: z.array(z.string()),
  /** Which credential fields are set, and where (never their values). */
  credentials: z.array(
    z.object({
      field: z.string(),
      source: z.enum(['vault', 'environment']),
      setAt: timestampSchema.nullable(),
    }),
  ),
  /** Everything that must be true before real bookings may go to this courier. */
  readiness: z.object({
    /** The Nilzora adapter is implemented against verified courier documentation. */
    adapterVerified: z.boolean(),
    credentialsComplete: z.boolean(),
    baseUrlValid: z.boolean(),
    /** A successful live connection check in the last 24 hours. */
    liveCheckPassed: z.boolean(),
    liveVerified: z.boolean(),
    enabled: z.boolean(),
    /** True only when every step above is done and live bookings are on. */
    ready: z.boolean(),
    /** Plain-English list of what is still missing. */
    blockers: z.array(z.string()),
  }),
});

export const courierRateCardSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  zone: deliveryZoneSchema,
  weightUpToGrams: parcelWeightGramsSchema,
  chargeMinor: moneyMinorSchema,
  isActive: z.boolean(),
  updatedAt: timestampSchema,
});

/** The typed confirmation that turns on live courier operations. */
export const COURIER_LIVE_CONFIRMATION = 'ENABLE LIVE COURIERS';
/** The typed confirmation that marks a courier verified for live use. */
export function courierVerifyConfirmation(provider: string): string {
  return `VERIFY ${provider.toUpperCase()}`;
}

/** Operating switches, managed in the admin (couriers.configure), never in the environment. */
export const courierOperationsSchema = z.object({
  mode: courierModeSchema,
  /** Real API bookings are on (live mode only). */
  bookingEnabled: z.boolean(),
  trackingSyncEnabled: z.boolean(),
  trackingSyncIntervalSeconds: z.number().int().min(60).max(86_400),
  httpTimeoutMs: z.number().int().min(1000).max(60_000),
  liveBookingConfirmedAt: timestampSchema.nullable(),
});

export const courierLocationMappingSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  district: z.string(),
  /** Empty: the whole district. */
  area: z.string(),
  destination: z.record(z.string(), z.unknown()),
  label: z.string().nullable(),
  updatedAt: timestampSchema,
});

/** GET /admin/couriers/config */
export const courierConfigResponseSchema = z.object({
  /** The mode the API is actually running in (off when the saved mode is not allowed here). */
  mode: courierModeSchema,
  /** Real API bookings are on. */
  bookingEnabled: z.boolean(),
  trackingSyncEnabled: z.boolean(),
  /** The saved operations settings. */
  operations: courierOperationsSchema,
  /** Where the API's database lives; test mode is refused unless it is local. */
  databaseTarget: z.enum(['local', 'hosted', 'other']),
  /** Whether test (mock) mode may be used with this API and database. */
  mockAllowed: z.boolean(),
  /** Why the saved mode is not in effect, when it is not. */
  modeNotice: z.string().nullable(),
  settings: courierSettingsSchema,
  providers: z.array(courierProviderSchema),
  rateCards: z.array(courierRateCardSchema),
  locationMappings: z.array(courierLocationMappingSchema),
});

/** PUT /admin/couriers/operations */
export const courierOperationsRequestSchema = z.strictObject({
  mode: courierModeSchema,
  bookingEnabled: z.boolean(),
  trackingSyncEnabled: z.boolean(),
  trackingSyncIntervalSeconds: z.number().int().min(60).max(86_400),
  httpTimeoutMs: z.number().int().min(1000).max(60_000),
  /** COURIER_LIVE_CONFIRMATION, required when turning on live mode or live bookings. */
  confirmation: z.string().trim().max(60).optional(),
});

/** PUT /admin/couriers/providers/:provider/credentials/:field (write-only) */
export const courierCredentialRequestSchema = z.strictObject({
  value: z.string().trim().min(1).max(1000),
});

/** PUT /admin/couriers/providers/:provider/base-url */
export const courierBaseUrlRequestSchema = z.strictObject({
  /** https on the courier's host allow-list; null clears it. */
  apiBaseUrl: z.string().trim().max(300).nullable(),
});

/** PUT /admin/couriers/providers/:provider/live-verification */
export const courierLiveVerificationRequestSchema = z.strictObject({
  verified: z.boolean(),
  /** courierVerifyConfirmation(provider), required to verify. */
  confirmation: z.string().trim().max(60).optional(),
});

/** PUT /admin/couriers/settings */
export const courierSettingsRequestSchema = z.strictObject({
  defaultParcelWeightGrams: parcelWeightGramsSchema,
  quoteValidityMinutes: z.number().int().min(1).max(1440),
  preferredProvider: courierProviderIdSchema.nullable(),
  minHistorySample: z.number().int().min(1).max(10_000),
});

const providerSettingKeySchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]{0,40}$/)
  .refine(
    (key) => !/(secret|password|passwd|token|api_?key|apikey|credential|private)/i.test(key),
    'Credentials are set in the credentials section, never in settings',
  );

/** PUT /admin/couriers/providers/:provider */
export const courierProviderRequestSchema = z.strictObject({
  isEnabled: z.boolean(),
  settings: z
    .record(
      providerSettingKeySchema,
      z.union([z.string().trim().max(120), z.number(), z.boolean(), z.null()]),
    )
    .default({}),
  codFeeBp: z.number().int().min(0).max(10_000).nullable(),
  returnChargeMinor: moneyMinorSchema.max(10_000_000).nullable(),
});

/** POST /admin/couriers/providers/:provider/check */
export const courierCheckResponseSchema = z.object({
  provider: z.string(),
  ok: z.boolean(),
  mode: z.enum(['mock', 'live']),
  message: z.string(),
  checkedAt: timestampSchema,
});

/** POST /admin/couriers/rate-cards and PUT /admin/couriers/rate-cards/:rateCardId */
export const courierRateCardRequestSchema = z.strictObject({
  provider: courierProviderIdSchema,
  zone: deliveryZoneSchema,
  weightUpToGrams: parcelWeightGramsSchema,
  chargeMinor: moneyMinorSchema.max(10_000_000),
  isActive: z.boolean().default(true),
});

/** POST /admin/couriers/location-mappings */
export const courierLocationMappingRequestSchema = z.strictObject({
  provider: courierProviderIdSchema,
  district: z.string().trim().min(1).max(80),
  /** Empty: the mapping applies to the whole district. */
  area: z.string().trim().max(80).default(''),
  destination: courierDestinationSchema,
  label: z.string().trim().max(160).optional(),
});

// ---------------------------------------------------------------------------
// One order: context, comparison, booking
// ---------------------------------------------------------------------------

export const courierQuoteSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  kind: courierQuoteKindSchema,
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  deliveryChargeMinor: moneyMinorSchema.nullable(),
  codFeeMinor: moneyMinorSchema.nullable(),
  returnChargeMinor: moneyMinorSchema.nullable(),
  weightGrams: z.number().int(),
  zone: deliveryZoneSchema,
  codAmountMinor: moneyMinorSchema,
  details: z.record(z.string(), z.unknown()),
  isMock: z.boolean(),
  quotedAt: timestampSchema,
  expiresAt: timestampSchema,
});

export const ORDER_NOT_BOOKABLE_REASONS = ['order_status', 'active_shipment'] as const;

/** GET /admin/orders/:orderNumber/courier */
export const orderCourierContextSchema = z.object({
  order: z.object({
    orderNumber: z.string(),
    status: z.string(),
    paymentStatus: z.string(),
    totalMinor: moneyMinorSchema,
    /** Cash the courier should collect: the total while payment is pending, else 0. */
    codDueMinor: moneyMinorSchema,
    /** What the customer paid for shipping (the order's own charge; never changed here). */
    shippingFeeMinor: moneyMinorSchema,
    deliveryZone: deliveryZoneSchema,
    division: z.string(),
    district: z.string(),
    area: z.string(),
    itemCount: z.number().int(),
    placedAt: timestampSchema,
  }),
  bookable: z.boolean(),
  notBookableReason: z.enum(ORDER_NOT_BOOKABLE_REASONS).nullable(),
  defaultParcelWeightGrams: parcelWeightGramsSchema,
  shipments: z.array(shipmentSchema),
  /** Unexpired quotes, newest first. */
  quotes: z.array(courierQuoteSchema),
  /** Remembered courier locations for this district (an exact area match first). */
  locationMappings: z.array(
    z.object({
      provider: z.string(),
      destination: z.record(z.string(), z.unknown()),
      label: z.string().nullable(),
      exactArea: z.boolean(),
    }),
  ),
});

/** POST /admin/orders/:orderNumber/courier/quotes */
export const courierCompareRequestSchema = z.strictObject({
  weightGrams: parcelWeightGramsSchema.optional(),
});

export const courierRecommendationSchema = z.object({
  /** Null when no courier can take the parcel. */
  provider: z.string().nullable(),
  /** Plain reasons, in order of weight ("lowest internal estimate", "best delivery rate"). */
  reasons: z.array(z.string()),
  candidates: z.array(
    z.object({
      provider: z.string(),
      eligible: z.boolean(),
      score: z.number().nullable(),
      totalCostMinor: moneyMinorSchema.nullable(),
      deliveryRate: z.number().min(0).max(1).nullable(),
      historySample: z.number().int().min(0),
      notes: z.array(z.string()),
    }),
  ),
});

export const courierCompareResponseSchema = z.object({
  weightGrams: parcelWeightGramsSchema,
  quotes: z.array(courierQuoteSchema),
  recommendation: courierRecommendationSchema,
  /** Mock quotes come from the local mock courier and are never real prices. */
  isMock: z.boolean(),
});

/** POST /admin/orders/:orderNumber/shipments */
export const bookShipmentRequestSchema = z.strictObject({
  /** Created once per booking attempt by the admin screen and resent with every retry. */
  bookingKey: z.uuid(),
  provider: courierProviderIdSchema,
  quoteId: z.uuid().optional(),
  weightGrams: parcelWeightGramsSchema,
  note: noteSchema.optional(),
  recommendedProvider: courierProviderIdSchema.optional(),
  /** Required when the chosen courier is not the recommended one. */
  selectionReason: z.string().trim().max(300).optional(),
  destination: courierDestinationSchema.optional(),
});

export const BOOKING_OUTCOMES = ['booked', 'failed', 'uncertain', 'in_progress'] as const;
export const bookingOutcomeSchema = z.enum(BOOKING_OUTCOMES);
export type BookingOutcome = (typeof BOOKING_OUTCOMES)[number];

export const bookShipmentResponseSchema = z.object({
  shipment: shipmentSchema,
  /**
   * booked: the courier accepted it. failed: the courier refused (nothing was created).
   * uncertain: no clear answer (check the courier portal, then resolve). in_progress: the
   * same booking key is already being booked; nothing new was sent.
   */
  outcome: bookingOutcomeSchema,
  /** True when this booking key had been used before (a retry, a double click). */
  duplicate: z.boolean(),
});

/** POST /admin/shipments/:shipmentId/resolve */
export const resolveShipmentBookingRequestSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('booked'),
    consignmentId: z.string().trim().min(1).max(80),
    trackingCode: z.string().trim().max(80).optional(),
    note: z.string().trim().min(5).max(300),
  }),
  z.strictObject({
    outcome: z.literal('not_created'),
    note: z.string().trim().min(5).max(300),
  }),
]);

/** POST /admin/shipments/:shipmentId/cancel */
export const cancelShipmentRequestSchema = z.strictObject({
  reason: reasonSchema,
  /**
   * For a courier without a cancel API: staff confirm they cancelled it in the courier's
   * portal. Ignored when the API cancels it with the courier itself.
   */
  cancelledInPortal: z.boolean().default(false),
});

/** POST /admin/shipments/:shipmentId/events (a status staff record by hand) */
export const recordShipmentStatusRequestSchema = z.strictObject({
  status: z.enum(MANUAL_SHIPMENT_STATUSES),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().min(5).max(300),
});

export const recordShipmentStatusResponseSchema = z.object({
  applied: z.boolean(),
  duplicate: z.boolean(),
  shipment: shipmentSchema,
});

/** POST /admin/shipments/:shipmentId/refresh */
export const refreshShipmentResponseSchema = z.object({
  shipment: shipmentSchema,
  /** synced: the courier answered now; queued: the worker will ask; unsupported: record by hand. */
  result: z.enum(['synced', 'queued', 'unsupported']),
  message: z.string(),
});

/**
 * POST /admin/orders/:orderNumber/shipments/portal
 *
 * Records a parcel staff booked in the courier's own merchant portal (the hybrid path, for
 * a courier whose API is not verified or not offered). Nothing is sent to the courier. With
 * `returnId` it records a return pickup of that order. The same `bookingKey` records once.
 */
export const recordPortalBookingRequestSchema = z.strictObject({
  bookingKey: z.uuid(),
  provider: courierProviderIdSchema,
  returnId: z.uuid().optional(),
  weightGrams: parcelWeightGramsSchema,
  /** The consignment id the courier portal showed. */
  consignmentId: z.string().trim().min(1).max(80),
  trackingCode: z.string().trim().min(1).max(80).optional(),
  /** The delivery charge the portal quoted, if any (poisha). */
  chargeMinor: moneyMinorSchema.max(10_000_000).optional(),
  /** Where and how it was booked. */
  note: z.string().trim().min(5).max(300),
  recommendedProvider: courierProviderIdSchema.optional(),
  selectionReason: z.string().trim().max(300).optional(),
});

/** POST /admin/returns/:returnId/pickup */
export const bookReturnPickupRequestSchema = z.strictObject({
  bookingKey: z.uuid(),
  provider: courierProviderIdSchema,
  weightGrams: parcelWeightGramsSchema,
  note: noteSchema.optional(),
  destination: courierDestinationSchema.optional(),
});

/** POST /admin/returns/:returnId/exchange */
export const bookExchangeShipmentRequestSchema = z.strictObject({
  bookingKey: z.uuid(),
  provider: courierProviderIdSchema,
  weightGrams: parcelWeightGramsSchema,
  /** Cash to collect for the replacement (a price difference), 0 for a like-for-like swap. */
  codAmountMinor: moneyMinorSchema.max(100_000_000),
  note: noteSchema.optional(),
  destination: courierDestinationSchema.optional(),
});

// ---------------------------------------------------------------------------
// Overview and provider performance
// ---------------------------------------------------------------------------

/** GET /admin/couriers/overview */
export const courierOverviewResponseSchema = z.object({
  total: z.number().int(),
  bookingPending: z.number().int(),
  uncertain: z.number().int(),
  pendingPickup: z.number().int(),
  inTransit: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  returned: z.number().int(),
  cancelled: z.number().int(),
  syncErrors: z.number().int(),
  /** Null when the caller may not see courier money. */
  codAwaitingSettlementMinor: z.number().int().nullable(),
  includesMock: z.boolean(),
  mode: courierModeSchema,
  providers: z.array(
    z.object({
      provider: z.string(),
      displayName: z.string(),
      isEnabled: z.boolean(),
      settled: z.number().int(),
      delivered: z.number().int(),
      failed: z.number().int(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Cash on delivery
// ---------------------------------------------------------------------------

/** GET /admin/couriers/cod */
export const codPositionListQuerySchema = z.object({
  provider: z.union([courierProviderIdSchema, z.literal('all')]).default('all'),
  status: z.union([codPositionStatusSchema, z.literal('all')]).default('all'),
  includeMock: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .default(false),
  ...adminPageQueryShape,
});

export const codPositionRowSchema = z.object({
  shipmentId: z.uuid(),
  orderNumber: z.string(),
  orderPaymentStatus: z.string(),
  provider: z.string(),
  status: shipmentStatusSchema,
  consignmentId: z.string().nullable(),
  isMock: z.boolean(),
  deliveredAt: timestampSchema.nullable(),
  position: codPositionSchema,
});

export const codPositionListResponseSchema = z.object({
  positions: z.array(codPositionRowSchema),
  totals: z.object({
    expectedMinor: z.number().int(),
    collectedMinor: z.number().int(),
    deductionsMinor: z.number().int(),
    expectedSettlementMinor: z.number().int(),
    settledMinor: z.number().int(),
  }),
  ...pageInfoShape,
});

/** POST /admin/shipments/:shipmentId/cod/collected */
export const recordCodCollectedRequestSchema = z.strictObject({
  amountMinor: moneyMinorSchema,
  /** The courier's report or invoice reference. */
  evidenceRef: z.string().trim().min(1).max(80),
  note: noteSchema.optional(),
});

/** POST /admin/shipments/:shipmentId/cod/adjustments */
export const recordCodAdjustmentRequestSchema = z.strictObject({
  amountMinor: z
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((v) => v !== 0, 'An adjustment cannot be zero'),
  note: z.string().trim().min(5).max(300),
});

/** PUT /admin/shipments/:shipmentId/cod/state */
export const setCodStateRequestSchema = z.strictObject({
  state: codStateSchema,
  note: noteSchema.optional(),
});

export const courierSettlementLineSchema = z.strictObject({
  shipmentId: z.uuid(),
  settledMinor: moneyMinorSchema,
  deliveryChargeMinor: moneyMinorSchema.optional(),
  codFeeMinor: moneyMinorSchema.optional(),
  returnChargeMinor: moneyMinorSchema.optional(),
  otherDeductionMinor: moneyMinorSchema.optional(),
});

/** POST /admin/couriers/settlements */
export const recordCourierSettlementRequestSchema = z
  .strictObject({
    provider: courierProviderIdSchema,
    /** The courier's payout id or invoice number. */
    reference: z.string().trim().min(2).max(80),
    amountMinor: moneyMinorSchema,
    receivedOn: z.iso.date(),
    note: noteSchema.optional(),
    /** Settles mock shipments (local testing only). */
    isMock: z.boolean().default(false),
    lines: z.array(courierSettlementLineSchema).min(1).max(500),
  })
  .refine(
    (value) => value.lines.reduce((sum, line) => sum + line.settledMinor, 0) === value.amountMinor,
    {
      message: 'The lines must add up to the payout amount',
      path: ['lines'],
    },
  )
  .refine(
    (value) => new Set(value.lines.map((line) => line.shipmentId)).size === value.lines.length,
    {
      message: 'A shipment appears twice',
      path: ['lines'],
    },
  );

export const courierSettlementSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  reference: z.string(),
  amountMinor: moneyMinorSchema,
  receivedOn: z.iso.date(),
  note: z.string().nullable(),
  isMock: z.boolean(),
  createdAt: timestampSchema,
  lines: z.number().int(),
});

/** GET /admin/couriers/settlements */
export const courierSettlementListQuerySchema = z.object({
  provider: z.union([courierProviderIdSchema, z.literal('all')]).default('all'),
  includeMock: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .default(false),
  ...adminPageQueryShape,
});

export const courierSettlementListResponseSchema = z.object({
  settlements: z.array(courierSettlementSchema),
  ...pageInfoShape,
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** A shipment as its customer sees it: no costs, no internal notes, no raw courier data. */
export const customerShipmentSchema = z.object({
  id: z.uuid(),
  kind: shipmentKindSchema,
  returnRequestId: z.uuid().nullable(),
  providerName: z.string(),
  status: shipmentStatusSchema,
  trackingCode: z.string().nullable(),
  trackingUrl: trackingUrlSchema.nullable(),
  /** A local test shipment (mock courier). */
  isTest: z.boolean(),
  bookedAt: timestampSchema.nullable(),
  deliveredAt: timestampSchema.nullable(),
  events: z.array(z.object({ status: shipmentStatusSchema, occurredAt: timestampSchema })),
});

/** GET /orders/:orderNumber/shipments (the signed-in customer's own order) */
export const customerShipmentsResponseSchema = z.object({
  shipments: z.array(customerShipmentSchema),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShipmentEvent = z.infer<typeof shipmentEventSchema>;
export type Shipment = z.infer<typeof shipmentSchema>;
export type CodLedgerEntry = z.infer<typeof codLedgerEntrySchema>;
export type CodPosition = z.infer<typeof codPositionSchema>;
export type ShipmentDetailResponse = z.infer<typeof shipmentDetailResponseSchema>;
export type ShipmentWithEvents = z.infer<typeof shipmentWithEventsSchema>;
export type ShipmentHistoryResponse = z.infer<typeof shipmentHistoryResponseSchema>;
export type AdminShipmentListQuery = z.input<typeof adminShipmentListQuerySchema>;
export type ShipmentListResponse = z.infer<typeof shipmentListResponseSchema>;
export type CourierSettings = z.infer<typeof courierSettingsSchema>;
export type CourierProvider = z.infer<typeof courierProviderSchema>;
export type CourierCapabilities = z.infer<typeof courierCapabilitiesSchema>;
export type CourierRateCard = z.infer<typeof courierRateCardSchema>;
export type CourierConfigResponse = z.infer<typeof courierConfigResponseSchema>;
export type CourierSettingsRequest = z.infer<typeof courierSettingsRequestSchema>;
export type CourierProviderRequest = z.input<typeof courierProviderRequestSchema>;
export type CourierCheckResponse = z.infer<typeof courierCheckResponseSchema>;
export type CourierRateCardRequest = z.input<typeof courierRateCardRequestSchema>;
export type CourierLocationMappingRequest = z.input<typeof courierLocationMappingRequestSchema>;
export type CourierOperations = z.infer<typeof courierOperationsSchema>;
export type CourierOperationsRequest = z.infer<typeof courierOperationsRequestSchema>;
export type CourierLocationMapping = z.infer<typeof courierLocationMappingSchema>;
export type CourierCredentialRequest = z.infer<typeof courierCredentialRequestSchema>;
export type CourierBaseUrlRequest = z.infer<typeof courierBaseUrlRequestSchema>;
export type CourierLiveVerificationRequest = z.infer<typeof courierLiveVerificationRequestSchema>;
export type CourierQuote = z.infer<typeof courierQuoteSchema>;
export type OrderCourierContext = z.infer<typeof orderCourierContextSchema>;
export type CourierCompareRequest = z.infer<typeof courierCompareRequestSchema>;
export type CourierRecommendation = z.infer<typeof courierRecommendationSchema>;
export type CourierCompareResponse = z.infer<typeof courierCompareResponseSchema>;
export type BookShipmentRequest = z.infer<typeof bookShipmentRequestSchema>;
export type BookShipmentResponse = z.infer<typeof bookShipmentResponseSchema>;
export type ResolveShipmentBookingRequest = z.infer<typeof resolveShipmentBookingRequestSchema>;
export type CancelShipmentRequest = z.input<typeof cancelShipmentRequestSchema>;
export type RecordShipmentStatusRequest = z.infer<typeof recordShipmentStatusRequestSchema>;
export type RecordShipmentStatusResponse = z.infer<typeof recordShipmentStatusResponseSchema>;
export type RefreshShipmentResponse = z.infer<typeof refreshShipmentResponseSchema>;
export type BookReturnPickupRequest = z.infer<typeof bookReturnPickupRequestSchema>;
export type BookExchangeShipmentRequest = z.infer<typeof bookExchangeShipmentRequestSchema>;
export type RecordPortalBookingRequest = z.infer<typeof recordPortalBookingRequestSchema>;
export type CourierOverviewResponse = z.infer<typeof courierOverviewResponseSchema>;
export type CodPositionListQuery = z.input<typeof codPositionListQuerySchema>;
export type CodPositionRow = z.infer<typeof codPositionRowSchema>;
export type CodPositionListResponse = z.infer<typeof codPositionListResponseSchema>;
export type RecordCodCollectedRequest = z.infer<typeof recordCodCollectedRequestSchema>;
export type RecordCodAdjustmentRequest = z.infer<typeof recordCodAdjustmentRequestSchema>;
export type SetCodStateRequest = z.infer<typeof setCodStateRequestSchema>;
export type CourierSettlementLine = z.infer<typeof courierSettlementLineSchema>;
export type RecordCourierSettlementRequest = z.input<typeof recordCourierSettlementRequestSchema>;
export type CourierSettlement = z.infer<typeof courierSettlementSchema>;
export type CourierSettlementListQuery = z.input<typeof courierSettlementListQuerySchema>;
export type CourierSettlementListResponse = z.infer<typeof courierSettlementListResponseSchema>;
export type CustomerShipment = z.infer<typeof customerShipmentSchema>;
export type CustomerShipmentsResponse = z.infer<typeof customerShipmentsResponseSchema>;
