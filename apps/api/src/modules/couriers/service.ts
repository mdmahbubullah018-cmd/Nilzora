import {
  type BookExchangeShipmentRequest,
  type BookingOutcome,
  type BookReturnPickupRequest,
  type BookShipmentRequest,
  type BookShipmentResponse,
  type CancelShipmentRequest,
  type CourierCapability,
  type CourierCheckResponse,
  type CourierCompareResponse,
  type CourierConfigResponse,
  type CourierLocationMappingRequest,
  type CourierOverviewResponse,
  type CourierProviderRequest,
  type CourierRateCard,
  type CourierRateCardRequest,
  type CourierSettingsRequest,
  type CourierSettlement,
  type RecordCourierSettlementRequest,
  type RecordPortalBookingRequest,
  type RecordShipmentStatusRequest,
  type RecordShipmentStatusResponse,
  type RefreshShipmentResponse,
  type ResolveShipmentBookingRequest,
  type Shipment,
} from '@nilzora/contracts';
import type { Logger } from 'pino';
import { AdminRefusalError } from '../admin/errors';
import { parseCourierBaseUrl, REQUIRED_CREDENTIAL_FIELDS, type CourierConfig } from './config';
import { CourierRefusalError, couriersOff } from './errors';
import { isMockConsignment } from './mock-provider';
import { internalEstimate, unavailableQuote, type QuoteDraft } from './pricing';
import { recommendCourier, type RecommendationCandidate } from './recommendation';
import { isCourierProviderId, type CourierRegistry } from './registry';
import {
  mockRefusal,
  resolveBaseUrl,
  type CourierRuntime,
  type EffectiveCourierRuntime,
} from './runtime';
import type {
  BeginResult,
  BookingPayload,
  CourierCaller,
  CourierStore,
  DbCourierConfig,
  DbCourierProvider,
  FinishBookingInput,
} from './store';
import type {
  AdapterContext,
  BookedParcel,
  BookingRequest,
  CourierProvider,
  ProviderResult,
} from './types';

/*
 * Courier workflows. The database owns consistency (idempotent booking rows, allowed
 * transitions, the append-only ledger); this layer owns the courier calls and decides what
 * each answer means. Rules kept here:
 *
 *  - A booking calls the courier at most once per booking key: only when
 *    admin_begin_* says `shouldCall`. A refusal becomes `failed`; no clear answer becomes
 *    `uncertain`, which is never retried automatically.
 *  - Courier events only ever move the shipment. Nothing here changes an order's status,
 *    marks cash collected or starts a refund.
 *  - The recipient's details (service_shipment_booking_payload) go to the courier adapter
 *    only. They are never logged and never returned.
 */

/** A booking younger than this may still have its courier call in flight. */
const BOOKING_IN_FLIGHT_MS = 2 * 60_000;
/** A live connection check counts for live verification for this long. */
const LIVE_CHECK_VALID_MS = 24 * 3_600_000;

const NO_CAPABILITIES = {
  quote: 'unsupported',
  book: 'unsupported',
  track: 'unsupported',
  cancel: 'unsupported',
  webhook: 'unsupported',
  returnPickup: 'unsupported',
  locations: 'unsupported',
} as const;

export interface CourierServiceOptions {
  store: CourierStore;
  registry: CourierRegistry;
  /** Environment bootstrap: database target, fallback credentials and base URLs. */
  config: CourierConfig;
  /** The operating settings, read from the database. */
  runtime: CourierRuntime;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  now?: () => number;
}

interface CredentialStatus {
  field: string;
  source: 'vault' | 'environment';
  setAt: string | null;
}

export interface CourierOperationsRequestInput {
  mode: 'off' | 'mock' | 'live';
  bookingEnabled: boolean;
  trackingSyncEnabled: boolean;
  trackingSyncIntervalSeconds: number;
  httpTimeoutMs: number;
  confirmation?: string | undefined;
}

/** What a booking that was not sent again means, from the shipment as it stands. */
export function outcomeOf(shipment: Shipment): BookingOutcome {
  if (shipment.status === 'booking_failed') return 'failed';
  if (shipment.status === 'booking_pending')
    return shipment.bookingUncertain ? 'uncertain' : 'in_progress';
  return shipment.consignmentId === null ? 'failed' : 'booked';
}

