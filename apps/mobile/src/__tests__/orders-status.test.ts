import { ORDER_STATUSES, PAYMENT_STATUSES } from '@nilzora/contracts';
import {
  addressLines,
  formatBdPhone,
  isOrderNumber,
  isProductSlug,
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_STATUS_DESCRIPTIONS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  paymentSummary,
  singleParam,
  timelineEvents,
} from '../features/orders/status';

describe('order wording', () => {
  it('names every order and payment status the API can return', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
      expect(ORDER_EVENT_LABELS[status]).toBeTruthy();
      expect(ORDER_STATUS_TONES[status]).toBeTruthy();
    }
    for (const status of PAYMENT_STATUSES) {
      expect(PAYMENT_STATUS_LABELS[status]).toBeTruthy();
      expect(PAYMENT_STATUS_DESCRIPTIONS[status]).toBeTruthy();
      expect(PAYMENT_STATUS_TONES[status]).toBeTruthy();
    }
  });

  it('uses the storefront’s words for the order', () => {
    expect(ORDER_STATUS_LABELS.pending).toBe('Awaiting confirmation');
    expect(ORDER_STATUS_LABELS.shipped).toBe('On the way');
    expect(ORDER_EVENT_LABELS.pending).toBe('Order placed');
    expect(ORDER_EVENT_LABELS.confirmed).toBe('Confirmed by Nilzora');
  });

  it('keeps payment apart from the order: cash on delivery with its own status', () => {
    expect(paymentSummary('pending')).toBe('Cash on delivery · Payment pending');
    expect(paymentSummary('collected')).toBe('Cash on delivery · Payment collected');
  });
});

describe('isOrderNumber', () => {
  it.each(['NZ100042', 'NZ123456', 'NZ123456789012'])('accepts %p', (value) => {
    expect(isOrderNumber(value)).toBe(true);
  });

  it.each([
    '',
    'nz100042',
    'NZ12345',
    'NZ1234567890123',
    ' NZ100042',
    'NZ100042\n',
    'NZ10004a',
    7,
    null,
    undefined,
    ['NZ100042'],
  ])('rejects %p', (value) => {
    expect(isOrderNumber(value)).toBe(false);
  });
});

describe('singleParam', () => {
  it('reads one string and refuses a repeated or missing parameter', () => {
    expect(singleParam('NZ100042')).toBe('NZ100042');
    expect(singleParam(['a', 'b'])).toBeUndefined();
    expect(singleParam(undefined)).toBeUndefined();
  });
});

describe('timelineEvents', () => {
  it('orders the history oldest first', () => {
    const events = timelineEvents({
      placedAt: '2026-01-05T10:00:00.000Z',
      history: [
        { fromStatus: 'pending', toStatus: 'confirmed', at: '2026-01-05T12:00:00.000Z' },
        { fromStatus: null, toStatus: 'pending', at: '2026-01-05T10:00:00.000Z' },
      ],
    });

    expect(events.map((event) => event.status)).toEqual(['pending', 'confirmed']);
  });

  it('starts from the moment of placing when nothing was recorded', () => {
    expect(timelineEvents({ placedAt: '2026-01-05T10:00:00.000Z', history: [] })).toEqual([
      { status: 'pending', at: '2026-01-05T10:00:00.000Z' },
    ]);
  });
});

describe('address helpers', () => {
  it('writes the address the way a parcel is addressed', () => {
    const lines = addressLines({
      recipientName: 'Ayesha',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: '1205',
      landmark: 'Star Mosque',
    });

    expect(lines).toEqual([
      'House 12, Road 5',
      'Near Star Mosque',
      'Dhanmondi, Dhaka 1205',
      'Dhaka Division',
    ]);
  });

  it('shows a Bangladeshi mobile number the way it is written locally', () => {
    expect(formatBdPhone('+8801712345678')).toBe('01712-345678');
    expect(formatBdPhone('01712345678')).toBe('01712345678');
    expect(formatBdPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('links a product only for a well-formed slug', () => {
    expect(isProductSlug('cotton-kurta')).toBe(true);
    expect(isProductSlug('')).toBe(false);
    expect(isProductSlug('../checkout')).toBe(false);
    expect(isProductSlug('Cotton Kurta')).toBe(false);
  });
});
