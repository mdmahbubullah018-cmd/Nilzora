import type { OrderDetail } from '@nilzora/contracts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { create, type Font } from 'fontkit';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOrderDocument } from '../modules/exports/documents';
import { configureBengaliFonts, shapeBengali } from '../modules/exports/pdf-fonts';
import {
  fitText,
  PdfDocument,
  pdfString,
  renderReportPdf,
  textWidth,
  wrapText,
} from '../modules/exports/pdf';
import { renderReceiptPdf } from '../modules/orders/receipt-pdf';
import { sampleDocument } from './export-fakes';

/*
 * Bengali in the PDF writer: real OpenType shaping (fontkit's Indic shaper), an embedded
 * Noto Sans Bengali subset (CIDFontType2, Identity-H, ToUnicode), mixed Latin and Bengali
 * runs, measuring/truncating/wrapping with shaped advances, and the "?" fallback when the
 * font cannot be loaded. Latin-only files must stay byte-for-byte what the writer produced
 * before Bengali support.
 */

afterEach(() => {
  configureBengaliFonts();
});

const at = new Date('2026-11-02T10:00:00Z');

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** The raw bytes of a stream object, found through the xref table. */
function streamOf(pdf: Buffer, objectNumber: number): { dictionary: string; data: Buffer } {
  const text = pdf.toString('latin1');
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  const lines = text.slice(start).split('\n').slice(2);
  const offset = Number(lines[objectNumber]?.slice(0, 10));
  const head = text.slice(offset);
  const match = /^\d+ 0 obj\n<<(.*?)>>\nstream\n/s.exec(head);
  expect(match).not.toBeNull();
  const dictionary = match?.[1] ?? '';
  const length = Number(/\/Length (\d+)/.exec(dictionary)?.[1]);
  const from = offset + (match?.[0].length ?? 0);
  return { dictionary, data: pdf.subarray(from, from + length) };
}

/** Every object starts where the xref table says it does. */
function checkXref(pdf: Buffer): void {
  const text = pdf.toString('latin1');
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  expect(text.slice(start, start + 4)).toBe('xref');
  const size = Number(/^xref\n0 (\d+)\n/.exec(text.slice(start))?.[1]);
  const lines = text.slice(start).split('\n').slice(2, 2 + size);
  lines.slice(1).forEach((line, index) => {
    const offset = Number(line.slice(0, 10));
    expect(text.slice(offset).startsWith(`${String(index + 1)} 0 obj\n`)).toBe(true);
  });
}

function fullFont(weight: 'regular' | 'bold'): Font {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('@fontsource/noto-sans-bengali/package.json'));
  const file = `noto-sans-bengali-bengali-${weight === 'bold' ? '700' : '400'}-normal.woff`;
  return create(readFileSync(join(root, 'files', file))) as Font;
}

describe('Latin-only documents are unchanged', () => {
  const report = renderReportPdf({
    title: 'Orders (test)  report',
    subtitle: 'From 1 to 5 — “x” é',
    kpis: [{ label: 'Total', value: 'Tk 10' }],
    columns: [
      { header: 'Order', weight: 2 },
      { header: 'Total', weight: 1, align: 'right' },
    ],
    rows: Array.from({ length: 120 }, (_, i) => [
      `Row ${String(i + 1)} Café — long text to be truncated for sure sure sure sure sure`,
      'Tk 10.00',
    ]),
    generatedAt: at,
  });

  it('keeps the exact bytes the writer produced before Bengali support', () => {
    // Hashes taken from the writer before the embedded-font path existed.
    expect(sha256(report)).toBe(
      '4babf9586b57dc44640d237cc3594cdf7788f69cc60cfe762ccc653cd9b1f177',
    );
    expect(sha256(renderOrderDocument(sampleDocument('NZ100123'), 'invoice', at))).toBe(
      'a1e2ab7897839483dcfb45c15ba4977e4712597d2d73219e8d4c000b5d283dd3',
    );
    expect(sha256(renderOrderDocument(sampleDocument('NZ100123'), 'packing_slip', at))).toBe(
      'c57a6af4cc4ccaf0c54a36cb5ed7b44c5a95967654b3a154392fa15a990c83e2',
    );
  });

  it('embeds no font file and loads no Bengali font', () => {
    const text = report.toString('latin1');
    expect(text).not.toContain('CIDFontType2');
    expect(text).not.toContain('FontFile2');
    expect(text).toContain('/Font << /F1 3 0 R /F2 4 0 R >>');
  });
});

