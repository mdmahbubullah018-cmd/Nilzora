import { randomUUID } from 'node:crypto';
import {
  COURIER_LIVE_CONFIRMATION,
  type CourierRateCard,
  type CustomerShipment,
  type Permission,
  type Shipment,
  type ShipmentStatus,
} from '@nilzora/contracts';
import { toAdminStoreError } from '../modules/admin/errors';
import type {
  BeginResult,
  BookingPayload,
  CourierCaller,
  CourierOperationsInput,
  CourierRuntimeSettings,
  CourierStore,
  DbCourierConfig,
  EventResult,
  ShipmentEventInput,
  SyncClaim,
  WebhookRetry,
} from '../modules/couriers/store';
import type { QuoteDraft } from '../modules/couriers/pricing';
import type { FakeIdentity } from './fakes';

/*
 * An in-memory stand-in for the courier functions of 20261223091000_courier_foundation.sql,
 * for route and service tests. It checks the CALLER's permissions as the functions do and
 * refuses with their SQLSTATEs (through toAdminStoreError, like the real stores). The real
 * SQL is covered by supabase/tests/couriers.test.sql.
 */

/** private.courier_credential_fields */
const CREDENTIAL_FIELDS = {
  steadfast: ['api_key', 'secret_key', 'webhook_token'],
  pathao: ['client_id', 'client_secret', 'username', 'password', 'webhook_secret'],
} as const satisfies Record<string, readonly string[]>;

function raise(code: string): never {
  throw toAdminStoreError(
    { code, message: 'internal detail from the fake', details: null },
    'fake',
  );
}

/** private.shipment_transition_ok */
export function transitionOk(from: ShipmentStatus, to: ShipmentStatus): boolean {
  if (to === from || to === 'unknown') return false;
  if (['booking_failed', 'cancelled', 'returned', 'delivered'].includes(from)) return false;
  if (from === 'draft' || from === 'quoted')
    return ['quoted', 'booking_pending', 'cancelled'].includes(to);
  if (from === 'booking_pending') return ['booked', 'booking_failed', 'cancelled'].includes(to);
  if (from === 'booked')
    return !['draft', 'quoted', 'booking_pending', 'booking_failed'].includes(to);
  if (from === 'pickup_pending') {
    return !['draft', 'quoted', 'booking_pending', 'booking_failed', 'booked'].includes(to);
  }
  if (
    ['picked_up', 'in_transit', 'on_hold', 'out_for_delivery', 'delivery_failed'].includes(from)
  ) {
    return [
      'in_transit',
      'on_hold',
      'out_for_delivery',
      'delivery_failed',
      'delivered',
      'partially_delivered',
      'return_initiated',
      'returned',
      'cancelled',
    ].includes(to);
  }
  if (from === 'partially_delivered') return ['return_initiated', 'returned'].includes(to);
  if (from === 'return_initiated') return to === 'returned';
  return false;
}

export interface FakeCourierOrder {
  id: string;
  orderNumber: string;
  userId: string;
  status: string;
  paymentStatus: string;
  totalMinor: number;
  deliveryZone: 'inside_dhaka' | 'outside_dhaka';
}

interface FakeShipment extends Shipment {
  orderId: string;
  bookingKey: string;
  syncAttempts: number;
}

interface FakeEvent {
  id: number;
  shipmentId: string;
  status: ShipmentStatus;
  providerStatus: string | null;
  source: 'booking' | 'webhook' | 'poll' | 'manual' | 'system';
  occurredAt: string;
  recordedAt: string;
  dedupeKey: string;
  applied: boolean;
  note: string | null;
}

interface FakeWebhook {
  id: string;
  provider: string;
  dedupeKey: string;
  eventType: string | null;
  consignmentId: string | null;
  merchantRef: string | null;
  signatureOk: boolean;
  payload: Record<string, unknown>;
  status: 'pending' | 'processed' | 'ignored' | 'failed';
  attempts: number;
  shipmentId: string | null;
}

/** One courier_accounts row as the fake keeps it. */
interface FakeProviderRow {
  provider: string;
  displayName: string;
  isEnabled: boolean;
  settings: Record<string, string | number | boolean | null>;
  codFeeBp: number | null;
  returnChargeMinor: number | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckMode: 'mock' | 'live' | null;
  lastCheckMessage: string | null;
  apiBaseUrl: string | null;
  liveVerifiedAt: string | null;
}

export class FakeCouriers implements CourierStore {
  /** Milliseconds since the epoch; tests move it forward. */
  clock = Date.parse('2026-11-14T08:00:00.000Z');
  readonly calls: string[] = [];
  /** The next call fails with this SQLSTATE (a code outside the map is a 503). */
  nextFailure: string | undefined;

  settings = {
    defaultParcelWeightGrams: 500,
    quoteValidityMinutes: 30,
    preferredProvider: null as string | null,
    minHistorySample: 20,
  };
  /** courier_settings' operating switches (safe defaults: off, nothing booked or synced). */
  operations = {
    mode: 'off' as 'off' | 'mock' | 'live',
    bookingEnabled: false,
    trackingSyncEnabled: false,
    trackingSyncIntervalSeconds: 300,
    httpTimeoutMs: 15_000,
    liveBookingConfirmedAt: null as string | null,
  };
  readonly providers = (['pathao', 'steadfast'] as const).map((provider): FakeProviderRow => ({
    provider,
    displayName: provider === 'pathao' ? 'Pathao Courier' : 'Steadfast Courier',
    isEnabled: false,
    settings: {},
    codFeeBp: null,
    returnChargeMinor: null,
    lastCheckAt: null,
    lastCheckOk: null,
    lastCheckMode: null,
    lastCheckMessage: null,
    apiBaseUrl: null,
    liveVerifiedAt: null,
  }));
  /** Supabase Vault, by `provider/field`: written, never read back to staff. */
  readonly vault = new Map<string, { value: string; setAt: string }>();
  readonly locationMappings: {
    id: string;
    provider: string;
    district: string;
    area: string;
    destination: Record<string, unknown>;
    label: string | null;
    updatedAt: string;
  }[] = [];
  readonly rateCards: CourierRateCard[] = [];
  readonly orders: FakeCourierOrder[] = [];
  readonly returns = new Map<string, { orderNumber: string; status: string }>();
  readonly quotes: (QuoteDraft & {
    id: string;
    orderNumber: string;
    quotedAt: string;
    expiresAt: string;
  })[] = [];
  readonly shipments: FakeShipment[] = [];
  readonly events: FakeEvent[] = [];
  readonly webhooks: FakeWebhook[] = [];
  readonly stats = new Map<string, { settled: number; delivered: number; failed: number }>();
  readonly syncFinishes: { id: string; ok: boolean; error: string | null; nextIn: number }[] = [];
  private sequence = 0;

