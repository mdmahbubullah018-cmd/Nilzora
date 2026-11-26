import {
  codPositionListResponseSchema,
  courierOverviewResponseSchema,
  courierLocationMappingSchema,
  courierModeSchema,
  courierOperationsSchema,
  courierProviderSchema,
  courierRateCardSchema,
  courierSettingsSchema,
  courierSettlementSchema,
  customerShipmentSchema,
  orderCourierContextSchema,
  shipmentDetailResponseSchema,
  shipmentSchema,
  shipmentStatusSchema,
  shipmentWithEventsSchema,
  type CodPositionListResponse,
  type CourierLocationMappingRequest,
  type CourierProviderRequest,
  type CourierRateCardRequest,
  type CourierSettingsRequest,
  type CourierSettlement,
  type CustomerShipment,
  type OrderCourierContext,
  type RecordCodAdjustmentRequest,
  type RecordCodCollectedRequest,
  type RecordCourierSettlementRequest,
  type ResolveShipmentBookingRequest,
  type SetCodStateRequest,
  type Shipment,
  type ShipmentDetailResponse,
  type ShipmentStatus,
  type ShipmentWithEvents,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SupabaseClients } from '../../supabase/clients';
import { toAdminStoreError } from '../admin/errors';
import type { Page } from '../admin/shared';
import { conform, isoTimestamps } from '../commerce/errors';
import { postgresRpc, postgresServiceRpc, supabaseRpc, type Rpc } from '../db-rpc';
import type { QuoteDraft } from './pricing';

/*
 * The courier tables are closed (RLS on, no grants): every read and write goes through the
 * functions of 20261223091000_courier_foundation.sql. Staff calls run AS THE CALLER, so
 * each function checks the caller's permission again; the service-role calls are only for
 * the booking payload, webhook intake and the tracking worker, never for a staff request's
 * authority. Every answer is checked against the public contract before it is used.
 */

export interface CourierCaller {
  accessToken: string;
  userId: string;
}

const dbProviderSchema = courierProviderSchema
  .omit({
    credentialsConfigured: true,
    capabilities: true,
    blockedReason: true,
    credentials: true,
    readiness: true,
  })
  .extend({
    /** Fields stored in Vault (the database never answers their values). */
    credentials: z.array(z.object({ field: z.string(), setAt: z.iso.datetime({ offset: true }) })),
  });
export type DbCourierProvider = z.infer<typeof dbProviderSchema>;

const dbConfigSchema = z.object({
  settings: courierSettingsSchema,
  operations: courierOperationsSchema,
  providers: z.array(dbProviderSchema),
  rateCards: z.array(courierRateCardSchema),
  locationMappings: z.array(courierLocationMappingSchema),
});
export type DbCourierConfig = z.infer<typeof dbConfigSchema>;

/** service_courier_runtime: the switches the API runs on (no secrets). */
const runtimeSchema = z.object({
  mode: courierModeSchema,
  bookingEnabled: z.boolean(),
  trackingSyncEnabled: z.boolean(),
  trackingSyncIntervalSeconds: z.number().int().min(60).max(86_400),
  httpTimeoutMs: z.number().int().min(1000).max(60_000),
  providers: z.array(
    z.object({
      provider: z.string(),
      isEnabled: z.boolean(),
      apiBaseUrl: z.string().nullable(),
      liveVerified: z.boolean(),
      credentialFields: z.array(z.string()),
    }),
  ),
});
export type CourierRuntimeSettings = z.infer<typeof runtimeSchema>;

/** service_courier_credentials: decrypted values. Never log, return or forward them. */
const credentialValuesSchema = z.record(z.string(), z.string());

const providerStatsSchema = z.array(
  z.object({
    provider: z.string(),
    settled: z.number().int(),
    delivered: z.number().int(),
    failed: z.number().int(),
  }),
);
export type ProviderStats = z.infer<typeof providerStatsSchema>[number];

const recordedQuotesSchema = z.array(z.object({ provider: z.string(), id: z.uuid() }));

const beginSchema = z.object({
  shipment: shipmentSchema,
  shouldCall: z.boolean(),
  duplicate: z.boolean(),
});
export type BeginResult = z.infer<typeof beginSchema>;

const eventResultSchema = z.object({
  eventId: z.number().int(),
  applied: z.boolean(),
  duplicate: z.boolean(),
});
export type EventResult = z.infer<typeof eventResultSchema>;

