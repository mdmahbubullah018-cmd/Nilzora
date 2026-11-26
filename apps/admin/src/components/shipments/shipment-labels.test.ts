import { COURIER_QUOTE_KIND_LABELS, SHIPMENT_STATUS_LABELS } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { takaTextToMinor } from './money-input';
import {
  bookPermissionFor,
  codHref,
  destinationEntries,
  formatBasisPoints,
  gramsToKgText,
  kgTextToGrams,
  parseCodFilters,
  parseShipmentFilters,
  percentTextToBasisPoints,
  quoteKindLabel,
  quoteTotal,
  shipmentsHref,
  shipmentStatusLabel,
} from './shipment-labels';

describe('weights', () => {
  it('reads kilograms as whole grams without float rounding', () => {
    expect(kgTextToGrams('0.5')).toBe(500);
    expect(kgTextToGrams('1.25')).toBe(1250);
    expect(kgTextToGrams('2')).toBe(2000);
    expect(kgTextToGrams('0.001')).toBe(1);
    expect(kgTextToGrams('50')).toBe(50_000);
  });

  it('refuses weights outside 1 g to 50 kg or with more than three decimals', () => {
    for (const text of ['0', '0.0004', '51', '1.2345', '-1', 'abc', '']) {
      expect(kgTextToGrams(text)).toBeUndefined();
    }
  });

  it('prints grams back as the kilogram text a field starts with', () => {
    expect(gramsToKgText(500)).toBe('0.5');
    expect(gramsToKgText(1250)).toBe('1.25');
    expect(gramsToKgText(2000)).toBe('2');
    expect(kgTextToGrams(gramsToKgText(1005))).toBe(1005);
  });
});

describe('money and fees', () => {
  it('turns a percentage into basis points and back', () => {
    expect(percentTextToBasisPoints('1')).toBe(100);
    expect(percentTextToBasisPoints('0.75')).toBe(75);
    expect(percentTextToBasisPoints('100')).toBe(10_000);
    expect(percentTextToBasisPoints('101')).toBeUndefined();
    expect(formatBasisPoints(75)).toBe('0.75%');
  });

  it('reads taka typed in the browser as poisha', () => {
    expect(takaTextToMinor('1,250.50')).toBe(125_050);
    expect(takaTextToMinor('৳ 80')).toBe(8_000);
    expect(takaTextToMinor('1.234')).toBeNull();
    expect(takaTextToMinor('')).toBeNull();
  });

  it('adds the delivery charge and COD fee of a priced quote only', () => {
    expect(quoteTotal({ deliveryChargeMinor: 6_000, codFeeMinor: 1_250 })).toBe(7_250);
    expect(quoteTotal({ deliveryChargeMinor: 6_000, codFeeMinor: null })).toBe(6_000);
    expect(quoteTotal({ deliveryChargeMinor: null, codFeeMinor: 1_250 })).toBeNull();
  });
});

describe('labels', () => {
  it('uses the shared shipment and quote words', () => {
    expect(shipmentStatusLabel('pickup_pending')).toBe(SHIPMENT_STATUS_LABELS.pickup_pending);
    expect(quoteKindLabel('internal_estimate')).toBe('Internal Estimate');
    expect(quoteKindLabel('live')).toBe(COURIER_QUOTE_KIND_LABELS.live);
  });

  it('books returns with the returns permission and deliveries with shipments.create', () => {
    expect(bookPermissionFor('forward')).toBe('shipments.create');
    expect(bookPermissionFor('return_pickup')).toBe('shipments.returns.manage');
    expect(bookPermissionFor('exchange')).toBe('shipments.returns.manage');
  });

  it('shows only plain destination fields', () => {
    expect(
      destinationEntries({ cityId: 1, zone_name: 'Mirpur', nested: { a: 1 }, empty: ' ' }),
    ).toEqual([
      ['City id', '1'],
      ['Zone name', 'Mirpur'],
    ]);
  });
});

describe('filters', () => {
  it('keeps only valid shipment filters from the address', () => {
    expect(
      parseShipmentFilters({
        status: 'in_transit',
        courier: 'pathao',
        kind: 'bogus',
        q: '  NZ100001 ',
        from: '2026-11-10',
        to: '2026-11-01',
        test: '1',
        page: '3',
      }),
    ).toEqual({
      status: 'in_transit',
      provider: 'pathao',
      kind: undefined,
      q: 'NZ100001',
      from: undefined,
      to: undefined,
      test: true,
      page: 3,
    });
  });

  it('builds list addresses that keep the filters', () => {
    expect(shipmentsHref({ status: 'delivered', test: true }, 2)).toBe(
      '/admin/operations/shipments?status=delivered&test=1&page=2',
    );
    expect(codHref({ provider: 'steadfast', status: 'settled' })).toBe(
      '/admin/operations/cod?courier=steadfast&status=settled',
    );
    expect(parseCodFilters({ courier: 'other', status: 'disputed' })).toMatchObject({
      provider: undefined,
      status: 'disputed',
      test: false,
    });
  });
});