  constructor(private readonly identity: FakeIdentity) {}

  private iso(): string {
    return new Date(this.clock).toISOString();
  }

  private enter(name: string): void {
    this.calls.push(name);
    const failure = this.nextFailure;
    if (failure) {
      this.nextFailure = undefined;
      raise(failure);
    }
  }

  private perms(caller: CourierCaller): ReadonlySet<Permission> {
    const user = this.identity.userFor(caller.accessToken);
    if (!user || user.id !== caller.userId) raise('42501');
    return this.identity.permissionsOf(user);
  }

  private requireAny(caller: CourierCaller, ...permissions: Permission[]): void {
    const held = this.perms(caller);
    if (!permissions.some((p) => held.has(p))) raise('NZ403');
  }

  private order(orderNumber: string): FakeCourierOrder {
    const order = this.orders.find((row) => row.orderNumber === orderNumber);
    if (!order) raise('NZ404');
    return order;
  }

  private shipment(id: string): FakeShipment {
    const shipment = this.shipments.find((row) => row.id === id);
    if (!shipment) raise('NZ404');
    return shipment;
  }

  private json(shipment: FakeShipment, costs: boolean): Shipment {
    const { orderId: _o, bookingKey: _b, syncAttempts: _s, ...rest } = shipment;
    return costs ? { ...rest } : { ...rest, expectedChargeMinor: null, expectedCodFeeMinor: null };
  }

  private eventsOf(id: string) {
    return this.events
      .filter((event) => event.shipmentId === id)
      .map(({ shipmentId: _s, dedupeKey: _d, ...event }) => event);
  }

  addOrder(userId: string, options: Partial<FakeCourierOrder> = {}): FakeCourierOrder {
    this.sequence += 1;
    const order: FakeCourierOrder = {
      id: randomUUID(),
      orderNumber: `NZ${String(200_000 + this.sequence)}`,
      userId,
      status: 'confirmed',
      paymentStatus: 'pending',
      totalMinor: 160_000,
      deliveryZone: 'inside_dhaka',
      ...options,
    };
    this.orders.push(order);
    return order;
  }

  addReturn(orderNumber: string, status = 'approved'): string {
    const id = randomUUID();
    this.returns.set(id, { orderNumber, status });
    return id;
  }

  /** private.shipment_apply_event */
  applyEvent(
    shipmentId: string,
    status: ShipmentStatus,
    providerStatus: string | null,
    source: FakeEvent['source'],
    occurredAt: string | null,
    dedupeKey: string,
    note: string | null,
  ): EventResult {
    const shipment = this.shipment(shipmentId);
    const existing = this.events.find((event) => event.dedupeKey === dedupeKey);
    if (existing) {
      if (existing.shipmentId !== shipmentId) raise('NZ412');
      return { eventId: existing.id, applied: existing.applied, duplicate: true };
    }
    const at = occurredAt ?? this.iso();
    const applied =
      transitionOk(shipment.status, status) &&
      (shipment.lastEventAt === null || Date.parse(at) >= Date.parse(shipment.lastEventAt));
    const id = this.events.length + 1;
    this.events.push({
      id,
      shipmentId,
      status,
      providerStatus,
      source,
      occurredAt: at,
      recordedAt: this.iso(),
      dedupeKey,
      applied,
      note,
    });
    if (applied) {
      shipment.status = status;
      shipment.lastEventAt = at;
      if (providerStatus) shipment.providerStatus = providerStatus;
      if (status === 'picked_up') shipment.pickedUpAt ??= at;
      if (status === 'delivered' || status === 'partially_delivered') shipment.deliveredAt = at;
      if (status === 'cancelled') {
        shipment.cancelledAt = at;
        shipment.cancelReason ??= note ?? 'Cancelled by the courier';
      }
      if (['delivered', 'returned', 'cancelled', 'booking_failed'].includes(status)) {
        shipment.nextSyncAt = null;
      }
    }
    return { eventId: id, applied, duplicate: false };
  }

  config(caller: CourierCaller): Promise<DbCourierConfig> {
    this.enter('admin_courier_config');
    this.requireAny(caller, 'couriers.read', 'shipments.read');
    const updatedAt = '2026-11-01T08:00:00.000Z';
    return Promise.resolve({
      settings: { ...this.settings, updatedAt },
      operations: { ...this.operations },
      providers: this.providers.map((row) => ({
        ...row,
        updatedAt,
        credentialFields: [...CREDENTIAL_FIELDS[row.provider as 'pathao' | 'steadfast']],
        credentials: [...this.vault.entries()]
          .filter(([key]) => key.startsWith(`${row.provider}/`))
          .map(([key, entry]) => ({ field: key.split('/')[1] ?? '', setAt: entry.setAt }))
          .sort((a, b) => a.field.localeCompare(b.field)),
      })),
      rateCards: [...this.rateCards],
      locationMappings: [...this.locationMappings],
    });
  }

