import type { ReportColumn } from '@nilzora/contracts';
import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { csvField, guardFormula, writeCsv } from '../modules/exports/csv';
import { renderOrderDocument } from '../modules/exports/documents';
import { fitText, pdfString, renderReportPdf, textWidth, winAnsi } from '../modules/exports/pdf';
import { columnName, writeXlsx, xmlText } from '../modules/exports/xlsx';
import { writeZip } from '../modules/exports/zip';
import { sampleDocument } from './export-fakes';

/*
 * The zero-dependency writers: CSV (RFC 4180, BOM, formula guard), the ZIP container and
 * the XLSX parts inside it (read back with a small ZIP reader written here), and the PDF
 * structure (header, xref offsets, page count, escaping, the WinAnsi "?" fallback).
 */

const columns: ReportColumn[] = [
  { key: 'name', header: 'Name', type: 'text' },
  { key: 'joined', header: 'Joined', type: 'date' },
  { key: 'at', header: 'Placed', type: 'datetime' },
  { key: 'orders', header: 'Orders', type: 'count' },
  { key: 'spent', header: 'Spent', type: 'money' },
  { key: 'share', header: 'Share', type: 'percent' },
];

const rows = [
  {
    name: 'রহিমা খাতুন',
    joined: '2026-10-01',
    at: '2026-10-25T18:30:00Z',
    orders: 3,
    spent: 1_234_550,
    share: 0.125,
  },
  { name: '=HYPERLINK("http://x")', joined: null, at: null, orders: -2, spent: 0, share: null },
  {
    name: 'Says "hi", then\r\nleaves',
    joined: '2026-10-02',
    at: null,
    orders: 0,
    spent: 5,
    share: 1,
  },
];

/** A ZIP reader for the tests: entries from the central directory, data checked by CRC. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    expect(buffer.readUInt32LE(at)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(at + 10);
    const checksum = buffer.readUInt32LE(at + 16);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    expect(buffer.readUInt32LE(local)).toBe(0x04034b50);
    const localName = buffer.readUInt16LE(local + 26);
    const extra = buffer.readUInt16LE(local + 28);
    const body = buffer.subarray(
      local + 30 + localName + extra,
      local + 30 + localName + extra + size,
    );
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data)).toBe(checksum);
    entries.set(name, data);
    at += 46 + nameLength;
  }
  return entries;
}

/** Object offsets from the xref table, each checked to start "<n> 0 obj". */
function checkXref(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  expect(text.slice(start, start + 4)).toBe('xref');
  const [, first, size] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(start)) ?? [];
  expect(first).toBe('0');
  const lines = text
    .slice(start)
    .split('\n')
    .slice(2, 2 + Number(size));
  expect(lines[0]).toBe('0000000000 65535 f ');
  lines.slice(1).forEach((line, index) => {
    expect(line).toMatch(/^\d{10} 00000 n $/);
    const offset = Number(line.slice(0, 10));
    expect(text.slice(offset).startsWith(`${String(index + 1)} 0 obj\n`)).toBe(true);
  });
  return Number(size);
}

describe('CSV', () => {
  const csv = writeCsv({ columns, rows }).toString('utf8');

  it('starts with a byte-order mark and ends records with CRLF', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')[0]).toBe('\uFEFFName,Joined,Placed (Dhaka time),Orders,Spent,Share');
  });

  it('keeps Bengali text and writes money, counts, percentages and Dhaka times', () => {
    expect(csv.split('\r\n')[1]).toBe('রহিমা খাতুন,2026-10-01,2026-10-26 00:30,3,12345.50,12.5%');
  });

  it('neutralises formulas in text but not negative numbers', () => {
    expect(csv.split('\r\n')[2]).toBe(`"'=HYPERLINK(""http://x"")",,,-2,0.00,`);
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(guardFormula(`${start}SUM(A1)`)).toBe(`'${start}SUM(A1)`);
    }
    expect(guardFormula('Normal')).toBe('Normal');
  });

  it('quotes fields with quotes, commas or line breaks (RFC 4180)', () => {
    expect(csv).toContain('"Says ""hi"", then\r\nleaves",2026-10-02,,0,0.05,100.0%');
    expect(csvField('plain')).toBe('plain');
  });
});