/** Error text that is safe to store and show: the failure's own fixed message, trimmed. */
function safeMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export function createCourierService(options: CourierServiceOptions) {
  const { store, registry, config, runtime, logger } = options;
  const now = options.now ?? Date.now;

  function providerOrThrow(id: string, mode: EffectiveCourierRuntime['mode']): CourierProvider {
    const provider = registry.provider(id, mode);
    if (!provider) throw new AdminRefusalError('not_found');
    return provider;
  }

  /** Credentials, base URL and timeout for a real adapter; nothing for the mock. */
  async function contextFor(provider: CourierProvider): Promise<AdapterContext | undefined> {
    return provider.isMock ? undefined : runtime.adapterContext(provider.id);
  }

  function unsupported(provider: CourierProvider, what: string): CourierRefusalError {
    return new CourierRefusalError(
      409,
      'courier_operation_unsupported',
      provider.blockedReason ??
        `${provider.displayName} offers no API to ${what}; use its portal and record the result here`,
    );
  }

  /** Mode, adapter capability and the live booking switch, before any row is created. */
  async function requireBookable(
    providerId: string,
    capability: CourierCapability,
  ): Promise<CourierProvider> {
    const rt = await runtime.current();
    if (rt.mode === 'off') throw couriersOff();
    const provider = providerOrThrow(providerId, rt.mode);
    if (provider.capabilities()[capability] !== 'available')
      throw unsupported(provider, 'book parcels');
    if (rt.mode === 'live' && !rt.bookingEnabled) {
      throw new CourierRefusalError(
        503,
        'courier_unavailable',
        'Real courier bookings are switched off on this server',
      );
    }
    return provider;
  }

  function bookingRequest(payload: BookingPayload): BookingRequest {
    return {
      shipmentId: payload.shipmentId,
      merchantRef: payload.merchantRef,
      kind: payload.kind,
      codAmountMinor: payload.codAmountMinor,
      weightGrams: payload.weightGrams,
      deliveryZone: payload.deliveryZone,
      destination: payload.destination,
      note: payload.note,
      itemCount: payload.itemCount,
      recipient: {
        name: payload.recipientName,
        phone: payload.recipientPhone,
        addressLine: payload.addressLine,
        area: payload.area,
        district: payload.district,
        division: payload.division,
        postalCode: payload.postalCode,
        landmark: payload.landmark,
      },
      providerSettings: payload.providerSettings,
    };
  }

  /** The one courier call of a booking, and its report to the database. */
  async function book(
    caller: CourierCaller,
    provider: CourierProvider,
    begin: () => Promise<BeginResult>,
  ): Promise<BookShipmentResponse> {
    const begun = await begin();
    if (!begun.shouldCall) {
      return { shipment: begun.shipment, outcome: outcomeOf(begun.shipment), duplicate: true };
    }
    const shipmentId = begun.shipment.id;

    let result: ProviderResult<BookedParcel>;
    let payload: BookingPayload | null = null;
    let context: AdapterContext | undefined;
    try {
      context = await contextFor(provider);
      payload = await store.bookingPayload(shipmentId);
    } catch (error) {
      logger.warn(
        { shipmentId, errorName: errorName(error) },
        'Booking details could not be loaded',
      );
    }
    if (payload === null) {
      // Nothing reached the courier: a definite failure, safe to book again.
      result = {
        kind: 'refused',
        message: 'The booking details could not be loaded; nothing was sent',
      };
    } else {
      try {
        result = await provider.book(bookingRequest(payload), context);
      } catch (error) {
        // An adapter fault after the request may have left: treat it as no clear answer.
        logger.error(
          { shipmentId, provider: provider.id, errorName: errorName(error) },
          'Courier adapter failed',
        );
        result = { kind: 'uncertain', message: 'The courier call failed without a clear answer' };
      }
    }

    const finish: FinishBookingInput =
      result.kind === 'ok'
        ? {
            outcome: 'booked',
            consignmentId: result.value.consignmentId,
            trackingCode: result.value.trackingCode,
            trackingUrl: result.value.trackingUrl,
            providerStatus: result.value.providerStatus,
            chargeMinor: result.value.chargeMinor,
            error: null,
          }
        : {
            outcome: result.kind === 'uncertain' ? 'uncertain' : 'failed',
            consignmentId: null,
            trackingCode: null,
            trackingUrl: null,
            providerStatus: null,
            chargeMinor: null,
            error: safeMessage(result.message),
          };

    let finished: Shipment | undefined;
    for (let attempt = 0; attempt < 2 && finished === undefined; attempt += 1) {
      try {
        finished = await store.finishBooking(caller, shipmentId, finish);
      } catch (error) {
        if (error instanceof AdminRefusalError) throw error;
        logger.warn(
          { shipmentId, provider: provider.id, attempt: attempt + 1, errorName: errorName(error) },
          'Booking outcome could not be recorded',
        );
        if (attempt === 1 && result.kind !== 'ok') throw error;
      }
    }
    if (finished === undefined) {
      // The courier accepted the parcel but the database did not take the answer. The row
      // stays pending (resolvable after two minutes); the consignment id is not personal
      // data and is logged so staff can resolve it with the courier's own reference.
      logger.error(
        {
          shipmentId,
          provider: provider.id,
          consignmentId: finish.consignmentId,
        },
        'Courier accepted a booking that could not be recorded; resolve it by hand',
      );
      return { shipment: begun.shipment, outcome: 'uncertain', duplicate: false };
    }
    return { shipment: finished, outcome: outcomeOf(finished), duplicate: false };
  }

  /** Which credential fields are set, and where; never their values. */
  function credentialStatus(row: DbCourierProvider): CredentialStatus[] {
    const env: Readonly<Record<string, string | undefined>> = isCourierProviderId(row.provider)
      ? config.credentials[row.provider]
      : {};
    const status: CredentialStatus[] = [];
    for (const field of row.credentialFields) {
      const stored = row.credentials.find((c) => c.field === field);
      const fallback = env[field];
      if (stored) status.push({ field, source: 'vault', setAt: stored.setAt });
      else if (fallback !== undefined && fallback !== '') {
        status.push({ field, source: 'environment', setAt: null });
      }
    }
    return status;
  }

  function credentialsComplete(row: DbCourierProvider): boolean {
    if (!isCourierProviderId(row.provider)) return false;
    const set = new Set(credentialStatus(row).map((c) => c.field));
    return REQUIRED_CREDENTIAL_FIELDS[row.provider].every((field) => set.has(field));
  }

  /** Everything that must be true before real bookings may go to this courier. */
  function readinessOf(row: DbCourierProvider, rt: EffectiveCourierRuntime) {
    const adapter = registry.real(row.provider);
    const adapterVerified = adapter?.verified ?? false;
    const complete = credentialsComplete(row);
    const base = isCourierProviderId(row.provider)
      ? resolveBaseUrl(row.provider, row.apiBaseUrl, config)
      : null;
    const baseUrlValid = base?.valid ?? false;
    const liveCheckPassed =
      row.lastCheckOk === true &&
      row.lastCheckMode === 'live' &&
      row.lastCheckAt !== null &&
      now() - Date.parse(row.lastCheckAt) < LIVE_CHECK_VALID_MS;
    const liveVerified = row.liveVerifiedAt !== null;
    const enabled = row.isEnabled;
    const blockers: string[] = [];
    if (!adapterVerified) {
      blockers.push(
        `The ${row.displayName} integration is not yet built against verified merchant API documentation`,
      );
    }
    if (!complete) blockers.push('Some required credentials are missing');
    if (!baseUrlValid) blockers.push('No valid API base URL is set');
    if (!liveCheckPassed) blockers.push('No successful live connection check in the last 24 hours');
    if (!liveVerified) blockers.push('Not verified for live use by the owner');
    if (!enabled) blockers.push('Not enabled for real bookings');
    if (rt.mode !== 'live') blockers.push('Couriers are not in live mode');
    else if (!rt.bookingEnabled) blockers.push('Real courier bookings are switched off');
    return {
      apiBaseUrl: base?.url ?? row.apiBaseUrl,
      readiness: {
        adapterVerified,
        credentialsComplete: complete,
        baseUrlValid,
        liveCheckPassed,
        liveVerified,
        enabled,
        ready: blockers.length === 0,
        blockers,
      },
    };
  }

  function buildConfig(db: DbCourierConfig, rt: EffectiveCourierRuntime): CourierConfigResponse {
    return {
      mode: rt.mode,
      bookingEnabled: rt.bookingEnabled,
      trackingSyncEnabled: rt.trackingSyncEnabled,
      operations: db.operations,
      databaseTarget: rt.databaseTarget,
      mockAllowed: rt.mockAllowed,
      modeNotice: rt.modeNotice,
      settings: db.settings,
      providers: db.providers.map((row) => {
        const provider = registry.provider(row.provider, rt.mode);
        const { apiBaseUrl, readiness } = readinessOf(row, rt);
        return {
          ...row,
          apiBaseUrl,
          credentials: credentialStatus(row),
          credentialsConfigured: credentialsComplete(row),
          capabilities: provider?.capabilities() ?? { ...NO_CAPABILITIES },
          blockedReason: provider?.blockedReason ?? null,
          readiness,
        };
      }),
      rateCards: db.rateCards,
      locationMappings: db.locationMappings,
    };
  }

  async function configResponse(caller: CourierCaller): Promise<CourierConfigResponse> {
    const [db, rt] = await Promise.all([store.config(caller), runtime.current()]);
    return buildConfig(db, rt);
  }

  /** After an admin change: forget the cached settings, then answer with the new state. */
  async function changed(caller: CourierCaller): Promise<CourierConfigResponse> {
    runtime.invalidate();
    return configResponse(caller);
  }

  /** A rate card as saved, read back; built from the request when the caller may not read. */
  async function rateCardAnswer(
    caller: CourierCaller,
    id: string,
    input: CourierRateCardRequest,
  ): Promise<CourierRateCard> {
    try {
      const card = (await store.config(caller)).rateCards.find((row) => row.id === id);
      if (card) return card;
    } catch (error) {
      if (!(error instanceof AdminRefusalError) || error.refusal !== 'missing_permission')
        throw error;
    }
    return {
      id,
      provider: input.provider,
      zone: input.zone,
      weightUpToGrams: input.weightUpToGrams,
      chargeMinor: input.chargeMinor,
      isActive: input.isActive ?? true,
      updatedAt: new Date(now()).toISOString(),
    };
  }

  return {
    /** Thin reads and changes need no courier logic: routes call the store directly. */
    store,
    runtime,

    config: configResponse,

    async saveSettings(caller: CourierCaller, input: CourierSettingsRequest) {
      await store.saveSettings(caller, input);
      return changed(caller);
    },

    async saveProvider(caller: CourierCaller, provider: string, input: CourierProviderRequest) {
      await store.saveProvider(caller, provider, input);
      return changed(caller);
    },

    /**
     * The operating switches. Test mode is refused here before the database is asked when
     * this API may not run it (hosted database or production); turning on live operations
     * needs the typed confirmation, which the database checks.
     */
    async saveOperations(caller: CourierCaller, input: CourierOperationsRequestInput) {
      if (input.mode === 'mock') {
        const refusal = mockRefusal(config);
        if (refusal !== null) {
          throw new CourierRefusalError(409, 'courier_mock_not_allowed', refusal);
        }
      }
      await store.saveOperations(caller, {
        mode: input.mode,
        bookingEnabled: input.bookingEnabled,
        trackingSyncEnabled: input.trackingSyncEnabled,
        trackingSyncIntervalSeconds: input.trackingSyncIntervalSeconds,
        httpTimeoutMs: input.httpTimeoutMs,
        confirmation: input.confirmation ?? null,
      });
      return changed(caller);
    },

    /** Stores one credential encrypted; the value is never logged or returned. */
    async setCredential(caller: CourierCaller, provider: string, field: string, value: string) {
      await store.setCredential(caller, provider, field, value);
      return changed(caller);
    },

    async clearCredential(caller: CourierCaller, provider: string, field: string) {
      await store.clearCredential(caller, provider, field);
      return changed(caller);
    },

    /** A base URL must be https on the courier's allow-list; null clears it. */
    async saveBaseUrl(caller: CourierCaller, provider: string, url: string | null) {
      let normalised: string | null = null;
      if (url !== null && url !== '') {
        if (!isCourierProviderId(provider)) throw new AdminRefusalError('not_found');
        const parsed = parseCourierBaseUrl('API base URL', provider, url);
        if ('problem' in parsed) throw new CourierRefusalError(400, 'bad_request', parsed.problem);
        normalised = parsed.url;
      }
      await store.saveBaseUrl(caller, provider, normalised);
      return changed(caller);
    },

    /**
     * Marks a courier verified for live use, or withdraws it. Verifying is refused here
     * while the adapter is not built against verified documentation or credentials are
     * missing; the database then requires the typed confirmation and a live check in the
     * last 24 hours. Withdrawing is always allowed.
     */
    async setLiveVerification(
      caller: CourierCaller,
      provider: string,
      input: { verified: boolean; confirmation?: string | undefined },
    ) {
      if (input.verified) {
        const adapter = registry.real(provider);
        if (!adapter) throw new AdminRefusalError('not_found');
        if (!adapter.verified) {
          throw new CourierRefusalError(
            409,
            'courier_operation_unsupported',
            adapter.blockedReason ??
              `The ${adapter.displayName} integration is not verified for live use`,
          );
        }
        const row = (await store.config(caller)).providers.find((p) => p.provider === provider);
        if (!row) throw new AdminRefusalError('not_found');
        if (!credentialsComplete(row)) {
          throw new CourierRefusalError(
            409,
            'courier_live_check_required',
            'Add every required credential and run a successful live connection check first',
          );
        }
      }
      await store.setLiveVerified(caller, provider, input.verified, input.confirmation ?? null);
      return changed(caller);
    },

    deleteLocationMapping: (caller: CourierCaller, id: string) =>
      store.deleteLocationMapping(caller, id),

    /** Settles an uncertain booking by hand; the mock's id format stays reserved for it. */
    async resolveBooking(
      caller: CourierCaller,
      shipmentId: string,
      input: ResolveShipmentBookingRequest,
    ): Promise<Shipment> {
      if (input.outcome === 'booked' && isMockConsignment(input.consignmentId.trim())) {
        throw new CourierRefusalError(
          400,
          'bad_request',
          'That consignment id has the test courier’s format; check the id in the courier portal',
        );
      }
      return store.resolveBooking(caller, shipmentId, input);
    },

    async checkConnection(
      caller: CourierCaller,
      providerId: string,
    ): Promise<CourierCheckResponse> {
      const rt = await runtime.current();
      const mode = rt.mode;
      if (mode === 'off') throw couriersOff();
      const provider = providerOrThrow(providerId, mode);
      let result: ProviderResult<{ message: string }>;
      try {
        result = await provider.checkConnection(await contextFor(provider));
      } catch (error) {
        logger.warn({ provider: provider.id, errorName: errorName(error) }, 'Courier check failed');
        result = { kind: 'uncertain', message: 'The courier check failed' };
      }
      const ok = result.kind === 'ok';
      const message = safeMessage(result.kind === 'ok' ? result.value.message : result.message);
      await store.recordCheck(caller, provider.id, { ok, mode, message });
      runtime.invalidate();
      return { provider: provider.id, ok, mode, message, checkedAt: new Date(now()).toISOString() };
    },

    async createRateCard(caller: CourierCaller, input: CourierRateCardRequest) {
      const id = await store.saveRateCard(caller, null, input);
      return rateCardAnswer(caller, id, input);
    },

    async updateRateCard(caller: CourierCaller, id: string, input: CourierRateCardRequest) {
      const saved = await store.saveRateCard(caller, id, input);
      return rateCardAnswer(caller, saved, input);
    },

    deleteRateCard: (caller: CourierCaller, id: string) => store.deleteRateCard(caller, id),

    saveLocationMapping: (caller: CourierCaller, input: CourierLocationMappingRequest) =>
      store.saveLocationMapping(caller, input),

    async overview(caller: CourierCaller, includeMock: boolean): Promise<CourierOverviewResponse> {
      const [db, cfg, stats, rt] = await Promise.all([
        store.overview(caller, includeMock),
        store.config(caller),
        store.providerStats(caller),
        runtime.current(),
      ]);
      return {
        ...db,
        mode: rt.mode,
        providers: cfg.providers.map((row) => {
          const s = stats.find((stat) => stat.provider === row.provider);
          return {
            provider: row.provider,
            displayName: row.displayName,
            isEnabled: row.isEnabled,
            settled: s?.settled ?? 0,
            delivered: s?.delivered ?? 0,
            failed: s?.failed ?? 0,
          };
        }),
      };
    },

    orderContext: (caller: CourierCaller, orderNumber: string) =>
      store.orderContext(caller, orderNumber),

    /**
     * Prices every courier for one order (a live or mock quote where the adapter can,
     * otherwise the rate card), stores them, and recommends one. Never touches the order's
     * own shipping charge, and never books.
     */
    async compare(
      caller: CourierCaller,
      orderNumber: string,
      weightGrams: number | undefined,
    ): Promise<CourierCompareResponse> {
      const [context, db, stats, rt] = await Promise.all([
        store.orderContext(caller, orderNumber),
        store.config(caller),
        store.providerStats(caller),
        runtime.current(),
      ]);
      const mode = rt.mode;
      const weight = weightGrams ?? context.defaultParcelWeightGrams;
      const zone = context.order.deliveryZone;
      const cod = context.order.codDueMinor;
      const rows = db.providers.filter((row) => isCourierProviderId(row.provider));

      const drafts: QuoteDraft[] = [];
      const candidates: RecommendationCandidate[] = [];
      for (const row of rows) {
        const provider = providerOrThrow(row.provider, mode);
        const notes: string[] = [];
        let draft: QuoteDraft | undefined;
        if (mode !== 'off' && provider.capabilities().quote === 'available') {
          let quoted: Awaited<ReturnType<CourierProvider['quote']>>;
          try {
            quoted = await provider.quote(
              { weightGrams: weight, zone, codAmountMinor: cod },
              await contextFor(provider),
            );
          } catch {
            quoted = { kind: 'uncertain', message: 'The courier did not give a price' };
          }
          if (quoted.kind === 'ok') {
            draft = {
              provider: row.provider,
              kind: quoted.value.kind,
              available: true,
              unavailableReason: null,
              deliveryChargeMinor: quoted.value.deliveryChargeMinor,
              codFeeMinor: quoted.value.codFeeMinor,
              returnChargeMinor: quoted.value.returnChargeMinor,
              weightGrams: weight,
              zone,
              codAmountMinor: cod,
              details: quoted.value.details,
              isMock: provider.isMock,
            };
          } else {
            notes.push('The courier did not give a price; the rate card was used');
          }
        }
        if (draft === undefined && provider.isMock) {
          draft = unavailableQuote(
            { provider: row.provider, zone, weightGrams: weight, codAmountMinor: cod },
            'The mock courier did not give a price',
          );
          draft.isMock = true;
        }
        draft ??= internalEstimate({
          provider: row.provider,
          zone,
          weightGrams: weight,
          codAmountMinor: cod,
          rateCards: db.rateCards,
          codFeeBp: row.codFeeBp,
          returnChargeMinor: row.returnChargeMinor,
        });
        drafts.push(draft);

        if (mode === 'off') notes.push('Couriers are switched off on this server');
        if (mode === 'live' && !row.isEnabled) notes.push('Not enabled for real bookings');
        if (mode === 'live' && row.liveVerifiedAt === null) {
          notes.push('Not verified for live use');
        }
        if (!draft.available && draft.unavailableReason) notes.push(draft.unavailableReason);
        if (mode !== 'off' && provider.capabilities().book !== 'available') {
          notes.push(
            provider.blockedReason
              ? `${provider.blockedReason} Book it in the courier’s portal.`
              : 'Booking through the API is not available; use the courier’s portal',
          );
        }
        candidates.push({
          provider: row.provider,
          displayName: row.displayName,
          eligible:
            mode !== 'off' &&
            (mode === 'mock' || (row.isEnabled && row.liveVerifiedAt !== null)) &&
            draft.available,
          quoteKind: draft.kind,
          deliveryChargeMinor: draft.deliveryChargeMinor,
          codFeeMinor: draft.codFeeMinor,
          notes,
        });
      }

      const recorded =
        drafts.length > 0 ? await store.recordQuotes(caller, orderNumber, drafts) : [];
      const ids = new Set(recorded.map((row) => row.id));
      const fresh = await store.orderContext(caller, orderNumber);
      const quotes = fresh.quotes.filter((quote) => ids.has(quote.id));
      const recommendation = recommendCourier(candidates, stats, {
        minHistorySample: db.settings.minHistorySample,
        preferredProvider: db.settings.preferredProvider,
      });
      return { weightGrams: weight, quotes, recommendation, isMock: mode === 'mock' };
    },

    async bookShipment(caller: CourierCaller, orderNumber: string, input: BookShipmentRequest) {
      const provider = await requireBookable(input.provider, 'book');
      return book(caller, provider, () =>
        store.beginBooking(caller, orderNumber, {
          bookingKey: input.bookingKey,
          provider: input.provider,
          quoteId: input.quoteId ?? null,
          weightGrams: input.weightGrams,
          note: input.note ?? null,
          recommendedProvider: input.recommendedProvider ?? null,
          selectionReason: input.selectionReason ?? null,
          destination: input.destination ?? {},
          isMock: provider.isMock,
        }),
      );
    },

    async bookReturnPickup(
      caller: CourierCaller,
      returnId: string,
      input: BookReturnPickupRequest,
    ) {
      const provider = await requireBookable(input.provider, 'returnPickup');
      return book(caller, provider, () =>
        store.beginReturnPickup(caller, returnId, {
          bookingKey: input.bookingKey,
          provider: input.provider,
          weightGrams: input.weightGrams,
          note: input.note ?? null,
          destination: input.destination ?? {},
          isMock: provider.isMock,
        }),
      );
    },

    async bookExchange(
      caller: CourierCaller,
      returnId: string,
      input: BookExchangeShipmentRequest,
    ) {
      const provider = await requireBookable(input.provider, 'book');
      return book(caller, provider, () =>
        store.beginExchange(caller, returnId, {
          bookingKey: input.bookingKey,
          provider: input.provider,
          weightGrams: input.weightGrams,
          codAmountMinor: input.codAmountMinor,
          note: input.note ?? null,
          destination: input.destination ?? {},
          isMock: provider.isMock,
        }),
      );
    },

    /**
     * Records a parcel staff already booked in the courier's own portal. Nothing is sent
     * to any courier, so it works in every mode (off and live included); in mock mode the
     * shipment is a test shipment, as every other shipment there.
     */
    async recordPortalBooking(
      caller: CourierCaller,
      orderNumber: string,
      input: RecordPortalBookingRequest,
    ): Promise<Shipment> {
      const mode = (await runtime.current()).mode;
      // The mock's consignment format is reserved for test shipments, so a mock webhook can
      // never reach a real parcel.
      if (mode !== 'mock' && isMockConsignment(input.consignmentId.trim())) {
        throw new CourierRefusalError(
          400,
          'bad_request',
          'That consignment id has the test courier’s format; check the id in the courier portal',
        );
      }
      return store.recordPortalBooking(caller, orderNumber, {
        returnId: input.returnId ?? null,
        bookingKey: input.bookingKey,
        provider: input.provider,
        weightGrams: input.weightGrams,
        consignmentId: input.consignmentId,
        trackingCode: input.trackingCode ?? null,
        chargeMinor: input.chargeMinor ?? null,
        note: input.note,
        recommendedProvider: input.recommendedProvider ?? null,
        selectionReason: input.selectionReason ?? null,
        isMock: mode === 'mock',
      });
    },

    /**
     * Cancels before pickup. With a courier cancel API (the mock), the courier is asked
     * first; without one, staff must confirm they cancelled it in the courier's portal. A
     * booking that never got an answer is cancelled without the courier, unless its call
     * may still be in flight.
     */
    async cancel(
      caller: CourierCaller,
      shipmentId: string,
      input: CancelShipmentRequest,
    ): Promise<Shipment> {
      const { shipment } = await store.getShipment(caller, shipmentId);
      const reason = input.reason;
      if (shipment.status === 'booking_pending') {
        const started = shipment.providerCallStartedAt
          ? Date.parse(shipment.providerCallStartedAt)
          : 0;
        if (!shipment.bookingUncertain && now() - started < BOOKING_IN_FLIGHT_MS) {
          throw new CourierRefusalError(
            409,
            'shipment_booking_unresolved',
            'This booking may still be in progress; wait for its answer before cancelling',
          );
        }
        // The database refuses an uncertain booking (resolve it first).
        return store.cancel(caller, shipmentId, reason, false);
      }
      if (shipment.status !== 'booked' && shipment.status !== 'pickup_pending') {
        // Not cancellable here: the database gives the precise refusal.
        return store.cancel(caller, shipmentId, reason, false);
      }
      const rt = await runtime.current();
      const provider = registry.forShipment(shipment.provider, shipment.isMock, rt.mode);
      if (provider && provider.capabilities().cancel === 'available' && shipment.consignmentId) {
        let result: ProviderResult<{ providerStatus: string | null }>;
        try {
          result = await provider.cancel(
            { consignmentId: shipment.consignmentId, merchantRef: shipment.merchantRef },
            await contextFor(provider),
          );
        } catch (error) {
          logger.warn({ shipmentId, errorName: errorName(error) }, 'Courier cancel failed');
          result = { kind: 'uncertain', message: 'The courier did not answer' };
        }
        if (result.kind === 'ok') return store.cancel(caller, shipmentId, reason, true);
        if (result.kind === 'refused') {
          throw new CourierRefusalError(
            409,
            'shipment_not_cancellable',
            `The courier refused to cancel: ${safeMessage(result.message)}`,
          );
        }
        if (result.kind === 'uncertain') {
          throw new CourierRefusalError(
            503,
            'courier_unavailable',
            'The courier did not confirm the cancellation; check its portal before trying again',
          );
        }
      }
      if (!input.cancelledInPortal) {
        throw new CourierRefusalError(
          409,
          'courier_operation_unsupported',
          'Cancel this shipment in the courier’s portal first, then confirm it here',
        );
      }
      return store.cancel(caller, shipmentId, reason, true);
    },

    /**
     * Asks the courier for the latest status now when its adapter can track; when the call
     * fails and the worker is on, the worker is asked to try. Couriers without a tracking
     * API answer `unsupported`: staff record the status by hand.
     */
    async refresh(caller: CourierCaller, shipmentId: string): Promise<RefreshShipmentResponse> {
      const detail = await store.getShipment(caller, shipmentId);
      const shipment = detail.shipment;
      const rt = await runtime.current();
      const mode = rt.mode;
      const provider = registry.forShipment(shipment.provider, shipment.isMock, mode);
      if (mode === 'off' || !provider) {
        return {
          shipment,
          result: 'unsupported',
          message:
            mode === 'off'
              ? 'Couriers are switched off on this server; record the status by hand'
              : 'This shipment’s courier is not active in this mode; record the status by hand',
        };
      }
      if (provider.capabilities().track !== 'available') {
        return {
          shipment,
          result: 'unsupported',
          message: provider.blockedReason
            ? `${provider.blockedReason} Record the status by hand.`
            : `${provider.displayName} offers no tracking API; record the status by hand`,
        };
      }
      if (shipment.consignmentId === null) {
        throw new AdminRefusalError('invalid_shipment_transition');
      }
      let tracked: Awaited<ReturnType<CourierProvider['track']>>;
      try {
        tracked = await provider.track(
          {
            consignmentId: shipment.consignmentId,
            trackingCode: shipment.trackingCode,
            merchantRef: shipment.merchantRef,
          },
          await contextFor(provider),
        );
      } catch (error) {
        logger.warn({ shipmentId, errorName: errorName(error) }, 'Courier tracking failed');
        tracked = { kind: 'uncertain', message: 'The courier did not answer' };
      }
      if (tracked.kind !== 'ok') {
        if (rt.trackingSyncEnabled) {
          await store.requestSync(caller, shipmentId);
          const again = await store.getShipment(caller, shipmentId);
          return {
            shipment: again.shipment,
            result: 'queued',
            message: 'The courier did not answer; the tracking worker will try again shortly',
          };
        }
        throw new CourierRefusalError(
          503,
          'courier_unavailable',
          'The courier did not answer; try again later',
        );
      }
      for (const event of tracked.value) {
        if (event.status === 'unknown') continue;
        await store.recordEvent(caller, shipmentId, {
          status: event.status,
          providerStatus: event.providerStatus,
          occurredAt: event.occurredAt,
          dedupeKey: pollKey(
            shipment.provider,
            shipment.consignmentId,
            event.providerStatus,
            event.occurredAt,
          ),
          source: 'poll',
          note: null,
        });
      }
      const after = await store.getShipment(caller, shipmentId);
      return {
        shipment: after.shipment,
        result: 'synced',
        message: `${provider.displayName} answered; the timeline is up to date`,
      };
    },

    async recordStatus(
      caller: CourierCaller,
      shipmentId: string,
      input: RecordShipmentStatusRequest,
    ): Promise<RecordShipmentStatusResponse> {
      const minute = new Date(now()).toISOString().slice(0, 16);
      const result = await store.recordEvent(caller, shipmentId, {
        status: input.status,
        providerStatus: null,
        occurredAt: input.occurredAt ?? null,
        // A double submit of the same status in the same minute is one event.
        dedupeKey: `manual:${shipmentId}:${input.status}:${input.occurredAt ?? minute}`,
        source: 'manual',
        note: input.note,
      });
      const { shipment } = await store.getShipment(caller, shipmentId);
      return { applied: result.applied, duplicate: result.duplicate, shipment };
    },

    /** A settlement as recorded, read back from the list (or built from the request). */
    async recordSettlement(
      caller: CourierCaller,
      input: RecordCourierSettlementRequest,
    ): Promise<CourierSettlement> {
      const id = await store.recordSettlement(caller, input);
      const isMock = input.isMock ?? false;
      for (let page = 0; page < 5; page += 1) {
        const { settlements, total } = await store.listSettlements(
          caller,
          { provider: input.provider, includeMock: isMock },
          { limit: 100, offset: page * 100 },
        );
        const found = settlements.find((row) => row.id === id);
        if (found) return found;
        if ((page + 1) * 100 >= total) break;
      }
      return {
        id,
        provider: input.provider,
        reference: input.reference.trim(),
        amountMinor: input.amountMinor,
        receivedOn: input.receivedOn,
        note: input.note?.trim() || null,
        isMock,
        createdAt: new Date(now()).toISOString(),
        lines: input.lines.length,
      };
    },
  };
}

/** The same courier status at the same time is one event, however often it is polled. */
export function pollKey(
  provider: string,
  consignmentId: string,
  providerStatus: string,
  occurredAt: string,
): string {
  return `poll:${provider}:${consignmentId}:${providerStatus}:${occurredAt}`.slice(0, 200);
}

export type CourierService = ReturnType<typeof createCourierService>;