  /** admin_save_courier_operations */
  saveOperations(caller: CourierCaller, input: CourierOperationsInput) {
    this.enter('admin_save_courier_operations');
    this.requireAny(caller, 'couriers.configure');
    const old = this.operations;
    const goingLive =
      (input.mode === 'live' && old.mode !== 'live') ||
      (input.mode === 'live' &&
        input.bookingEnabled &&
        !(old.mode === 'live' && old.bookingEnabled));
    if (goingLive && (input.confirmation ?? '').trim() !== COURIER_LIVE_CONFIRMATION) {
      raise('NZ611');
    }
    this.operations = {
      mode: input.mode,
      bookingEnabled: input.bookingEnabled,
      trackingSyncEnabled: input.trackingSyncEnabled,
      trackingSyncIntervalSeconds: input.trackingSyncIntervalSeconds,
      httpTimeoutMs: input.httpTimeoutMs,
      liveBookingConfirmedAt:
        input.mode === 'live' && input.bookingEnabled
          ? goingLive
            ? this.iso()
            : old.liveBookingConfirmedAt
          : null,
    };
    return Promise.resolve();
  }

  private account(provider: string) {
    const row = this.providers.find((p) => p.provider === provider);
    if (!row) raise('NZ600');
    return row;
  }

  /** admin_set_courier_credential */
  setCredential(caller: CourierCaller, provider: string, field: string, value: string) {
    this.enter('admin_set_courier_credential');
    this.requireAny(caller, 'couriers.configure');
    const row = this.account(provider);
    const fields: readonly string[] = CREDENTIAL_FIELDS[provider as 'pathao' | 'steadfast'];
    if (!fields.includes(field)) raise('NZ412');
    if (value.trim().length < 1 || value.trim().length > 1000) raise('NZ412');
    this.vault.set(`${provider}/${field}`, { value: value.trim(), setAt: this.iso() });
    row.liveVerifiedAt = null;
    return Promise.resolve();
  }

  /** admin_clear_courier_credential */
  clearCredential(caller: CourierCaller, provider: string, field: string) {
    this.enter('admin_clear_courier_credential');
    this.requireAny(caller, 'couriers.configure');
    if (!this.vault.delete(`${provider}/${field}`)) raise('NZ404');
    this.account(provider).liveVerifiedAt = null;
    return Promise.resolve();
  }