const shipmentListSchema = z.object({
  total: z.number().int(),
  shipments: z.array(shipmentSchema),
});
const dbOverviewSchema = courierOverviewResponseSchema.omit({ mode: true, providers: true });
export type DbOverview = z.infer<typeof dbOverviewSchema>;
const historySchema = z.array(shipmentWithEventsSchema);
const codPositionsSchema = codPositionListResponseSchema
  .omit({ page: true, pageSize: true, totalPages: true })
  .extend({ total: z.number().int() });
const settlementListSchema = z.object({
  total: z.number().int(),
  settlements: z.array(courierSettlementSchema),
});
const customerShipmentsSchema = z.array(customerShipmentSchema);
const uuidValueSchema = z.uuid();

/** service_shipment_booking_payload. Personal data: never log it, never return it. */
const bookingPayloadSchema = z.object({
  shipmentId: z.uuid(),
  merchantRef: z.string(),
  kind: z.enum(['forward', 'return_pickup', 'exchange']),
  provider: z.string(),
  isMock: z.boolean(),
  codAmountMinor: z.number().int(),
  weightGrams: z.number().int(),
  deliveryZone: z.enum(['inside_dhaka', 'outside_dhaka']),
  destination: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  itemCount: z.number().int(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  addressLine: z.string(),
  area: z.string(),
  district: z.string(),
  division: z.string(),
  postalCode: z.string().nullable(),
  landmark: z.string().nullable(),
  providerSettings: z.record(z.string(), z.unknown()),
});
export type BookingPayload = z.infer<typeof bookingPayloadSchema>;

const syncRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    provider: z.string(),
    status: shipmentStatusSchema,
    consignment_id: z.string().nullable(),
    tracking_code: z.string().nullable(),
    merchant_ref: z.string(),
    is_mock: z.boolean(),
    sync_attempts: z.number().int(),
  }),
);
export interface SyncClaim {
  id: string;
  provider: string;
  status: ShipmentStatus;
  consignmentId: string | null;
  trackingCode: string | null;
  merchantRef: string;
  isMock: boolean;
  syncAttempts: number;
}

const storedWebhookSchema = z.object({ id: z.uuid(), duplicate: z.boolean() });

const webhookRetryRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    provider: z.string(),
    event_type: z.string().nullable(),
    consignment_id: z.string().nullable(),
    merchant_ref: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    attempts: z.number().int(),
  }),
);
export interface WebhookRetry {
  id: string;
  provider: string;
  eventType: string | null;
  consignmentId: string | null;
  merchantRef: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface ShipmentListFilters {
  status: ShipmentStatus | null;
  provider: string | null;
  kind: string | null;
  query: string | null;
  from: string | null;
  to: string | null;
  includeMock: boolean;
}

export interface BeginBookingInput {
  bookingKey: string;
  provider: string;
  quoteId: string | null;
  weightGrams: number;
  note: string | null;
  recommendedProvider: string | null;
  selectionReason: string | null;
  destination: Record<string, unknown>;
  isMock: boolean;
}

export interface BeginReturnInput {
  bookingKey: string;
  provider: string;
  weightGrams: number;
  note: string | null;
  destination: Record<string, unknown>;
  isMock: boolean;
  /** Exchange only. */
  codAmountMinor?: number;
}

export interface PortalBookingInput {
  /** Set for a return pickup booked in the portal; null for the order's own delivery. */
  returnId: string | null;
  bookingKey: string;
  provider: string;
  weightGrams: number;
  consignmentId: string;
  trackingCode: string | null;
  chargeMinor: number | null;
  note: string;
  recommendedProvider: string | null;
  selectionReason: string | null;
  isMock: boolean;
}

export interface FinishBookingInput {
  outcome: 'booked' | 'failed' | 'uncertain';
  consignmentId: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  providerStatus: string | null;
  chargeMinor: number | null;
  error: string | null;
}

export interface ShipmentEventInput {
  status: ShipmentStatus;
  providerStatus: string | null;
  occurredAt: string | null;
  dedupeKey: string;
}

export interface CourierOperationsInput {
  mode: 'off' | 'mock' | 'live';
  bookingEnabled: boolean;
  trackingSyncEnabled: boolean;
  trackingSyncIntervalSeconds: number;
  httpTimeoutMs: number;
  confirmation: string | null;
}

export interface CourierStore {
  config(caller: CourierCaller): Promise<DbCourierConfig>;
  saveOperations(caller: CourierCaller, input: CourierOperationsInput): Promise<void>;
  /** Writes one credential into Vault. The value is never read back. */
  setCredential(
    caller: CourierCaller,
    provider: string,
    field: string,
    value: string,
  ): Promise<void>;
  clearCredential(caller: CourierCaller, provider: string, field: string): Promise<void>;
  saveBaseUrl(caller: CourierCaller, provider: string, url: string | null): Promise<void>;
  setLiveVerified(
    caller: CourierCaller,
    provider: string,
    verified: boolean,
    confirmation: string | null,
  ): Promise<void>;
  deleteLocationMapping(caller: CourierCaller, id: string): Promise<void>;
  /** Server-only: the operating settings (no secrets). */
  runtime(): Promise<CourierRuntimeSettings>;
  /** Server-only: one courier's decrypted credentials. Never log or return them. */
  credentials(provider: string): Promise<Record<string, string>>;
  saveSettings(caller: CourierCaller, input: CourierSettingsRequest): Promise<void>;
  saveProvider(
    caller: CourierCaller,
    provider: string,
    input: CourierProviderRequest,
  ): Promise<void>;
  recordCheck(
    caller: CourierCaller,
    provider: string,
    check: { ok: boolean; mode: 'mock' | 'live'; message: string },
  ): Promise<void>;
  saveRateCard(
    caller: CourierCaller,
    id: string | null,
    input: CourierRateCardRequest,
  ): Promise<string>;
  deleteRateCard(caller: CourierCaller, id: string): Promise<void>;
  saveLocationMapping(caller: CourierCaller, input: CourierLocationMappingRequest): Promise<void>;
  orderContext(caller: CourierCaller, orderNumber: string): Promise<OrderCourierContext>;
  recordQuotes(
    caller: CourierCaller,
    orderNumber: string,
    quotes: readonly QuoteDraft[],
  ): Promise<{ provider: string; id: string }[]>;
  providerStats(caller: CourierCaller): Promise<ProviderStats[]>;
  beginBooking(
    caller: CourierCaller,
    orderNumber: string,
    input: BeginBookingInput,
  ): Promise<BeginResult>;
  beginReturnPickup(
    caller: CourierCaller,
    returnId: string,
    input: BeginReturnInput,
  ): Promise<BeginResult>;
  beginExchange(
    caller: CourierCaller,
    returnId: string,
    input: BeginReturnInput,
  ): Promise<BeginResult>;
  /** Records a parcel staff booked in the courier's own portal (no courier call). */
  recordPortalBooking(
    caller: CourierCaller,
    orderNumber: string,
    input: PortalBookingInput,
  ): Promise<Shipment>;
  finishBooking(
    caller: CourierCaller,
    shipmentId: string,
    input: FinishBookingInput,
  ): Promise<Shipment>;
  resolveBooking(
    caller: CourierCaller,
    shipmentId: string,
    input: ResolveShipmentBookingRequest,
  ): Promise<Shipment>;
  recordEvent(
    caller: CourierCaller,
    shipmentId: string,
    event: ShipmentEventInput & { source: 'poll' | 'manual'; note: string | null },
  ): Promise<EventResult>;
  cancel(
    caller: CourierCaller,
    shipmentId: string,
    reason: string,
    providerConfirmed: boolean,
  ): Promise<Shipment>;
  requestSync(caller: CourierCaller, shipmentId: string): Promise<void>;
  listShipments(
    caller: CourierCaller,
    filters: ShipmentListFilters,
    page: Page,
  ): Promise<{ shipments: Shipment[]; total: number }>;
  getShipment(caller: CourierCaller, shipmentId: string): Promise<ShipmentDetailResponse>;
  overview(caller: CourierCaller, includeMock: boolean): Promise<DbOverview>;
  orderShipments(caller: CourierCaller, orderNumber: string): Promise<ShipmentWithEvents[]>;
  returnShipments(caller: CourierCaller, returnId: string): Promise<ShipmentWithEvents[]>;
  codPositions(
    caller: CourierCaller,
    filters: { provider: string | null; status: string | null; includeMock: boolean },
    page: Page,
  ): Promise<Omit<CodPositionListResponse, 'page' | 'pageSize' | 'totalPages'>>;
  recordCodCollected(
    caller: CourierCaller,
    shipmentId: string,
    input: RecordCodCollectedRequest,
  ): Promise<void>;
  recordSettlement(caller: CourierCaller, input: RecordCourierSettlementRequest): Promise<string>;
  recordCodAdjustment(
    caller: CourierCaller,
    shipmentId: string,
    input: RecordCodAdjustmentRequest,
  ): Promise<void>;
  setCodState(caller: CourierCaller, shipmentId: string, input: SetCodStateRequest): Promise<void>;
  listSettlements(
    caller: CourierCaller,
    filters: { provider: string | null; includeMock: boolean },
    page: Page,
  ): Promise<{ settlements: CourierSettlement[]; total: number }>;
  myOrderShipments(caller: CourierCaller, orderNumber: string): Promise<CustomerShipment[]>;

