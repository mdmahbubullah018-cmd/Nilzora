import type { CourierQuoteKind, CourierRateCard } from '@nilzora/contracts';

/*
 * Courier prices for one parcel, before they are stored with admin_record_courier_quotes.
 * These are what the COURIER charges Nilzora; the customer's shipping charge on the order
 * is a separate number and is never touched here. Money is integer poisha.
 */

export type DeliveryZone = 'inside_dhaka' | 'outside_dhaka';

/** One quote as the database function admin_record_courier_quotes takes it. */
export interface QuoteDraft {
  provider: string;
  kind: CourierQuoteKind;
  available: boolean;
  unavailableReason: string | null;
  deliveryChargeMinor: number | null;
  codFeeMinor: number | null;
  returnChargeMinor: number | null;
  weightGrams: number;
  zone: DeliveryZone;
  codAmountMinor: number;
  details: Record<string, string | number>;
  isMock: boolean;
}

/** The COD fee on `codAmountMinor` at `bp` basis points, rounded up to a whole poisha. */
export function codFeeMinor(codAmountMinor: number, bp: number | null): number | null {
  if (bp === null) return null;
  if (codAmountMinor <= 0 || bp <= 0) return 0;
  return Math.ceil((codAmountMinor * bp) / 10_000);
}

/** The smallest active bracket of this courier and zone that holds the parcel. */
export function rateCardFor(
  cards: readonly CourierRateCard[],
  provider: string,
  zone: DeliveryZone,
  weightGrams: number,
): CourierRateCard | undefined {
  return cards
    .filter(
      (card) =>
        card.provider === provider &&
        card.zone === zone &&
        card.isActive &&
        card.weightUpToGrams >= weightGrams,
    )
    .sort((a, b) => a.weightUpToGrams - b.weightUpToGrams)[0];
}

export interface EstimateInput {
  provider: string;
  zone: DeliveryZone;
  weightGrams: number;
  codAmountMinor: number;
  rateCards: readonly CourierRateCard[];
  codFeeBp: number | null;
  returnChargeMinor: number | null;
}

/**
 * The admin's own estimate from the negotiated rate card ("Internal Estimate"), or an
 * unavailable quote saying why there is none.
 */
export function internalEstimate(input: EstimateInput): QuoteDraft {
  const base = {
    provider: input.provider,
    weightGrams: input.weightGrams,
    zone: input.zone,
    codAmountMinor: input.codAmountMinor,
    isMock: false,
  };
  const card = rateCardFor(input.rateCards, input.provider, input.zone, input.weightGrams);
  if (!card) {
    return {
      ...base,
      kind: 'unavailable',
      available: false,
      unavailableReason: 'No active rate card covers this zone and weight',
      deliveryChargeMinor: null,
      codFeeMinor: null,
      returnChargeMinor: null,
      details: {},
    };
  }
  return {
    ...base,
    kind: 'internal_estimate',
    available: true,
    unavailableReason: null,
    deliveryChargeMinor: card.chargeMinor,
    codFeeMinor: codFeeMinor(input.codAmountMinor, input.codFeeBp),
    returnChargeMinor: input.returnChargeMinor,
    details: { rateCardId: card.id, weightUpToGrams: card.weightUpToGrams },
  };
}

/** A quote the courier itself could not give and no rate card covers. */
export function unavailableQuote(
  input: Pick<EstimateInput, 'provider' | 'zone' | 'weightGrams' | 'codAmountMinor'>,
  reason: string,
): QuoteDraft {
  return {
    provider: input.provider,
    kind: 'unavailable',
    available: false,
    unavailableReason: reason.slice(0, 200),
    deliveryChargeMinor: null,
    codFeeMinor: null,
    returnChargeMinor: null,
    weightGrams: input.weightGrams,
    zone: input.zone,
    codAmountMinor: input.codAmountMinor,
    details: {},
    isMock: false,
  };
}
