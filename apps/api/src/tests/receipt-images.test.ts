import type { OrderDetail } from '@nilzora/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { jpegSize, PdfDocument } from '../modules/exports/pdf';
import { receiptLogo, receiptPictures, trustedPictureUrl } from '../modules/orders/receipt-assets';
import { renderReceiptPdf } from '../modules/orders/receipt-pdf';

const MEDIA = 'https://media.nilzora.test';

function line(id: number, image = true): OrderDetail['items'][number] {
  return {
    orderItemId: id,
    productId: '00000000-0000-4000-8000-000000000001',
    variantId: null,
    variantLabel: id % 2 === 0 ? 'Size: M' : null,
    productName: `Cotton panjabi ${String(id)}`,
    productSlug: 'cotton-panjabi',
    sku: `PJ-${String(id)}`,
    unitPriceMinor: 120_000,
    quantity: 1,
    lineTotalMinor: 120_000,
    image: image
      ? {
          url: `${MEDIA}/p/${String(id)}.webp`,
          thumbUrl: `${MEDIA}/p/${String(id)}-t.webp`,
          alt: null,
        }
      : null,
    regularPriceMinor: null,
    catalogPriceMinor: null,
    campaignId: null,
    campaignTitle: null,
    campaignDiscountMinor: 0,
  };
}

function order(lines: number): OrderDetail {
  const items = Array.from({ length: lines }, (_, i) => line(i + 1, i !== 1));
  return {
    orderNumber: 'NZ-20261116-ABCD',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: lines,
    totalMinor: 120_000 * lines + 7_000,
    placedAt: '2026-11-16T10:05:00.000Z',
    preview: [],
    currency: 'BDT',
    subtotalMinor: 120_000 * lines,
    shippingFeeMinor: 7_000,
    discountMinor: 0,
    deliveryZone: 'inside_dhaka',
    shippingAddress: {
      recipientName: 'Rahima Khatun',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: '1212',
      landmark: null,
    },
    customerNote: null,
    cancelReason: null,
    cancelledAt: null,
    items,
    history: [],
    canCancel: true,
  };
}

async function sampleJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 96, height: 96, channels: 3, background: '#38BDF8' } })
    .jpeg()
    .toBuffer();
}

describe('PDF images', () => {
  it('reads a JPEG size and embeds only real JPEG bytes', async () => {
    const jpeg = await sampleJpeg();
    expect(jpegSize(jpeg)).toEqual({ width: 96, height: 96 });
    const document = new PdfDocument();
    expect(document.addJpeg(Buffer.from('not a jpeg'))).toBeNull();
    const ref = document.addJpeg(jpeg);
    expect(ref).toEqual({ name: 'Im1', width: 96, height: 96 });
    document.addPage().image(ref!, 10, 10, 20, 20);
    const pdf = document.toBuffer({ title: 'x' }).toString('latin1');
    expect(pdf).toContain('/XObject << /Im1');
    expect(pdf).toContain('/Width 96 /Height 96 /ColorSpace /DeviceRGB');
    expect(pdf).toContain('cm /Im1 Do Q');
  });
});

describe('receipt assets', () => {
  it('loads the supplied logo as a JPEG on white, at its own proportions', async () => {
    const logo = await receiptLogo();
    expect(logo).not.toBeNull();
    const size = jpegSize(logo!);
    // The supplied lockup is 1023 × 243.
    expect(size!.width / size!.height).toBeCloseTo(1023 / 243, 1);
  });

  it('fetches pictures only from the store media origin over https', () => {
    expect(trustedPictureUrl(`${MEDIA}/p/1.webp`, MEDIA)).toBe(`${MEDIA}/p/1.webp`);
    expect(trustedPictureUrl('https://evil.test/p/1.webp', MEDIA)).toBeNull();
    expect(trustedPictureUrl('http://media.nilzora.test/p/1.webp', MEDIA)).toBeNull();
    expect(trustedPictureUrl('http://169.254.169.254/latest', MEDIA)).toBeNull();
    expect(trustedPictureUrl(`${MEDIA}/p/1.webp`, undefined)).toBeNull();
    expect(
      trustedPictureUrl('https://media.nilzora.test/other/1.webp', `${MEDIA}/catalog`),
    ).toBeNull();
  });

  it('keeps every picture it could read and skips the rest', async () => {
    const jpeg = await sampleJpeg();
    const asked: string[] = [];
    const pictures = await receiptPictures(order(4), MEDIA, (url) => {
      asked.push(url);
      return Promise.resolve(url.includes('/3-') ? null : jpeg);
    });
    // Line 2 has no picture; line 3's could not be read.
    expect([...pictures.keys()].sort()).toEqual([1, 4]);
    expect(asked.every((url) => url.startsWith(`${MEDIA}/`))).toBe(true);
    expect(await receiptPictures(order(2), undefined, () => Promise.resolve(jpeg))).toEqual(
      new Map(),
    );
  });
});

describe('receipt with pictures', () => {
  it('draws the logo on every page and continues a long order on further pages', async () => {
    const jpeg = await sampleJpeg();
    const long = order(30);
    const pictures = new Map(long.items.map((item) => [item.orderItemId, jpeg]));
    const pdf = renderReceiptPdf({ order: long, logo: await receiptLogo(), pictures }).toString(
      'latin1',
    );
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(3);
    // One logo image plus 30 pictures, each embedded once.
    expect(pdf.split('/Subtype /Image').length - 1).toBe(31);
    expect(pdf.split('cm /Im1 Do Q').length - 1).toBe(pages);
    // PDF strings escape parentheses: "(continued)" is written as "\(continued\)".
    expect(pdf).toContain(String.raw`\(continued\)`);
    expect(pdf).toContain('Cotton panjabi 30');
  });
});