describe('XLSX', () => {
  const at = new Date('2026-11-02T10:00:00Z');
  const workbook = writeXlsx({ columns, rows }, 'Customers: New / Old', at);
  const parts = readZip(workbook);

  it('is a ZIP holding the six workbook parts, every CRC valid', () => {
    expect(workbook.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect([...parts.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(parts.get('xl/workbook.xml')?.toString()).toContain(
      '<sheet name="Customers  New   Old"',
    );
  });

  it('writes a bold, frozen header, real numbers with money and percent formats, and text', () => {
    const sheet = parts.get('xl/worksheets/sheet1.xml')?.toString() ?? '';
    expect(sheet).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t>Name</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>রহিমা খাতুন</t></is></c>');
    expect(sheet).toContain('<c r="C2" t="inlineStr"><is><t>2026-10-26 00:30</t></is></c>');
    expect(sheet).toContain('<c r="D2" s="3"><v>3</v></c>');
    expect(sheet).toContain('<c r="E2" s="2"><v>12345.5</v></c>');
    expect(sheet).toContain('<c r="F2" s="4"><v>0.125</v></c>');
    expect(sheet).toContain('<t>=HYPERLINK(&quot;http://x&quot;)</t>');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toMatch(/<col min="1" max="1" width="\d+" customWidth="1"\/>/);
    expect(sheet).toContain('<dimension ref="A1:F4"/>');
    const styles = parts.get('xl/styles.xml')?.toString() ?? '';
    expect(styles).toContain('formatCode="#,##0.00"');
    expect(styles).toContain('<b/>');
  });

  it('escapes XML and drops characters XML cannot hold', () => {
    expect(xmlText('a<b>&"c"\u0001')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
    expect([0, 25, 26, 701].map(columnName)).toEqual(['A', 'Z', 'AA', 'ZZ']);
  });

  it('round-trips an arbitrary archive', () => {
    const data = Buffer.from('x'.repeat(5000));
    const tiny = Buffer.from('ab');
    const archive = readZip(
      writeZip([
        { name: 'big.txt', data },
        { name: 'tiny.txt', data: tiny },
      ]),
    );
    expect(archive.get('big.txt')).toEqual(data);
    expect(archive.get('tiny.txt')).toEqual(tiny);
  });
});

describe('PDF', () => {
  const generatedAt = new Date('2026-11-02T10:00:00Z');
  const tableRows = Array.from({ length: 200 }, (_, i) => [
    `Row ${String(i + 1)}`,
    'Tk 10.00',
    '1',
  ]);
  const pdf = renderReportPdf({
    title: 'Orders (test) \\ report',
    columns: [
      { header: 'Order', weight: 2 },
      { header: 'Total', weight: 1, align: 'right' },
      { header: 'Items', weight: 1, align: 'right' },
    ],
    rows: tableRows,
    generatedAt,
  });
  const text = pdf.toString('latin1');

  it('is a PDF 1.4 file whose xref offsets point at each object', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    expect(checkXref(pdf)).toBe(16);
  });

  it('paginates a long table, repeating the header row on every page', () => {
    // 40 rows fit under the title on page 1, then 42 per page: 200 rows take 5 pages.
    expect(text).toContain('/Count 5');
    expect(text.match(/\/Type \/Page /g)).toHaveLength(5);
    expect(text.match(/\(Order\) Tj/g)).toHaveLength(5);
    expect(text).toContain('(Page 5 of 5) Tj');
    expect(text).toContain('(Row 200) Tj');
    expect(text).toContain('(Generated 2026-11-02 16:00 \\(Asia/Dhaka\\)) Tj');
  });

  it('draws the brand mark and wordmark with Helvetica in brand colours', () => {
    expect(text).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(text).toContain('(Nil) Tj');
    expect(text).toContain('(zora) Tj');
    // Navy #0F172A as the mark's fill.
    expect(text).toContain('0.06 0.09 0.16 rg');
  });

  it('escapes parentheses and backslashes', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
    expect(text).toContain('(Orders \\(test\\) \\\\ report) Tj');
  });

  it('shows characters outside WinAnsi, such as Bengali, as "?"', () => {
    expect(winAnsi('রহিম')).toEqual([0x3f, 0x3f, 0x3f, 0x3f]);
    expect(winAnsi('Café – “ok” €')).toEqual([
      0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x93, 0x6f, 0x6b, 0x94, 0x20, 0x80,
    ]);
    expect(pdfString('é')).toBe('(\\351)');
  });

  it('measures and shortens text with the font metrics', () => {
    // N 722 + i 278 + l 278 + z 500 + o 611 + r 389 + a 556 = 3334 units.
    expect(textWidth('Nilzora', 10, 'bold')).toBeCloseTo(33.34, 2);
    const fitted = fitText('A rather long product name for one cell', 60, 9);
    expect(fitted.endsWith('...')).toBe(true);
    expect(textWidth(fitted, 9)).toBeLessThanOrEqual(60);
  });
});

describe('order documents', () => {
  const at = new Date('2026-11-02T10:00:00Z');
  const data = sampleDocument('NZ100123');

  it('prints an invoice with prices, totals and the delivery details', () => {
    const invoice = renderOrderDocument(data, 'invoice', at);
    const text = invoice.toString('latin1');
    checkXref(invoice);
    for (const part of [
      '(Invoice) Tj',
      '(Order NZ100123) Tj',
      '(Unit price) Tj',
      '(Tk 340.00) Tj',
      '(- Tk 20.00) Tj',
      '(Phone: +8801712345678) Tj',
      '(Desk Lamp - Colour: Navy) Tj',
      '(Collect Tk 340.00 in cash on delivery.) Tj',
      '(Please call \\(before\\) noon) Tj',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('prints a packing slip without any price', () => {
    const slip = renderOrderDocument(data, 'packing_slip', at).toString('latin1');
    expect(slip).toContain('(Packing slip) Tj');
    expect(slip).toContain('(Packed) Tj');
    expect(slip).not.toContain('Tk ');
    expect(slip).not.toContain('Unit price');
  });

  it('embeds a Bengali name with a font rather than replacing it by question marks', () => {
    const bengali = { ...data, delivery: { ...data.delivery, recipientName: 'রহিমা' } };
    const pdf = renderOrderDocument(bengali, 'invoice', at);
    const text = pdf.toString('latin1');
    checkXref(pdf);
    expect(text).toContain('/Subtype /CIDFontType2');
    expect(text).not.toContain('(?????) Tj');
  });
});