describe('shaping', () => {
  const font = fullFont('regular');
  const plain = (text: string) => font.glyphsForString(text).map((glyph) => glyph.id);

  it('turns a conjunct into one glyph instead of the plain cmap sequence', () => {
    const shaped = shapeBengali('ক্ষ', 'regular');
    expect(shaped).not.toBeNull();
    const ids = shaped?.glyphs.map((glyph) => glyph.id) ?? [];
    expect(plain('ক্ষ')).toHaveLength(3);
    expect(ids).toHaveLength(1);
    expect(ids).not.toEqual(plain('ক্ষ'));
    expect(shaped?.glyphs[0]?.codePoints).toEqual([0x995, 0x9cd, 0x9b7]);
  });

  it('moves a pre-base vowel sign in front of its consonant', () => {
    const shaped = shapeBengali('কি', 'regular');
    const ids = shaped?.glyphs.map((glyph) => glyph.id) ?? [];
    const naive = plain('কি');
    expect(ids).toHaveLength(2);
    expect(ids).not.toEqual(naive);
    // Logical order is ক then ি; the shaped (visual) order starts with the vowel sign.
    expect(shaped?.glyphs[0]?.codePoints).toEqual([0x9bf]);
    expect(shaped?.glyphs[1]?.codePoints).toEqual([0x995]);
    expect(ids[1]).toBe(naive[0]);
  });

  it('reports the shaped advance as the run width', () => {
    const shaped = shapeBengali('রহিম', 'regular');
    const sum = shaped?.glyphs.reduce((total, glyph) => total + glyph.advance, 0) ?? 0;
    expect(shaped?.width).toBeCloseTo(sum, 6);
    expect(shaped?.width).toBeGreaterThan(0);
  });
});

describe('embedding', () => {
  const document = new PdfDocument(400, 200);
  const page = document.addPage();
  page.text(20, 40, 'ক্ষ কি রহিম', { size: 20 });
  page.text(20, 80, 'রহিম', { size: 20, font: 'bold' });
  const pdf = document.toBuffer({ title: 'Bengali test', createdAt: at });
  const text = pdf.toString('latin1');

  it('writes a valid file with composite fonts, a descriptor and a font file per face', () => {
    checkXref(pdf);
    expect(text.match(/\/Subtype \/Type0/g)).toHaveLength(2);
    expect(text.match(/\/Subtype \/CIDFontType2/g)).toHaveLength(2);
    expect(text.match(/\/Encoding \/Identity-H/g)).toHaveLength(2);
    expect(text.match(/\/Type \/FontDescriptor/g)).toHaveLength(2);
    expect(text.match(/\/FontFile2 /g)).toHaveLength(2);
    expect(text.match(/\/ToUnicode /g)).toHaveLength(2);
    expect(text).toContain('/BaseFont /');
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansBengali-Regular/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansBengali-Bold/);
    expect(text).toContain('/F1 3 0 R /F2 4 0 R /F3 ');
    expect(text).toContain(' /F4 ');
  });

  it('embeds a compressed TrueType subset, far smaller than the whole font', () => {
    const file = /\/FontFile2 (\d+) 0 R/.exec(text);
    const { dictionary, data } = streamOf(pdf, Number(file?.[1]));
    expect(dictionary).toContain('/Filter /FlateDecode');
    const ttf = inflateSync(data);
    expect(Number(/\/Length1 (\d+)/.exec(dictionary)?.[1])).toBe(ttf.length);
    // fontkit writes the Apple 'true' scaler tag; both it and 0x00010000 mean TrueType outlines.
    expect([0x00010000, 0x74727565]).toContain(ttf.readUInt32BE(0));
    expect(ttf.length).toBeLessThan(20_000);
    expect(pdf.length).toBeLessThan(40_000);
    // The subset is a real font fontkit can open again, with only the glyphs used (plus .notdef).
    const reopened = create(ttf) as Font;
    expect(reopened.numGlyphs).toBeLessThan(40);
  });

  it('draws the shaped glyph ids, not the plain cmap sequence', () => {
    const shaped = shapeBengali('ক্ষ কি রহিম', 'regular');
    const ids = (shaped?.glyphs ?? []).map((glyph) => glyph.id.toString(16).toUpperCase().padStart(4, '0'));
    const content = page.ops[0] ?? '';
    for (const id of ids) expect(content).toContain(`<${id}>`);
    const plainIds = fullFont('regular')
      .glyphsForString('ক্ষ কি রহিম')
      .map((glyph) => glyph.id.toString(16).toUpperCase().padStart(4, '0'));
    expect(plainIds.join('')).not.toBe(ids.join(''));
    // ActualText gives readers the real logical text for copy and search.
    expect(content).toContain('/ActualText <FEFF0995' + '09CD' + '09B7' + '0020' + '0995' + '09BF');
  });

  it('maps the glyphs back to Unicode in the ToUnicode CMap', () => {
    const map = /\/ToUnicode (\d+) 0 R/.exec(text);
    const cmap = streamOf(pdf, Number(map?.[1])).data.toString('latin1');
    expect(cmap).toContain('begincmap');
    expect(cmap).toContain('beginbfchar');
    const conjunct = shapeBengali('ক্ষ', 'regular')?.glyphs[0]?.id ?? -1;
    expect(cmap).toContain(
      `<${conjunct.toString(16).toUpperCase().padStart(4, '0')}> <099509CD09B7>`,
    );
    const vowel = shapeBengali('কি', 'regular')?.glyphs[0]?.id ?? -1;
    expect(cmap).toContain(`<${vowel.toString(16).toUpperCase().padStart(4, '0')}> <09BF>`);
  });

  it('writes a Unicode document title as UTF-16BE', () => {
    const titled = new PdfDocument().toBuffer({ title: 'রিপোর্ট', createdAt: at });
    expect(titled.toString('latin1')).toContain('/Title <FEFF09B0');
  });
});