  // Server-only (service role).
  bookingPayload(shipmentId: string): Promise<BookingPayload | null>;
  serviceRecordEvent(
    shipmentId: string,
    event: ShipmentEventInput & { source: 'webhook' | 'poll' },
  ): Promise<EventResult>;
  claimSync(limit: number, leaseSeconds: number): Promise<SyncClaim[]>;
  finishSync(
    shipmentId: string,
    ok: boolean,
    error: string | null,
    nextInSeconds: number,
  ): Promise<void>;
  storeWebhook(record: {
    provider: string;
    dedupeKey: string;
    eventType: string | null;
    consignmentId: string | null;
    merchantRef: string | null;
    signatureOk: boolean;
    payload: Record<string, unknown>;
  }): Promise<{ id: string; duplicate: boolean }>;
  findShipment(
    provider: string,
    consignmentId: string | null,
    merchantRef: string | null,
  ): Promise<string | null>;
  finishWebhook(
    id: string,
    status: 'processed' | 'ignored' | 'failed',
    error: string | null,
    shipmentId: string | null,
  ): Promise<void>;
  claimWebhookRetries(limit: number): Promise<WebhookRetry[]>;
}

/** The store over two call paths: as the signed-in caller, and as the server itself. */
export function courierStoreOver(
  userRpc: (caller: CourierCaller) => Rpc,
  serviceRpc: Rpc,
): CourierStore {
  const as = (caller: CourierCaller) => {
    const rpc = userRpc(caller);
    return async <T>(
      name: string,
      args: Record<string, unknown>,
      schema: z.ZodType<T>,
    ): Promise<T> => conform(schema, isoTimestamps(await rpc<unknown>(name, args)), name);
  };
  const server = async <T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> => conform(schema, isoTimestamps(await serviceRpc<unknown>(name, args)), name);
  const none = z.unknown();

  return {
    config: (caller) => as(caller)('admin_courier_config', {}, dbConfigSchema),

    async saveOperations(caller, input) {
      await as(caller)(
        'admin_save_courier_operations',
        {
          p_mode: input.mode,
          p_booking_enabled: input.bookingEnabled,
          p_tracking_sync_enabled: input.trackingSyncEnabled,
          p_tracking_sync_interval_seconds: input.trackingSyncIntervalSeconds,
          p_http_timeout_ms: input.httpTimeoutMs,
          p_confirmation: input.confirmation,
        },
        none,
      );
    },

    async setCredential(caller, provider, field, value) {
      await as(caller)(
        'admin_set_courier_credential',
        { p_provider: provider, p_field: field, p_value: value },
        none,
      );
    },

    async clearCredential(caller, provider, field) {
      await as(caller)(
        'admin_clear_courier_credential',
        { p_provider: provider, p_field: field },
        none,
      );
    },

    async saveBaseUrl(caller, provider, url) {
      await as(caller)(
        'admin_save_courier_api_base_url',
        { p_provider: provider, p_url: url },
        none,
      );
    },

    async setLiveVerified(caller, provider, verified, confirmation) {
      await as(caller)(
        'admin_set_courier_live_verified',
        { p_provider: provider, p_verified: verified, p_confirmation: confirmation },
        none,
      );
    },

    async deleteLocationMapping(caller, id) {
      await as(caller)('admin_delete_courier_location_mapping', { p_id: id }, none);
    },

    runtime: () => server('service_courier_runtime', {}, runtimeSchema),

    // Not through isoTimestamps: a credential is returned exactly as it was stored.
    credentials: async (provider) =>
      conform(
        credentialValuesSchema,
        await serviceRpc<unknown>('service_courier_credentials', { p_provider: provider }),
        'service_courier_credentials',
      ),

    async saveSettings(caller, input) {
      await as(caller)(
        'admin_save_courier_settings',
        {
          p_default_parcel_weight_grams: input.defaultParcelWeightGrams,
          p_quote_validity_minutes: input.quoteValidityMinutes,
          p_preferred_provider: input.preferredProvider,
          p_min_history_sample: input.minHistorySample,
        },
        none,
      );
    },

    async saveProvider(caller, provider, input) {
      await as(caller)(
        'admin_save_courier_provider',
        {
          p_provider: provider,
          p_is_enabled: input.isEnabled,
          p_settings: input.settings ?? {},
          p_cod_fee_bp: input.codFeeBp,
          p_return_charge_minor: input.returnChargeMinor,
        },
        none,
      );
    },

    async recordCheck(caller, provider, check) {
      await as(caller)(
        'admin_record_courier_check',
        { p_provider: provider, p_ok: check.ok, p_mode: check.mode, p_message: check.message },
        none,
      );
    },

    saveRateCard: (caller, id, input) =>
      as(caller)(
        'admin_save_courier_rate_card',
        {
          p_id: id,
          p_provider: input.provider,
          p_zone: input.zone,
          p_weight_up_to_grams: input.weightUpToGrams,
          p_charge_minor: input.chargeMinor,
          p_is_active: input.isActive ?? true,
        },
        uuidValueSchema,
      ),

    async deleteRateCard(caller, id) {
      await as(caller)('admin_delete_courier_rate_card', { p_id: id }, none);
    },

    async saveLocationMapping(caller, input) {
      await as(caller)(
        'admin_save_courier_location_mapping',
        {
          p_provider: input.provider,
          p_district: input.district,
          p_area: input.area ?? '',
          p_destination: input.destination,
          p_label: input.label ?? null,
        },
        none,
      );
    },

    orderContext: (caller, orderNumber) =>
      as(caller)(
        'admin_order_courier_context',
        { p_order_number: orderNumber },
        orderCourierContextSchema,
      ),

    recordQuotes: (caller, orderNumber, quotes) =>
      as(caller)(
        'admin_record_courier_quotes',
        { p_order_number: orderNumber, p_quotes: quotes },
        recordedQuotesSchema,
      ),

    providerStats: (caller) =>
      as(caller)('admin_courier_provider_stats', { p_days: 180 }, providerStatsSchema),

    beginBooking: (caller, orderNumber, input) =>
      as(caller)(
        'admin_begin_shipment_booking',
        {
          p_order_number: orderNumber,
          p_booking_key: input.bookingKey,
          p_provider: input.provider,
          p_quote_id: input.quoteId,
          p_weight_grams: input.weightGrams,
          p_note: input.note,
          p_recommended_provider: input.recommendedProvider,
          p_selection_reason: input.selectionReason,
          p_destination: input.destination,
          p_is_mock: input.isMock,
        },
        beginSchema,
      ),

    beginReturnPickup: (caller, returnId, input) =>
      as(caller)(
        'admin_begin_return_pickup',
        {
          p_return_id: returnId,
          p_booking_key: input.bookingKey,
          p_provider: input.provider,
          p_weight_grams: input.weightGrams,
          p_note: input.note,
          p_destination: input.destination,
          p_is_mock: input.isMock,
        },
        beginSchema,
      ),

    recordPortalBooking: (caller, orderNumber, input) =>
      as(caller)(
        'admin_record_portal_booking',
        {
          p_order_number: orderNumber,
          p_return_id: input.returnId,
          p_booking_key: input.bookingKey,
          p_provider: input.provider,
          p_weight_grams: input.weightGrams,
          p_consignment_id: input.consignmentId,
          p_tracking_code: input.trackingCode,
          p_charge_minor: input.chargeMinor,
          p_note: input.note,
          p_recommended_provider: input.recommendedProvider,
          p_selection_reason: input.selectionReason,
          p_is_mock: input.isMock,
        },
        shipmentSchema,
      ),

    beginExchange: (caller, returnId, input) =>
      as(caller)(
        'admin_begin_exchange_shipment',
        {
          p_return_id: returnId,
          p_booking_key: input.bookingKey,
          p_provider: input.provider,
          p_weight_grams: input.weightGrams,
          p_cod_amount_minor: input.codAmountMinor ?? 0,
          p_note: input.note,
          p_destination: input.destination,
          p_is_mock: input.isMock,
        },
        beginSchema,
      ),

    finishBooking: (caller, shipmentId, input) =>
      as(caller)(
        'admin_finish_shipment_booking',
        {
          p_shipment_id: shipmentId,
          p_outcome: input.outcome,
          p_consignment_id: input.consignmentId,
          p_tracking_code: input.trackingCode,
          p_tracking_url: input.trackingUrl,
          p_provider_status: input.providerStatus,
          p_charge_minor: input.chargeMinor,
          p_error: input.error,
        },
        shipmentSchema,
      ),

    resolveBooking: (caller, shipmentId, input) =>
      as(caller)(
        'admin_resolve_shipment_booking',
        {
          p_shipment_id: shipmentId,
          p_outcome: input.outcome,
          p_consignment_id: input.outcome === 'booked' ? input.consignmentId : null,
          p_tracking_code: input.outcome === 'booked' ? (input.trackingCode ?? null) : null,
          p_note: input.note,
        },
        shipmentSchema,
      ),

    recordEvent: (caller, shipmentId, event) =>
      as(caller)(
        'admin_record_shipment_event',
        {
          p_shipment_id: shipmentId,
          p_status: event.status,
          p_provider_status: event.providerStatus,
          p_occurred_at: event.occurredAt,
          p_dedupe_key: event.dedupeKey,
          p_source: event.source,
          p_note: event.note,
        },
        eventResultSchema,
      ),

    cancel: (caller, shipmentId, reason, providerConfirmed) =>
      as(caller)(
        'admin_cancel_shipment',
        { p_shipment_id: shipmentId, p_reason: reason, p_provider_confirmed: providerConfirmed },
        shipmentSchema,
      ),

    async requestSync(caller, shipmentId) {
      await as(caller)('admin_request_shipment_sync', { p_shipment_id: shipmentId }, none);
    },

    listShipments: (caller, filters, page) =>
      as(caller)(
        'admin_list_shipments',
        {
          p_status: filters.status,
          p_provider: filters.provider,
          p_kind: filters.kind,
          p_query: filters.query,
          p_from: filters.from,
          p_to: filters.to,
          p_include_mock: filters.includeMock,
          p_limit: page.limit,
          p_offset: page.offset,
        },
        shipmentListSchema,
      ),

    getShipment: (caller, shipmentId) =>
      as(caller)('admin_get_shipment', { p_shipment_id: shipmentId }, shipmentDetailResponseSchema),

    overview: (caller, includeMock) =>
      as(caller)('admin_courier_overview', { p_include_mock: includeMock }, dbOverviewSchema),

    orderShipments: (caller, orderNumber) =>
      as(caller)('admin_order_shipments', { p_order_number: orderNumber }, historySchema),

    returnShipments: (caller, returnId) =>
      as(caller)('admin_return_shipments', { p_return_id: returnId }, historySchema),

    codPositions: (caller, filters, page) =>
      as(caller)(
        'admin_cod_positions',
        {
          p_provider: filters.provider,
          p_status: filters.status,
          p_include_mock: filters.includeMock,
          p_limit: page.limit,
          p_offset: page.offset,
        },
        codPositionsSchema,
      ),

    async recordCodCollected(caller, shipmentId, input) {
      await as(caller)(
        'admin_record_cod_collected',
        {
          p_shipment_id: shipmentId,
          p_amount_minor: input.amountMinor,
          p_evidence_ref: input.evidenceRef,
          p_note: input.note ?? null,
        },
        none,
      );
    },

    recordSettlement: (caller, input) =>
      as(caller)(
        'admin_record_courier_settlement',
        {
          p_provider: input.provider,
          p_reference: input.reference,
          p_amount_minor: input.amountMinor,
          p_received_on: input.receivedOn,
          p_note: input.note ?? null,
          p_items: input.lines,
          p_is_mock: input.isMock ?? false,
        },
        uuidValueSchema,
      ),

    async recordCodAdjustment(caller, shipmentId, input) {
      await as(caller)(
        'admin_record_cod_adjustment',
        { p_shipment_id: shipmentId, p_amount_minor: input.amountMinor, p_note: input.note },
        none,
      );
    },

    async setCodState(caller, shipmentId, input) {
      await as(caller)(
        'admin_set_cod_state',
        { p_shipment_id: shipmentId, p_state: input.state, p_note: input.note ?? null },
        none,
      );
    },

    listSettlements: (caller, filters, page) =>
      as(caller)(
        'admin_list_courier_settlements',
        {
          p_provider: filters.provider,
          p_include_mock: filters.includeMock,
          p_limit: page.limit,
          p_offset: page.offset,
        },
        settlementListSchema,
      ),

    myOrderShipments: (caller, orderNumber) =>
      as(caller)('my_order_shipments', { p_order_number: orderNumber }, customerShipmentsSchema),

    bookingPayload: (shipmentId) =>
      server(
        'service_shipment_booking_payload',
        { p_shipment_id: shipmentId },
        bookingPayloadSchema.nullable(),
      ),

    serviceRecordEvent: (shipmentId, event) =>
      server(
        'service_record_shipment_event',
        {
          p_shipment_id: shipmentId,
          p_status: event.status,
          p_provider_status: event.providerStatus,
          p_occurred_at: event.occurredAt,
          p_dedupe_key: event.dedupeKey,
          p_source: event.source,
        },
        eventResultSchema,
      ),

    async claimSync(limit, leaseSeconds) {
      const rows = await server(
        'service_claim_shipment_sync',
        { p_limit: limit, p_lease_seconds: leaseSeconds },
        syncRowsSchema,
      );
      return rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        status: row.status,
        consignmentId: row.consignment_id,
        trackingCode: row.tracking_code,
        merchantRef: row.merchant_ref,
        isMock: row.is_mock,
        syncAttempts: row.sync_attempts,
      }));
    },

    async finishSync(shipmentId, ok, error, nextInSeconds) {
      await server(
        'service_finish_shipment_sync',
        { p_shipment_id: shipmentId, p_ok: ok, p_error: error, p_next_in_seconds: nextInSeconds },
        none,
      );
    },

    storeWebhook: (record) =>
      server(
        'service_store_courier_webhook',
        {
          p_provider: record.provider,
          p_dedupe_key: record.dedupeKey,
          p_event_type: record.eventType,
          p_consignment_id: record.consignmentId,
          p_merchant_ref: record.merchantRef,
          p_signature_ok: record.signatureOk,
          p_payload: record.payload,
        },
        storedWebhookSchema,
      ),

    findShipment: (provider, consignmentId, merchantRef) =>
      server(
        'service_find_shipment',
        { p_provider: provider, p_consignment_id: consignmentId, p_merchant_ref: merchantRef },
        uuidValueSchema.nullable(),
      ),

    async finishWebhook(id, status, error, shipmentId) {
      await server(
        'service_finish_courier_webhook',
        { p_id: id, p_status: status, p_error: error, p_shipment_id: shipmentId },
        none,
      );
    },

    async claimWebhookRetries(limit) {
      const rows = await server(
        'service_claim_courier_webhook_retries',
        { p_limit: limit },
        webhookRetryRowsSchema,
      );
      return rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        eventType: row.event_type,
        consignmentId: row.consignment_id,
        merchantRef: row.merchant_ref,
        payload: row.payload,
        attempts: row.attempts,
      }));
    },
  };
}

type RpcCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { code: string; message: string; details?: string | null } | null;
}>;

export function createSupabaseCourierStore(clients: SupabaseClients): CourierStore {
  const asUser = supabaseRpc(clients);
  const admin = clients.admin.rpc.bind(clients.admin) as unknown as RpcCall;
  const serviceRpc: Rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin(name, args);
    if (error) throw toAdminStoreError(error, name);
    return data as T;
  };
  return courierStoreOver((caller) => asUser(caller.accessToken), serviceRpc);
}

export function createPostgresCourierStore(pool: Pool): CourierStore {
  // The courier functions declare no defaults for their nullable arguments: nulls are sent.
  const asUser = postgresRpc(pool, toAdminStoreError, { keepNulls: true });
  return courierStoreOver(
    (caller) => asUser(caller.userId),
    postgresServiceRpc(pool, toAdminStoreError, { keepNulls: true }),
  );
}