  /** admin_save_courier_api_base_url */
  saveBaseUrl(caller: CourierCaller, provider: string, url: string | null) {
    this.enter('admin_save_courier_api_base_url');
    this.requireAny(caller, 'couriers.configure');
    if (url !== null && !/^https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9._~/-]*)?$/.test(url)) raise('NZ412');
    const row = this.account(provider);
    if (row.apiBaseUrl !== url) row.liveVerifiedAt = null;
    row.apiBaseUrl = url;
    return Promise.resolve();
  }

  /** admin_set_courier_live_verified */
  setLiveVerified(
    caller: CourierCaller,
    provider: string,
    verified: boolean,
    confirmation: string | null,
  ) {
    this.enter('admin_set_courier_live_verified');
    this.requireAny(caller, 'couriers.configure');
    const row = this.account(provider);
    if (verified) {
      if ((confirmation ?? '').trim() !== `VERIFY ${provider.toUpperCase()}`) raise('NZ611');
      const recent =
        row.lastCheckOk === true &&
        row.lastCheckMode === 'live' &&
        row.lastCheckAt !== null &&
        Date.parse(row.lastCheckAt) >= this.clock - 24 * 3_600_000;
      if (!recent) raise('NZ612');
    }
    row.liveVerifiedAt = verified ? this.iso() : null;
    return Promise.resolve();
  }

  /** admin_delete_courier_location_mapping */
  deleteLocationMapping(caller: CourierCaller, id: string) {
    this.enter('admin_delete_courier_location_mapping');
    this.requireAny(caller, 'shipments.create', 'shipments.returns.manage');
    const index = this.locationMappings.findIndex((m) => m.id === id);
    if (index < 0) raise('NZ404');
    this.locationMappings.splice(index, 1);
    return Promise.resolve();
  }

  /** service_courier_runtime */
  runtime(): Promise<CourierRuntimeSettings> {
    this.enter('service_courier_runtime');
    return Promise.resolve({
      mode: this.operations.mode,
      bookingEnabled: this.operations.bookingEnabled,
      trackingSyncEnabled: this.operations.trackingSyncEnabled,
      trackingSyncIntervalSeconds: this.operations.trackingSyncIntervalSeconds,
      httpTimeoutMs: this.operations.httpTimeoutMs,
      providers: this.providers.map((row) => ({
        provider: row.provider,
        isEnabled: row.isEnabled,
        apiBaseUrl: row.apiBaseUrl,
        liveVerified: row.liveVerifiedAt !== null,
        credentialFields: [...this.vault.keys()]
          .filter((key) => key.startsWith(`${row.provider}/`))
          .map((key) => key.split('/')[1] ?? '')
          .sort(),
      })),
    });
  }

  /** service_courier_credentials */
  credentials(provider: string): Promise<Record<string, string>> {
    this.enter('service_courier_credentials');
    return Promise.resolve(
      Object.fromEntries(
        [...this.vault.entries()]
          .filter(([key]) => key.startsWith(`${provider}/`))
          .map(([key, entry]) => [key.split('/')[1] ?? '', entry.value]),
      ),
    );
  }

  /** private.courier_require_api_booking */
  private requireApiBooking(provider: string, isMock: boolean): void {
    if (isMock) {
      if (this.operations.mode !== 'mock') raise('NZ600');
      return;
    }
    if (this.operations.mode !== 'live' || !this.operations.bookingEnabled) raise('NZ600');
    const row = this.providers.find((p) => p.provider === provider);
    if (!row || !row.isEnabled || row.liveVerifiedAt === null) raise('NZ600');
  }

  saveSettings(caller: CourierCaller, input: Parameters<CourierStore['saveSettings']>[1]) {
    this.enter('admin_save_courier_settings');
    this.requireAny(caller, 'couriers.configure');
    this.settings = { ...input };
    return Promise.resolve();
  }

  saveProvider(
    caller: CourierCaller,
    provider: string,
    input: Parameters<CourierStore['saveProvider']>[2],
  ) {
    this.enter('admin_save_courier_provider');
    this.requireAny(caller, 'couriers.configure');
    const row = this.providers.find((p) => p.provider === provider);
    if (!row) raise('NZ600');
    row.isEnabled = input.isEnabled;
    row.settings = input.settings ?? {};
    row.codFeeBp = input.codFeeBp;
    row.returnChargeMinor = input.returnChargeMinor;
    return Promise.resolve();
  }

  recordCheck(
    caller: CourierCaller,
    provider: string,
    check: { ok: boolean; mode: 'mock' | 'live'; message: string },
  ) {
    this.enter('admin_record_courier_check');
    this.requireAny(caller, 'couriers.configure');
    const row = this.providers.find((p) => p.provider === provider);
    if (!row) raise('NZ600');
    row.lastCheckAt = this.iso();
    row.lastCheckOk = check.ok;
    row.lastCheckMode = check.mode;
    row.lastCheckMessage = check.message;
    return Promise.resolve();
  }

  saveRateCard(
    caller: CourierCaller,
    id: string | null,
    input: Parameters<CourierStore['saveRateCard']>[2],
  ) {
    this.enter('admin_save_courier_rate_card');
    this.requireAny(caller, 'couriers.pricing.manage');
    const clash = this.rateCards.find(
      (card) =>
        card.id !== id &&
        card.provider === input.provider &&
        card.zone === input.zone &&
        card.weightUpToGrams === input.weightUpToGrams,
    );
    if (clash) raise('NZ412');
    const card: CourierRateCard = {
      id: id ?? randomUUID(),
      provider: input.provider,
      zone: input.zone,
      weightUpToGrams: input.weightUpToGrams,
      chargeMinor: input.chargeMinor,
      isActive: input.isActive ?? true,
      updatedAt: this.iso(),
    };
    if (id !== null) {
      const index = this.rateCards.findIndex((row) => row.id === id);
      if (index < 0) raise('NZ404');
      this.rateCards[index] = card;
    } else {
      this.rateCards.push(card);
    }
    return Promise.resolve(card.id);
  }

  deleteRateCard(caller: CourierCaller, id: string) {
    this.enter('admin_delete_courier_rate_card');
    this.requireAny(caller, 'couriers.pricing.manage');
    const index = this.rateCards.findIndex((row) => row.id === id);
    if (index < 0) raise('NZ404');
    this.rateCards.splice(index, 1);
    return Promise.resolve();
  }

  saveLocationMapping(caller: CourierCaller) {
    this.enter('admin_save_courier_location_mapping');
    this.requireAny(caller, 'shipments.create', 'shipments.returns.manage');
    return Promise.resolve();
  }

  orderContext(caller: CourierCaller, orderNumber: string) {
    this.enter('admin_order_courier_context');
    this.requireAny(caller, 'shipments.read');
    const costs = this.perms(caller).has('couriers.cod.read');
    const order = this.order(orderNumber);
    const active = this.shipments.some(
      (s) =>
        s.orderId === order.id &&
        s.kind === 'forward' &&
        !['cancelled', 'booking_failed', 'returned'].includes(s.status),
    );
    const reason = !['confirmed', 'processing', 'shipped'].includes(order.status)
      ? ('order_status' as const)
      : active
        ? ('active_shipment' as const)
        : null;
    return Promise.resolve({
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalMinor: order.totalMinor,
        codDueMinor: order.paymentStatus === 'pending' ? order.totalMinor : 0,
        shippingFeeMinor: 6_000,
        deliveryZone: order.deliveryZone,
        division: 'Dhaka',
        district: 'Dhaka',
        area: 'Dhanmondi',
        itemCount: 1,
        placedAt: '2026-11-10T08:00:00.000Z',
      },
      bookable: reason === null,
      notBookableReason: reason,
      defaultParcelWeightGrams: this.settings.defaultParcelWeightGrams,
      shipments: this.shipments
        .filter((s) => s.orderId === order.id)
        .map((s) => this.json(s, costs)),
      quotes: this.quotes
        .filter((q) => q.orderNumber === orderNumber && Date.parse(q.expiresAt) > this.clock)
        .map(({ orderNumber: _n, ...q }) => ({ ...q, details: q.details })),
      locationMappings: [],
    });
  }

  recordQuotes(caller: CourierCaller, orderNumber: string, quotes: readonly QuoteDraft[]) {
    this.enter('admin_record_courier_quotes');
    this.requireAny(caller, 'shipments.create', 'shipments.returns.manage');
    this.order(orderNumber);
    if (quotes.length < 1 || quotes.length > 10) raise('NZ412');
    return Promise.resolve(
      quotes.map((quote) => {
        const id = randomUUID();
        this.quotes.push({
          ...quote,
          id,
          orderNumber,
          quotedAt: this.iso(),
          expiresAt: new Date(
            this.clock + this.settings.quoteValidityMinutes * 60_000,
          ).toISOString(),
        });
        return { provider: quote.provider, id };
      }),
    );
  }

  providerStats(caller: CourierCaller) {
    this.enter('admin_courier_provider_stats');
    this.requireAny(caller, 'couriers.read', 'shipments.read');
    return Promise.resolve(
      this.providers.map((row) => ({
        provider: row.provider,
        ...(this.stats.get(row.provider) ?? { settled: 0, delivered: 0, failed: 0 }),
      })),
    );
  }

  private begin(
    actor: string,
    order: FakeCourierOrder,
    kind: Shipment['kind'],
    returnId: string | null,
    input: {
      bookingKey: string;
      provider: string;
      quoteId: string | null;
      weightGrams: number;
      codAmountMinor: number;
      note: string | null;
      recommendedProvider: string | null;
      selectionReason: string | null;
      destination: Record<string, unknown>;
      isMock: boolean;
    },
  ): BeginResult {
    const existing = this.shipments.find((s) => s.bookingKey === input.bookingKey);
    if (existing) {
      if (
        existing.orderId !== order.id ||
        existing.provider !== input.provider ||
        existing.kind !== kind
      ) {
        raise('NZ412');
      }
      return { shipment: this.json(existing, false), shouldCall: false, duplicate: true };
    }
    const account = this.providers.find((p) => p.provider === input.provider);
    if (!account || (!input.isMock && !account.isEnabled)) raise('NZ600');
    if (
      input.recommendedProvider !== null &&
      input.recommendedProvider !== input.provider &&
      (input.selectionReason ?? '').trim().length < 3
    ) {
      raise('NZ606');
    }
    let quote: (typeof this.quotes)[number] | undefined;
    if (input.quoteId !== null) {
      quote = this.quotes.find((q) => q.id === input.quoteId);
      if (
        !quote ||
        quote.orderNumber !== order.orderNumber ||
        quote.provider !== input.provider ||
        !quote.available ||
        quote.isMock !== input.isMock ||
        Date.parse(quote.expiresAt) <= this.clock
      ) {
        raise('NZ603');
      }
    }
    const active = this.shipments.some((s) =>
      kind === 'forward'
        ? s.orderId === order.id &&
          s.kind === 'forward' &&
          !['cancelled', 'booking_failed', 'returned'].includes(s.status)
        : s.returnRequestId === returnId &&
          s.kind === kind &&
          !['cancelled', 'booking_failed'].includes(s.status),
    );
    if (active) raise('NZ602');
    const sequence =
      this.shipments.filter((s) => s.orderId === order.id && s.kind === kind).length + 1;
    const now = this.iso();
    const shipment: FakeShipment = {
      id: randomUUID(),
      orderId: order.id,
      bookingKey: input.bookingKey,
      syncAttempts: 0,
      orderNumber: order.orderNumber,
      kind,
      returnRequestId: returnId,
      parentShipmentId: null,
      provider: input.provider,
      providerName: account.displayName,
      status: 'booking_pending',
      isMock: input.isMock,
      merchantRef: `${order.orderNumber}-${kind === 'forward' ? 'F' : kind === 'return_pickup' ? 'R' : 'X'}${sequence}`,
      consignmentId: null,
      trackingCode: null,
      trackingUrl: null,
      weightGrams: input.weightGrams,
      codAmountMinor: input.codAmountMinor,
      deliveryZone: order.deliveryZone,
      destination: input.destination,
      note: input.note,
      quoteId: input.quoteId,
      recommendedProvider: input.recommendedProvider,
      selectionReason: input.selectionReason,
      expectedChargeMinor: quote?.deliveryChargeMinor ?? null,
      expectedCodFeeMinor: quote?.codFeeMinor ?? null,
      providerStatus: null,
      bookingUncertain: false,
      bookingError: null,
      providerCallStartedAt: now,
      bookedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      cancelledAt: null,
      cancelReason: null,
      lastEventAt: null,
      nextSyncAt: null,
      syncError: null,
      codState: 'open',
      createdAt: now,
      updatedAt: now,
    };
    void actor;
    this.shipments.push(shipment);
    return { shipment: this.json(shipment, false), shouldCall: true, duplicate: false };
  }

  beginBooking(
    caller: CourierCaller,
    orderNumber: string,
    input: Parameters<CourierStore['beginBooking']>[2],
  ) {
    this.enter('admin_begin_shipment_booking');
    this.requireAny(caller, 'shipments.create');
    const order = this.order(orderNumber);
    const known = this.shipments.some((s) => s.bookingKey === input.bookingKey);
    if (!known) this.requireApiBooking(input.provider, input.isMock);
    if (!known && !['confirmed', 'processing', 'shipped'].includes(order.status)) raise('NZ601');
    return Promise.resolve(
      this.begin(caller.userId, order, 'forward', null, {
        ...input,
        codAmountMinor: order.paymentStatus === 'pending' ? order.totalMinor : 0,
      }),
    );
  }

  private returnBegin(
    caller: CourierCaller,
    returnId: string,
    kind: 'return_pickup' | 'exchange',
    input: Parameters<CourierStore['beginReturnPickup']>[2],
  ): Promise<BeginResult> {
    this.requireAny(caller, 'shipments.returns.manage');
    const request = this.returns.get(returnId);
    if (!request) raise('NZ404');
    const known = this.shipments.some((s) => s.bookingKey === input.bookingKey);
    if (!known) this.requireApiBooking(input.provider, input.isMock);
    const allowed = kind === 'return_pickup' ? ['approved'] : ['approved', 'received', 'completed'];
    if (!known && !allowed.includes(request.status)) raise('NZ607');
    return Promise.resolve(
      this.begin(caller.userId, this.order(request.orderNumber), kind, returnId, {
        ...input,
        quoteId: null,
        recommendedProvider: null,
        selectionReason: null,
        codAmountMinor: kind === 'exchange' ? (input.codAmountMinor ?? 0) : 0,
      }),
    );
  }

  beginReturnPickup(
    caller: CourierCaller,
    returnId: string,
    input: Parameters<CourierStore['beginReturnPickup']>[2],
  ) {
    this.enter('admin_begin_return_pickup');
    return this.returnBegin(caller, returnId, 'return_pickup', input);
  }

  beginExchange(
    caller: CourierCaller,
    returnId: string,
    input: Parameters<CourierStore['beginExchange']>[2],
  ) {
    this.enter('admin_begin_exchange_shipment');
    return this.returnBegin(caller, returnId, 'exchange', input);
  }

  /** admin_record_portal_booking (20261223092000_courier_portal_booking.sql). */
  recordPortalBooking(
    caller: CourierCaller,
    orderNumber: string,
    input: Parameters<CourierStore['recordPortalBooking']>[2],
  ): Promise<Shipment> {
    this.enter('admin_record_portal_booking');
    this.requireAny(
      caller,
      input.returnId === null ? 'shipments.create' : 'shipments.returns.manage',
    );
    const consignment = input.consignmentId.trim();
    if (consignment === '' || consignment.length > 80) raise('NZ412');
    if (input.note.trim().length < 5 || input.note.trim().length > 300) raise('NZ412');
    const order = this.order(orderNumber);
    const known = this.shipments.some((s) => s.bookingKey === input.bookingKey);
    // A real parcel may be recorded in any mode; a test one only in test mode.
    if (!known && input.isMock && this.operations.mode !== 'mock') raise('NZ600');
    const common = {
      bookingKey: input.bookingKey,
      provider: input.provider,
      quoteId: null,
      weightGrams: input.weightGrams,
      note: input.note.trim(),
      destination: {},
      isMock: input.isMock,
    };
    let begun: BeginResult;
    if (input.returnId === null) {
      if (!known && !['confirmed', 'processing', 'shipped'].includes(order.status)) raise('NZ601');
      begun = this.begin(caller.userId, order, 'forward', null, {
        ...common,
        codAmountMinor: order.paymentStatus === 'pending' ? order.totalMinor : 0,
        recommendedProvider: input.recommendedProvider,
        selectionReason: input.selectionReason,
      });
    } else {
      const request = this.returns.get(input.returnId);
      if (!request || request.orderNumber !== orderNumber) raise('NZ404');
      if (!known && request.status !== 'approved') raise('NZ607');
      begun = this.begin(caller.userId, order, 'return_pickup', input.returnId, {
        ...common,
        codAmountMinor: 0,
        recommendedProvider: null,
        selectionReason: null,
      });
    }
    const shipment = this.shipment(begun.shipment.id);
    if (begun.shouldCall) {
      shipment.providerCallStartedAt = null;
      this.markBooked(shipment, consignment, input.trackingCode);
      shipment.expectedChargeMinor = input.chargeMinor ?? shipment.expectedChargeMinor;
    }
    return Promise.resolve(this.json(shipment, this.perms(caller).has('couriers.cod.read')));
  }

  private bookPermission(shipment: FakeShipment): Permission {
    return shipment.kind === 'forward' ? 'shipments.create' : 'shipments.returns.manage';
  }

  private markBooked(shipment: FakeShipment, consignmentId: string, trackingCode: string | null) {
    if (
      this.shipments.some(
        (s) =>
          s !== shipment && s.provider === shipment.provider && s.consignmentId === consignmentId,
      )
    ) {
      raise('NZ412');
    }
    shipment.consignmentId = consignmentId;
    shipment.trackingCode = trackingCode;
    shipment.bookingUncertain = false;
    shipment.bookingError = null;
    shipment.bookedAt = this.iso();
    shipment.nextSyncAt = new Date(this.clock + 15 * 60_000).toISOString();
    this.applyEvent(
      shipment.id,
      'booked',
      null,
      'booking',
      this.iso(),
      `booking:${shipment.id}:booked`,
      null,
    );
  }

  finishBooking(
    caller: CourierCaller,
    shipmentId: string,
    input: Parameters<CourierStore['finishBooking']>[2],
  ) {
    this.enter('admin_finish_shipment_booking');
    const shipment = this.shipment(shipmentId);
    this.requireAny(caller, this.bookPermission(shipment));
    if (shipment.status !== 'booking_pending') return Promise.resolve(this.json(shipment, false));
    if (input.outcome === 'booked') {
      if (!input.consignmentId) raise('NZ412');
      this.markBooked(shipment, input.consignmentId, input.trackingCode);
      shipment.trackingUrl = input.trackingUrl;
      shipment.expectedChargeMinor = input.chargeMinor ?? shipment.expectedChargeMinor;
    } else if (input.outcome === 'failed') {
      shipment.bookingError = input.error ?? 'The courier refused the booking';
      this.applyEvent(
        shipment.id,
        'booking_failed',
        null,
        'booking',
        this.iso(),
        `booking:${shipment.id}:failed`,
        input.error,
      );
    } else {
      shipment.bookingUncertain = true;
      shipment.bookingError = input.error ?? 'No clear answer from the courier';
    }
    return Promise.resolve(this.json(shipment, false));
  }

  resolveBooking(
    caller: CourierCaller,
    shipmentId: string,
    input: Parameters<CourierStore['resolveBooking']>[2],
  ) {
    this.enter('admin_resolve_shipment_booking');
    const shipment = this.shipment(shipmentId);
    this.requireAny(caller, this.bookPermission(shipment));
    const started = Date.parse(shipment.providerCallStartedAt ?? this.iso());
    if (
      shipment.status !== 'booking_pending' ||
      !(shipment.bookingUncertain || started < this.clock - 2 * 60_000)
    ) {
      raise('NZ605');
    }
    if (input.outcome === 'booked') {
      this.markBooked(shipment, input.consignmentId, input.trackingCode ?? null);
    } else {
      shipment.bookingUncertain = false;
      shipment.bookingError = input.note;
      this.applyEvent(
        shipment.id,
        'booking_failed',
        null,
        'manual',
        this.iso(),
        `booking:${shipment.id}:not_created`,
        input.note,
      );
    }
    return Promise.resolve(this.json(shipment, false));
  }

  recordEvent(
    caller: CourierCaller,
    shipmentId: string,
    event: ShipmentEventInput & { source: 'poll' | 'manual'; note: string | null },
  ) {
    this.enter('admin_record_shipment_event');
    this.requireAny(caller, 'shipments.track');
    if (['draft', 'quoted', 'booking_pending', 'booking_failed', 'booked'].includes(event.status))
      raise('NZ604');
    return Promise.resolve(
      this.applyEvent(
        shipmentId,
        event.status,
        event.providerStatus,
        event.source,
        event.occurredAt,
        event.dedupeKey,
        event.note,
      ),
    );
  }

  cancel(caller: CourierCaller, shipmentId: string, reason: string, providerConfirmed: boolean) {
    this.enter('admin_cancel_shipment');
    this.requireAny(caller, 'shipments.cancel');
    const shipment = this.shipment(shipmentId);
    if (!['booking_pending', 'booked', 'pickup_pending'].includes(shipment.status)) raise('NZ610');
    if (shipment.status === 'booking_pending' && shipment.bookingUncertain) raise('NZ605');
    if (shipment.status !== 'booking_pending' && !providerConfirmed) raise('NZ610');
    shipment.cancelReason = reason;
    this.applyEvent(
      shipment.id,
      'cancelled',
      null,
      'manual',
      this.iso(),
      `cancel:${shipment.id}`,
      reason,
    );
    return Promise.resolve(this.json(shipment, false));
  }

  requestSync(caller: CourierCaller, shipmentId: string) {
    this.enter('admin_request_shipment_sync');
    this.requireAny(caller, 'shipments.track');
    const shipment = this.shipment(shipmentId);
    if (
      ['delivered', 'returned', 'cancelled', 'booking_failed', 'booking_pending'].includes(
        shipment.status,
      )
    ) {
      raise('NZ604');
    }
    shipment.nextSyncAt = this.iso();
    return Promise.resolve();
  }

  listShipments(
    caller: CourierCaller,
    filters: Parameters<CourierStore['listShipments']>[1],
    page: { limit: number; offset: number },
  ) {
    this.enter('admin_list_shipments');
    this.requireAny(caller, 'shipments.read');
    const costs = this.perms(caller).has('couriers.cod.read');
    const rows = this.shipments.filter(
      (s) =>
        (filters.status === null || s.status === filters.status) &&
        (filters.provider === null || s.provider === filters.provider) &&
        (filters.kind === null || s.kind === filters.kind) &&
        (filters.includeMock || !s.isMock),
    );
    return Promise.resolve({
      total: rows.length,
      shipments: rows.slice(page.offset, page.offset + page.limit).map((s) => this.json(s, costs)),
    });
  }

  getShipment(caller: CourierCaller, shipmentId: string) {
    this.enter('admin_get_shipment');
    this.requireAny(caller, 'shipments.read');
    const costs = this.perms(caller).has('couriers.cod.read');
    const shipment = this.shipment(shipmentId);
    const position = {
      expectedMinor: shipment.consignmentId ? shipment.codAmountMinor : 0,
      collectedMinor: 0,
      deductionsMinor: 0,
      adjustmentsMinor: 0,
      expectedSettlementMinor: 0,
      settledMinor: 0,
      differenceMinor: 0,
      status: 'pending' as const,
      codState: shipment.codState,
    };
    return Promise.resolve({
      shipment: this.json(shipment, costs),
      events: this.eventsOf(shipment.id),
      ledger: costs ? [] : null,
      codPosition: costs ? position : null,
    });
  }

  overview(caller: CourierCaller, includeMock: boolean) {
    this.enter('admin_courier_overview');
    this.requireAny(caller, 'couriers.read', 'shipments.read');
    const costs = this.perms(caller).has('couriers.cod.read');
    const rows = this.shipments.filter((s) => includeMock || !s.isMock);
    const count = (statuses: ShipmentStatus[]) =>
      rows.filter((s) => statuses.includes(s.status)).length;
    return Promise.resolve({
      total: rows.length,
      bookingPending: count(['booking_pending']),
      uncertain: rows.filter((s) => s.status === 'booking_pending' && s.bookingUncertain).length,
      pendingPickup: count(['booked', 'pickup_pending']),
      inTransit: count(['picked_up', 'in_transit', 'on_hold', 'out_for_delivery']),
      delivered: count(['delivered', 'partially_delivered']),
      failed: count(['delivery_failed', 'booking_failed']),
      returned: count(['return_initiated', 'returned']),
      cancelled: count(['cancelled']),
      syncErrors: rows.filter((s) => s.syncError !== null).length,
      codAwaitingSettlementMinor: costs ? 0 : null,
      includesMock: includeMock,
    });
  }

  orderShipments(caller: CourierCaller, orderNumber: string) {
    this.enter('admin_order_shipments');
    this.requireAny(caller, 'shipments.read');
    const costs = this.perms(caller).has('couriers.cod.read');
    const order = this.order(orderNumber);
    return Promise.resolve(
      this.shipments
        .filter((s) => s.orderId === order.id)
        .map((s) => ({ shipment: this.json(s, costs), events: this.eventsOf(s.id) })),
    );
  }

  returnShipments(caller: CourierCaller, returnId: string) {
    this.enter('admin_return_shipments');
    this.requireAny(caller, 'shipments.read', 'shipments.returns.manage');
    if (!this.returns.has(returnId)) raise('NZ404');
    return Promise.resolve(
      this.shipments
        .filter((s) => s.returnRequestId === returnId)
        .map((s) => ({ shipment: this.json(s, false), events: this.eventsOf(s.id) })),
    );
  }

  codPositions(caller: CourierCaller) {
    this.enter('admin_cod_positions');
    this.requireAny(caller, 'couriers.cod.read');
    return Promise.resolve({
      total: 0,
      positions: [],
      totals: {
        expectedMinor: 0,
        collectedMinor: 0,
        deductionsMinor: 0,
        expectedSettlementMinor: 0,
        settledMinor: 0,
      },
    });
  }

  recordCodCollected(caller: CourierCaller, shipmentId: string, input: { amountMinor: number }) {
    this.enter('admin_record_cod_collected');
    this.requireAny(caller, 'couriers.cod.reconcile');
    const shipment = this.shipment(shipmentId);
    if (input.amountMinor > shipment.codAmountMinor) raise('NZ608');
    return Promise.resolve();
  }

  recordSettlement(caller: CourierCaller) {
    this.enter('admin_record_courier_settlement');
    this.requireAny(caller, 'couriers.cod.reconcile');
    return Promise.resolve(randomUUID());
  }

  recordCodAdjustment(caller: CourierCaller, shipmentId: string) {
    this.enter('admin_record_cod_adjustment');
    this.requireAny(caller, 'couriers.cod.reconcile');
    this.shipment(shipmentId);
    return Promise.resolve();
  }

  setCodState(
    caller: CourierCaller,
    shipmentId: string,
    input: { state: 'open' | 'disputed' | 'reconciled' },
  ) {
    this.enter('admin_set_cod_state');
    this.requireAny(caller, 'couriers.cod.reconcile');
    this.shipment(shipmentId).codState = input.state;
    return Promise.resolve();
  }

  listSettlements(caller: CourierCaller) {
    this.enter('admin_list_courier_settlements');
    this.requireAny(caller, 'couriers.cod.read');
    return Promise.resolve({ total: 0, settlements: [] });
  }

  myOrderShipments(caller: CourierCaller, orderNumber: string): Promise<CustomerShipment[]> {
    this.enter('my_order_shipments');
    const user = this.identity.userFor(caller.accessToken);
    if (!user) raise('42501');
    const order = this.orders.find(
      (row) => row.orderNumber === orderNumber && row.userId === user.id,
    );
    if (!order) raise('NZ404');
    return Promise.resolve(
      this.shipments
        .filter(
          (s) =>
            s.orderId === order.id &&
            !['draft', 'quoted', 'booking_pending', 'booking_failed'].includes(s.status),
        )
        .map((s) => ({
          id: s.id,
          kind: s.kind,
          returnRequestId: s.returnRequestId,
          providerName: s.providerName,
          status: s.status,
          trackingCode: s.trackingCode,
          trackingUrl: s.trackingUrl,
          isTest: s.isMock,
          bookedAt: s.bookedAt,
          deliveredAt: s.deliveredAt,
          events: this.events
            .filter((e) => e.shipmentId === s.id && e.applied)
            .map((e) => ({ status: e.status, occurredAt: e.occurredAt })),
        })),
    );
  }

  // ---- service role ----

  bookingPayload(shipmentId: string): Promise<BookingPayload | null> {
    this.enter('service_shipment_booking_payload');
    const shipment = this.shipments.find((s) => s.id === shipmentId);
    if (!shipment) return Promise.resolve(null);
    return Promise.resolve({
      shipmentId: shipment.id,
      merchantRef: shipment.merchantRef,
      kind: shipment.kind,
      provider: shipment.provider,
      isMock: shipment.isMock,
      codAmountMinor: shipment.codAmountMinor,
      weightGrams: shipment.weightGrams,
      deliveryZone: shipment.deliveryZone,
      destination: shipment.destination,
      note: shipment.note,
      itemCount: 1,
      recipientName: 'Rahima Khatun',
      recipientPhone: '01712345678',
      addressLine: 'House 12, Road 5',
      area: 'Dhanmondi',
      district: 'Dhaka',
      division: 'Dhaka',
      postalCode: null,
      landmark: null,
      providerSettings: {},
    });
  }

  serviceRecordEvent(
    shipmentId: string,
    event: ShipmentEventInput & { source: 'webhook' | 'poll' },
  ) {
    this.enter('service_record_shipment_event');
    if (['draft', 'quoted', 'booking_pending', 'booking_failed', 'booked'].includes(event.status))
      raise('NZ604');
    return Promise.resolve(
      this.applyEvent(
        shipmentId,
        event.status,
        event.providerStatus,
        event.source,
        event.occurredAt,
        event.dedupeKey,
        null,
      ),
    );
  }

  claimSync(limit: number): Promise<SyncClaim[]> {
    this.enter('service_claim_shipment_sync');
    const due = this.shipments
      .filter(
        (s) =>
          s.nextSyncAt !== null &&
          Date.parse(s.nextSyncAt) <= this.clock &&
          s.consignmentId !== null &&
          !['delivered', 'returned', 'cancelled', 'booking_failed', 'booking_pending'].includes(
            s.status,
          ),
      )
      .slice(0, limit);
    for (const s of due) s.nextSyncAt = new Date(this.clock + 120_000).toISOString();
    return Promise.resolve(
      due.map((s) => ({
        id: s.id,
        provider: s.provider,
        status: s.status,
        consignmentId: s.consignmentId,
        trackingCode: s.trackingCode,
        merchantRef: s.merchantRef,
        isMock: s.isMock,
        syncAttempts: s.syncAttempts,
      })),
    );
  }

  finishSync(shipmentId: string, ok: boolean, error: string | null, nextIn: number) {
    this.enter('service_finish_shipment_sync');
    if (nextIn < 30 || nextIn > 604_800) raise('NZ412');
    this.syncFinishes.push({ id: shipmentId, ok, error, nextIn });
    const shipment = this.shipment(shipmentId);
    shipment.syncAttempts = ok ? 0 : shipment.syncAttempts + 1;
    shipment.syncError = ok ? null : error;
    return Promise.resolve();
  }

  storeWebhook(record: Parameters<CourierStore['storeWebhook']>[0]) {
    this.enter('service_store_courier_webhook');
    const existing = this.webhooks.find((w) => w.dedupeKey === record.dedupeKey);
    if (existing) return Promise.resolve({ id: existing.id, duplicate: true });
    const id = randomUUID();
    this.webhooks.push({
      id,
      ...record,
      status: record.signatureOk ? 'pending' : 'ignored',
      attempts: 0,
      shipmentId: null,
    });
    return Promise.resolve({ id, duplicate: false });
  }

  findShipment(provider: string, consignmentId: string | null, merchantRef: string | null) {
    this.enter('service_find_shipment');
    const found = this.shipments.find(
      (s) =>
        s.provider === provider &&
        ((consignmentId !== null && s.consignmentId === consignmentId) ||
          (merchantRef !== null && s.merchantRef === merchantRef)),
    );
    return Promise.resolve(found?.id ?? null);
  }

  finishWebhook(
    id: string,
    status: FakeWebhook['status'],
    error: string | null,
    shipmentId: string | null,
  ) {
    this.enter('service_finish_courier_webhook');
    void error;
    const row = this.webhooks.find((w) => w.id === id);
    if (row) {
      row.status = status;
      row.attempts += 1;
      row.shipmentId = shipmentId ?? row.shipmentId;
    }
    return Promise.resolve();
  }

  claimWebhookRetries(limit: number): Promise<WebhookRetry[]> {
    this.enter('service_claim_courier_webhook_retries');
    return Promise.resolve(
      this.webhooks
        .filter((w) => w.status === 'failed' && w.attempts < 5)
        .slice(0, limit)
        .map((w) => ({
          id: w.id,
          provider: w.provider,
          eventType: w.eventType,
          consignmentId: w.consignmentId,
          merchantRef: w.merchantRef,
          payload: w.payload,
          attempts: w.attempts,
        })),
    );
  }
}