describe('mixed Latin and Bengali text', () => {
  const mixed = 'Rahim Uddin রহিম উদ্দিন, House 12';

  it('draws each run with the right font in the right order', () => {
    const document = new PdfDocument(500, 100);
    const page = document.addPage();
    page.text(10, 50, mixed, { size: 12 });
    const op = page.ops[0] ?? '';
    const latinHead = op.indexOf('/F1 12 Tf (Rahim Uddin ) Tj');
    const bengali = op.indexOf('/F3 12 Tf');
    const latinTail = op.indexOf('/F1 12 Tf (, House 12) Tj');
    expect(latinHead).toBeGreaterThan(-1);
    expect(bengali).toBeGreaterThan(latinHead);
    expect(latinTail).toBeGreaterThan(bengali);
    // The space between the two Bengali words stays inside the Bengali run.
    expect(op.match(/BDC/g)).toHaveLength(1);
    expect(op).toContain('/ActualText <FEFF09B0');
  });

  it('measures Bengali with shaped advances, not Helvetica approximations', () => {
    const shaped = shapeBengali('রহিম উদ্দিন', 'regular')?.width ?? 0;
    const latin = textWidth('Rahim Uddin ', 12) + textWidth(', House 12', 12);
    expect(textWidth(mixed, 12)).toBeCloseTo(latin + (shaped * 12) / 1000, 6);
    // Four "?" in Helvetica would be 4 × 556 units.
    expect(textWidth('রহিম', 10)).not.toBeCloseTo((4 * 556 * 10) / 1000, 1);
    expect(textWidth('ক্ষ', 10)).toBeCloseTo(((shapeBengali('ক্ষ', 'regular')?.width ?? 0) * 10) / 1000, 6);
  });

  it('uses the bold face for bold text', () => {
    const regular = textWidth('রহিম উদ্দিন', 10);
    const bold = textWidth('রহিম উদ্দিন', 10, 'bold');
    expect(bold).not.toBe(regular);
    expect(bold).toBeCloseTo(((shapeBengali('রহিম উদ্দিন', 'bold')?.width ?? 0) * 10) / 1000, 6);
  });

  it('shortens text with "..." at a cluster boundary so it fits', () => {
    const long = 'কলাবাগান বাজারের পাশে একটি খুব লম্বা ঠিকানা যা কাটা হবে ক্ষুদ্র গলি';
    const fitted = fitText(long, 120, 9);
    expect(fitted.endsWith('...')).toBe(true);
    expect(fitted.length).toBeLessThan(long.length);
    expect(textWidth(fitted, 9)).toBeLessThanOrEqual(120);
    const body = fitted.slice(0, -3);
    expect(long.startsWith(body)).toBe(true);
    // Never cut right after a hasanta (it would leave half a conjunct) or before a sign.
    expect(body.endsWith('্')).toBe(false);
    expect(fitText('রহিম', 500, 9)).toBe('রহিম');
    // Mixed text, too.
    const mixedFit = fitText(`${mixed} ${long}`, 150, 9);
    expect(mixedFit.startsWith('Rahim Uddin রহিম')).toBe(true);
    expect(textWidth(mixedFit, 9)).toBeLessThanOrEqual(150);
  });

  it('wraps Bengali words into lines that fit', () => {
    const text = 'কলাবাগান বাজারের পাশে একটি খুব লম্বা ঠিকানা যা কয়েক লাইনে ভাঙবে House 12 Road 5';
    const lines = wrapText(text, 110, 9, 'regular', 6);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 9)).toBeLessThanOrEqual(110);
    expect(lines.join(' ')).toBe(text);
  });
});

describe('documents', () => {
  it('draws a Bengali recipient on an invoice and a Bengali cell in a report', () => {
    const data = sampleDocument('NZ100123');
    data.delivery.recipientName = 'রহিম উদ্দিন';
    const invoice = renderOrderDocument(data, 'invoice', at);
    checkXref(invoice);
    expect(invoice.toString('latin1')).toContain('/Subtype /CIDFontType2');

    const report = renderReportPdf({
      title: 'Orders',
      columns: [{ header: 'Customer', weight: 1 }],
      rows: [['ক্ষমা বিশ্বাস'], ['Plain Latin']],
      generatedAt: at,
    });
    checkXref(report);
    const text = report.toString('latin1');
    expect(text).toContain('/Subtype /CIDFontType2');
    expect(text).toContain('(Plain Latin) Tj');
  });

  it('draws a Bengali order receipt with embedded fonts and no "?" fallback', () => {
    const order = {
      orderNumber: 'NZ100777',
      status: 'confirmed',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      itemCount: 2,
      totalMinor: 52_000,
      placedAt: '2026-11-02T08:00:00Z',
      currency: 'BDT',
      subtotalMinor: 46_000,
      shippingFeeMinor: 6_000,
      discountMinor: 0,
      deliveryZone: 'inside_dhaka',
      shippingAddress: {
        recipientName: 'রহিম উদ্দিন',
        phone: '+8801712345678',
        division: 'Dhaka',
        district: 'ঢাকা',
        area: 'ধানমন্ডি',
        addressLine: 'House 12, রোড ৫',
        postalCode: '1209',
        landmark: null,
      },
      customerNote: null,
      cancelReason: null,
      cancelledAt: null,
      items: [
        {
          orderItemId: 1,
          productId: 'p1',
          variantId: null,
          variantLabel: null,
          productName: 'হাতে বোনা সুতির শাড়ি',
          productSlug: 'saree',
          sku: 'SAREE-1',
          unitPriceMinor: 23_000,
          quantity: 2,
          lineTotalMinor: 46_000,
          regularPriceMinor: 23_000,
          catalogPriceMinor: 23_000,
          campaignId: null,
          campaignTitle: null,
          campaignDiscountMinor: 0,
        },
      ],
      history: [{ fromStatus: null, toStatus: 'pending', at: '2026-11-02T08:00:00Z' }],
      canCancel: true,
    } as unknown as OrderDetail;
    const pdf = renderReceiptPdf({ order, generatedAt: at });
    checkXref(pdf);
    const text = pdf.toString('latin1');
    expect(text).toContain('/Subtype /CIDFontType2');
    expect(text).not.toContain('(?????)');
    expect(text).toContain('Order receipt');
  });
});

describe('when the font cannot be loaded', () => {
  it('falls back to "?" without throwing', () => {
    configureBengaliFonts(() => {
      throw new Error('font files are missing');
    });
    expect(shapeBengali('রহিম', 'regular')).toBeNull();
    expect(textWidth('রহিম', 10)).toBeCloseTo((4 * 556 * 10) / 1000, 6);
    expect(fitText('রহিম', 500, 9)).toBe('রহিম');
    expect(pdfString('রহিম')).toBe('(????)');
    const data = sampleDocument('NZ100123');
    data.delivery.recipientName = 'রহিমা';
    const pdf = renderOrderDocument(data, 'invoice', at);
    checkXref(pdf);
    const text = pdf.toString('latin1');
    expect(text).toContain('(?????) Tj');
    expect(text).not.toContain('CIDFontType2');
  });

  it('falls back when the file is not a usable font', () => {
    configureBengaliFonts(() => Buffer.from('this is not a font'));
    expect(textWidth('রহিম', 10)).toBeCloseTo((4 * 556 * 10) / 1000, 6);
    const pdf = renderReportPdf({
      title: 'Orders',
      columns: [{ header: 'Customer', weight: 1 }],
      rows: [['রহিম']],
      generatedAt: at,
    });
    expect(pdf.toString('latin1')).toContain('(????) Tj');
  });

  it('keeps working once the packaged fonts are restored', () => {
    configureBengaliFonts(() => {
      throw new Error('gone');
    });
    expect(shapeBengali('রহিম', 'regular')).toBeNull();
    configureBengaliFonts();
    expect(shapeBengali('রহিম', 'regular')).not.toBeNull();
  });
});
