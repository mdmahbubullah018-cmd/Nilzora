/*
 * A minimal PDF 1.4 writer (ISO 32000-1 subset).
 *
 * Fonts: Latin text uses the standard Type 1 fonts Helvetica and Helvetica-Bold, which every
 * PDF reader has built in, with WinAnsiEncoding. Nothing is embedded for it, so Latin-only
 * files stay small and byte-for-byte what this writer always produced.
 *
 * Bengali: WinAnsi covers Latin text only (ASCII, Western European letters, common
 * punctuation such as – — ‘ ’ “ ” • €). Text that also holds characters Noto Sans Bengali
 * covers is split into runs (see `pdf-fonts.ts`): Latin runs stay Helvetica, Bengali runs are
 * shaped with real OpenType layout (conjuncts, vowel-sign reordering, reph) and drawn with
 * the glyphs of an embedded subset of Noto Sans Bengali (CIDFontType2, Identity-H, with a
 * ToUnicode map and ActualText so copy and search give the real text). Widths used to fit
 * and wrap text are the shaped advances. Characters neither font covers (other scripts,
 * emoji) are still written as "?", and so is Bengali if the font files cannot be loaded.
 *
 * Latin widths come from the Helvetica published metrics for ASCII; other WinAnsi characters
 * use close approximations, which only affects how long text is shortened to fit.
 *
 * Drawing uses top-left coordinates in points (y grows downwards); the writer converts
 * them to PDF's bottom-left system. Content streams are written uncompressed.
 */

import {
  buildEmbeddedFont,
  shapeBengali,
  splitRuns,
  utf16BeHex,
  type GlyphUsage,
  type TextRun,
} from './pdf-fonts';

export type Rgb = readonly [number, number, number];
export type FontName = 'regular' | 'bold';

function hex(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Nilzora brand colours (see CLAUDE.md). */
export const BRAND = {
  navy: hex('#0F172A'),
  primary: hex('#0284C7'),
  sky: hex('#38BDF8'),
  soft: hex('#F1F5F9'),
  slate: hex('#334155'),
  muted: hex('#64748B'),
  line: hex('#CBD5E1'),
  offWhite: hex('#F8FAFC'),
  white: [1, 1, 1] as Rgb,
} as const;

/** A4 in points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

// ---------------------------------------------------------------------------
// WinAnsiEncoding (Windows-1252)
// ---------------------------------------------------------------------------

/** Unicode code points of WinAnsi bytes 0x80–0x9F (0 = unused). */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
  0x203a, 0x0153, 0, 0x017e, 0x0178,
];
const TO_WIN_ANSI = new Map<number, number>();
CP1252_HIGH.forEach((codePoint, index) => {
  if (codePoint !== 0) TO_WIN_ANSI.set(codePoint, 0x80 + index);
});

const QUESTION = 0x3f;

/** Whether `winAnsi` shows this code point as itself (or drops it) rather than as "?". */
function winAnsiCovers(code: number): boolean {
  return code < 0x80 || (code >= 0xa0 && code <= 0xff) || TO_WIN_ANSI.has(code);
}

/** Text split into Helvetica and Bengali runs, or null for plain WinAnsi text. */
function runsOf(text: string, font: FontName): TextRun[] | null {
  return splitRuns(text, font, winAnsiCovers);
}

/**
 * Text as WinAnsi bytes. Tabs and line breaks become spaces, other control characters
 * are dropped, and every character WinAnsi cannot show (Bengali, emoji, …) becomes "?".
 */
export function winAnsi(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? QUESTION;
    if (code === 0x09 || code === 0x0a || code === 0x0d) bytes.push(0x20);
    else if (code < 0x20 || code === 0x7f) continue;
    else if (code < 0x7f || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else bytes.push(TO_WIN_ANSI.get(code) ?? QUESTION);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Font metrics (units per 1000 em)
// ---------------------------------------------------------------------------

/* Helvetica and Helvetica-Bold widths for ASCII 32–126 (Adobe AFM files). */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
/** Approximate widths for WinAnsi bytes above 126. */
const HIGH_WIDTHS = new Map<number, number>([
  [0x80, 556],
  [0x85, 1000],
  [0x91, 222],
  [0x92, 222],
  [0x93, 333],
  [0x94, 333],
  [0x95, 350],
  [0x96, 556],
  [0x97, 1000],
  [0x99, 1000],
  [0xa0, 278],
  [0xa9, 737],
  [0xae, 737],
  [0xb0, 400],
  [0xd7, 584],
  [0xf7, 584],
]);

function byteWidth(byte: number, font: FontName): number {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA;
  if (byte >= 32 && byte <= 126) return table[byte - 32] ?? 556;
  const high = HIGH_WIDTHS.get(byte);
  if (high !== undefined) return high;
  return byte >= 0xc0 && byte <= 0xde ? 667 : 556;
}

function latinUnits(text: string, font: FontName): number {
  let units = 0;
  for (const byte of winAnsi(text)) units += byteWidth(byte, font);
  return units;
}

/** Width of text in points at a font size (Bengali runs use their shaped advances). */
export function textWidth(text: string, size: number, font: FontName = 'regular'): number {
  const runs = runsOf(text, font);
  if (runs === null) return (latinUnits(text, font) * size) / 1000;
  let units = 0;
  for (const run of runs) {
    units +=
      (run.kind === 'bengali' ? shapeBengali(run.text, font)?.width : undefined) ??
      latinUnits(run.text, font);
  }
  return (units * size) / 1000;
}

const graphemes = new Intl.Segmenter('bn', { granularity: 'grapheme' });

/** Text shortened with "..." so it fits `maxWidth` (unchanged when it already fits). */
export function fitText(text: string, maxWidth: number, size: number, font: FontName = 'regular') {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (textWidth(clean, size, font) <= maxWidth) return clean;
  const ellipsis = '...';
  const room = maxWidth - textWidth(ellipsis, size, font);
  if (room <= 0) return '';
  let result = '';
  // Bengali is cut between whole clusters (a conjunct or a letter with its vowel sign).
  const pieces =
    runsOf(clean, font) === null
      ? clean
      : Array.from(graphemes.segment(clean), (part) => part.segment);
  for (const char of pieces) {
    if (textWidth(result + char, size, font) > room) break;
    result += char;
  }
  return result.trimEnd() + ellipsis;
}

/** Text broken into lines of at most `maxWidth` (words longer than a line are shortened). */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  font: FontName = 'regular',
  maxLines = 3,
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (textWidth(candidate, size, font) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = fitText(word, maxWidth, size, font);
  }
  if (line !== '') lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(`${kept[maxLines - 1] ?? ''} ...`, maxWidth, size, font);
    return kept;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/** A PDF literal string: ( ) and \ escaped, anything outside printable ASCII as octal. */
export function pdfString(text: string): string {
  let out = '(';
  for (const byte of winAnsi(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

const n = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};
const color = (rgb: Rgb) => rgb.map((part) => n(part)).join(' ');

export interface TextOptions {
  size?: number;
  font?: FontName;
  color?: Rgb;
  align?: 'left' | 'right' | 'center';
  /** Shortens the text with "..." to fit. */
  maxWidth?: number;
}

export interface ShapeOptions {
  fill?: Rgb;
  stroke?: Rgb;
  lineWidth?: number;
}

/** One page's drawing operations. Coordinates are top-left based, in points. */
/** Resource names of the embedded Bengali faces (Helvetica is F1 and F2). */
const BENGALI_RESOURCE: Readonly<Record<FontName, string>> = { regular: 'F3', bold: 'F4' };

export class PdfPage {
  readonly ops: string[] = [];
  /** Glyphs drawn with each embedded Bengali face, so the document can subset them. */
  readonly bengali = new Map<FontName, GlyphUsage>();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  private y(top: number): number {
    return this.height - top;
  }

  /** Draws text with its baseline at `y`. */
  text(x: number, y: number, value: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const font = options.font ?? 'regular';
    const shown =
      options.maxWidth === undefined ? value : fitText(value, options.maxWidth, size, font);
    if (shown === '') return;
    const width = textWidth(shown, size, font);
    const left =
      options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    const runs = runsOf(shown, font);
    if (runs !== null) {
      const body = runs.map((run) => this.run(run, size, font)).join(' ');
      this.ops.push(
        `${color(options.color ?? BRAND.slate)} rg BT ${n(left)} ${n(this.y(y))} Td ${body} ET`,
      );
      return;
    }
    this.ops.push(
      `${color(options.color ?? BRAND.slate)} rg BT /${font === 'bold' ? 'F2' : 'F1'} ${n(size)} Tf ${n(left)} ${n(this.y(y))} Td ${pdfString(shown)} Tj ET`,
    );
  }

  /** One run of mixed text: Helvetica for Latin, shaped glyph ids of the embedded face for Bengali. */
  private run(run: TextRun, size: number, font: FontName): string {
    const helvetica = `/${font === 'bold' ? 'F2' : 'F1'} ${n(size)} Tf ${pdfString(run.text)} Tj`;
    const shaped = run.kind === 'bengali' ? shapeBengali(run.text, font) : null;
    if (shaped === null) return helvetica;

    let usage = this.bengali.get(font);
    if (!usage) {
      usage = new Map();
      this.bengali.set(font, usage);
    }
    // TJ numbers are thousandths of an em, subtracted from the pen position: a glyph's
    // offset moves the pen right before it (negative number) and is undone afterwards, and
    // the shaped advance replaces the font's default width.
    const parts: string[] = [];
    let items: string[] = [];
    let carry = 0;
    const flush = () => {
      if (items.length > 0) parts.push(`[${items.join(' ')}] TJ`);
      items = [];
    };
    for (const glyph of shaped.glyphs) {
      if (!usage.has(glyph.id)) {
        usage.set(glyph.id, { width: glyph.width, codePoints: glyph.codePoints });
      }
      const rise = (glyph.yOffset * size) / 1000;
      carry -= glyph.xOffset;
      if (rise !== 0) {
        flush();
        parts.push(`${n(rise)} Ts`);
      }
      if (carry !== 0) items.push(n(carry));
      carry = 0;
      items.push(`<${glyph.id.toString(16).toUpperCase().padStart(4, '0')}>`);
      if (rise !== 0) {
        flush();
        parts.push('0 Ts');
      }
      carry += glyph.width + glyph.xOffset - glyph.advance;
    }
    if (Math.abs(carry) >= 0.005) items.push(n(carry));
    flush();
    return `/Span << /ActualText <${utf16BeHex(run.text)}> >> BDC /${BENGALI_RESOURCE[font]} ${n(size)} Tf ${parts.join(' ')} EMC`;
  }

  private paint(options: ShapeOptions): string {
    const parts: string[] = [];
    if (options.fill) parts.push(`${color(options.fill)} rg`);
    if (options.stroke) parts.push(`${color(options.stroke)} RG ${n(options.lineWidth ?? 0.5)} w`);
    return parts.join(' ');
  }

  private finish(options: ShapeOptions): string {
    if (options.fill && options.stroke) return 'B';
    return options.fill ? 'f' : 'S';
  }

  rect(x: number, y: number, width: number, height: number, options: ShapeOptions): void {
    this.ops.push(
      `${this.paint(options)} ${n(x)} ${n(this.y(y + height))} ${n(width)} ${n(height)} re ${this.finish(options)}`,
    );
  }

  /** A rectangle with rounded corners (cubic Bézier arcs). */
  roundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    options: ShapeOptions,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    const k = r * 0.5523;
    const top = this.y(y);
    const bottom = this.y(y + height);
    const right = x + width;
    this.ops.push(
      [
        this.paint(options),
        `${n(x + r)} ${n(top)} m`,
        `${n(right - r)} ${n(top)} l`,
        `${n(right - r + k)} ${n(top)} ${n(right)} ${n(top - r + k)} ${n(right)} ${n(top - r)} c`,
        `${n(right)} ${n(bottom + r)} l`,
        `${n(right)} ${n(bottom + r - k)} ${n(right - r + k)} ${n(bottom)} ${n(right - r)} ${n(bottom)} c`,
        `${n(x + r)} ${n(bottom)} l`,
        `${n(x + r - k)} ${n(bottom)} ${n(x)} ${n(bottom + r - k)} ${n(x)} ${n(bottom + r)} c`,
        `${n(x)} ${n(top - r)} l`,
        `${n(x)} ${n(top - r + k)} ${n(x + r - k)} ${n(top)} ${n(x + r)} ${n(top)} c`,
        `h ${this.finish(options)}`,
      ].join(' '),
    );
  }

  circle(cx: number, cy: number, radius: number, options: ShapeOptions): void {
    this.roundedRect(cx - radius, cy - radius, radius * 2, radius * 2, radius, options);
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: Rgb, lineWidth = 0.5): void {
    this.ops.push(
      `${color(stroke)} RG ${n(lineWidth)} w ${n(x1)} ${n(this.y(y1))} m ${n(x2)} ${n(this.y(y2))} l S`,
    );
  }

  /** Draws an image the document registered (`PdfDocument.addJpeg`); `y` is its top. */
  image(image: PdfImageRef, x: number, y: number, width: number, height: number): void {
    this.ops.push(
      `q ${n(width)} 0 0 ${n(height)} ${n(x)} ${n(this.y(y + height))} cm /${image.name} Do Q`,
    );
  }
}

/** A JPEG the document embeds once and any page may draw. */
export interface PdfImageRef {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

interface PdfImage extends PdfImageRef {
  readonly jpeg: Buffer;
}

/** The pixel size of a baseline or progressive JPEG, read from its SOF marker; null if not a JPEG. */
export function jpegSize(jpeg: Buffer): { width: number; height: number } | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < jpeg.length) {
    if (jpeg[at] !== 0xff) return null;
    const marker = jpeg[at + 1] ?? 0;
    const length = jpeg.readUInt16BE(at + 2);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];
  private readonly images: PdfImage[] = [];

  /**
   * Registers a three-component (sRGB) JPEG, embedded as it is, and answers the reference pages
   * draw it with. Only real JPEG bytes are accepted: anything else answers null and draws nothing.
   */
  addJpeg(jpeg: Buffer): PdfImageRef | null {
    const size = jpegSize(jpeg);
    if (size === null || size.width <= 0 || size.height <= 0) return null;
    const image: PdfImage = { name: `Im${String(this.images.length + 1)}`, jpeg, ...size };
    this.images.push(image);
    return { name: image.name, width: image.width, height: image.height };
  }

  constructor(
    readonly width: number = A4.width,
    readonly height: number = A4.height,
  ) {}

  addPage(): PdfPage {
    const page = new PdfPage(this.width, this.height);
    this.pages.push(page);
    return page;
  }

  /** The finished file. */
  toBuffer(info: { title: string; createdAt?: Date }): Buffer {
    const created = info.createdAt ?? new Date();
    const dhaka = new Date(created.getTime() + 6 * 3_600_000).toISOString();
    const stamp = `D:${dhaka.slice(0, 4)}${dhaka.slice(5, 7)}${dhaka.slice(8, 10)}${dhaka.slice(11, 13)}${dhaka.slice(14, 16)}${dhaka.slice(17, 19)}+06'00'`;
    const pages = this.pages.length > 0 ? this.pages : [new PdfPage(this.width, this.height)];

    // The Bengali glyphs the whole document used, per face.
    const used = new Map<FontName, GlyphUsage>();
    for (const page of pages) {
      for (const [face, glyphs] of page.bengali) {
        const merged: GlyphUsage =
          used.get(face) ?? new Map<number, { width: number; codePoints: number[] }>();
        for (const [id, glyph] of glyphs) if (!merged.has(id)) merged.set(id, glyph);
        used.set(face, merged);
      }
    }
    const firstPageObject = 6;
    // Embedded font objects (six per face) follow the pages.
    let nextId = firstPageObject + pages.length * 2;
    const embedded = (['regular', 'bold'] as const)
      .filter((face) => used.has(face))
      .map((face) => {
        const firstId = nextId;
        nextId += 6;
        return { face, firstId };
      });
    // Images follow the embedded fonts.
    const imageIds = this.images.map((image) => {
      const id = nextId;
      nextId += 1;
      return { image, id };
    });
    const xObjects =
      imageIds.length === 0
        ? ''
        : ` /XObject << ${imageIds.map(({ image, id }) => `/${image.name} ${String(id)} 0 R`).join(' ')} >>`;
    const fontResources = [
      '/F1 3 0 R /F2 4 0 R',
      ...embedded.map(({ face, firstId }) => `/${BENGALI_RESOURCE[face]} ${String(firstId)} 0 R`),
    ].join(' ');

    // 1 catalog, 2 page tree, 3 and 4 fonts, 5 info, then a page and its content per page.
    const objects: (string | Buffer)[] = [];
    const pageIds = pages.map((_page, index) => firstPageObject + index * 2);
    const title = [...info.title].every((char) => winAnsiCovers(char.codePointAt(0) ?? 0))
      ? pdfString(info.title)
      : `<${utf16BeHex(info.title)}>`;
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`,
    );
    objects.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    objects.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    objects.push(`<< /Producer (Nilzora) /Title ${title} /CreationDate (${stamp}) >>`);
    pages.forEach((page, index) => {
      const contentId = pageIds[index] ?? 0;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << /Font << ${fontResources} >>${xObjects} >> /Contents ${String(contentId + 1)} 0 R >>`,
      );
      const content = page.ops.join('\n');
      objects.push(
        `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
      );
    });
    for (const { face, firstId } of embedded) {
      const glyphs: GlyphUsage =
        used.get(face) ?? new Map<number, { width: number; codePoints: number[] }>();
      objects.push(...buildEmbeddedFont(face, glyphs, firstId).objects);
    }
    for (const { image } of imageIds) {
      objects.push(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${String(image.width)} /Height ${String(image.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(image.jpeg.length)} >>\nstream\n`,
            'latin1',
          ),
          image.jpeg,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
    }

    // The binary comment line tells transfer tools the file is not plain text.
    const head = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1');
    const chunks: Buffer[] = [head];
    let length = head.length;
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(length);
      const piece = Buffer.concat([
        Buffer.from(`${String(index + 1)} 0 obj\n`, 'latin1'),
        typeof object === 'string' ? Buffer.from(object, 'latin1') : object,
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      chunks.push(piece);
      length += piece.length;
    });
    let tail = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
    for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
    tail += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`;
    chunks.push(Buffer.from(tail, 'latin1'));
    return Buffer.concat(chunks);
  }
}

// ---------------------------------------------------------------------------
// Brand pieces shared by every Nilzora document
// ---------------------------------------------------------------------------

export const MARGIN = 36;

/**
 * Just the mark: a navy rounded square with a sky-blue "N" and a small off-white dot, drawn
 * with paths so it stays crisp in every document. `y` is the top of the square.
 */
export function drawBrandMark(page: PdfPage, x: number, y: number, size = 24): void {
  page.roundedRect(x, y, size, size, size * 0.24, { fill: BRAND.navy });
  page.text(x + size / 2, y + size * 0.74, 'N', {
    size: size * 0.66,
    font: 'bold',
    color: BRAND.sky,
    align: 'center',
  });
  page.circle(x + size * 0.8, y + size * 0.2, size * 0.07, { fill: BRAND.offWhite });
}

/**
 * The Nilzora mark and wordmark: the mark above, then "Nil" in navy and "zora" in the
 * primary blue. `y` is the top of the mark; answers with the wordmark's right edge.
 */
export function drawBrand(page: PdfPage, x: number, y: number, size = 24): number {
  drawBrandMark(page, x, y, size);
  const wordSize = size * 0.72;
  const baseline = y + size * 0.74;
  const left = x + size + size * 0.3;
  page.text(left, baseline, 'Nil', { size: wordSize, font: 'bold', color: BRAND.navy });
  const zora = left + textWidth('Nil', wordSize, 'bold');
  page.text(zora, baseline, 'zora', { size: wordSize, font: 'bold', color: BRAND.primary });
  return zora + textWidth('zora', wordSize, 'bold');
}

/** "2026-11-02 16:05" in Dhaka time. */
export function dhakaStamp(date: Date): string {
  const iso = new Date(date.getTime() + 6 * 3_600_000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** The footer of every page: a rule, the generation time and "Page X of Y". */
export function drawFooters(document: PdfDocument, generatedAt: Date, note?: string): void {
  const total = document.pages.length;
  document.pages.forEach((page, index) => {
    const y = page.height - MARGIN + 8;
    page.line(MARGIN, y - 12, page.width - MARGIN, y - 12, BRAND.line);
    const left = note
      ? `${note}  ·  Generated ${dhakaStamp(generatedAt)} (Asia/Dhaka)`
      : `Generated ${dhakaStamp(generatedAt)} (Asia/Dhaka)`;
    page.text(MARGIN, y, left, { size: 7.5, color: BRAND.muted, maxWidth: page.width - 220 });
    page.text(page.width - MARGIN, y, `Page ${String(index + 1)} of ${String(total)}`, {
      size: 7.5,
      color: BRAND.muted,
      align: 'right',
    });
  });
}

// ---------------------------------------------------------------------------
// Tables with automatic pagination
// ---------------------------------------------------------------------------

export interface PdfTableColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
  /** Relative width; columns share the table width in proportion. */
  weight: number;
}

export interface PdfTableOptions {
  columns: readonly PdfTableColumn[];
  rows: readonly (readonly string[])[];
  /** Where the table starts on the current page. */
  top: number;
  /** Starts a new page and answers where the table continues on it. */
  newPage: () => { page: PdfPage; top: number };
  page: PdfPage;
  rowHeight?: number;
  fontSize?: number;
  /** The lowest y a row may reach (above the footer). */
  bottom?: number;
}

/**
 * Draws a table, starting new pages as needed and repeating the header row on each.
 * Answers the page and y where the table ended.
 */
export function drawTable(options: PdfTableOptions): { page: PdfPage; y: number } {
  const rowHeight = options.rowHeight ?? 16;
  const fontSize = options.fontSize ?? 8.5;
  const headerHeight = rowHeight + 4;
  let page = options.page;
  const width = page.width - MARGIN * 2;
  const bottom = options.bottom ?? page.height - MARGIN - 24;
  const totalWeight = options.columns.reduce((sum, column) => sum + column.weight, 0) || 1;
  const widths = options.columns.map((column) => (column.weight / totalWeight) * width);
  const lefts = widths.map(
    (_w, index) => MARGIN + widths.slice(0, index).reduce((a, b) => a + b, 0),
  );
  const padding = 4;

  const anchor = (index: number) => {
    const column = options.columns[index];
    const left = lefts[index] ?? MARGIN;
    const columnWidth = widths[index] ?? 0;
    if (column?.align === 'right') return left + columnWidth - padding;
    if (column?.align === 'center') return left + columnWidth / 2;
    return left + padding;
  };

  const header = (top: number) => {
    page.rect(MARGIN, top, width, headerHeight, { fill: BRAND.navy });
    options.columns.forEach((column, index) => {
      page.text(anchor(index), top + headerHeight / 2 + fontSize * 0.35, column.header, {
        size: fontSize,
        font: 'bold',
        color: BRAND.white,
        align: column.align ?? 'left',
        maxWidth: (widths[index] ?? 0) - padding * 2,
      });
    });
    return top + headerHeight;
  };

  let y = header(options.top);
  options.rows.forEach((row, rowIndex) => {
    if (y + rowHeight > bottom) {
      const next = options.newPage();
      page = next.page;
      y = header(next.top);
    }
    if (rowIndex % 2 === 1) page.rect(MARGIN, y, width, rowHeight, { fill: BRAND.soft });
    options.columns.forEach((column, index) => {
      page.text(anchor(index), y + rowHeight / 2 + fontSize * 0.35, row[index] ?? '', {
        size: fontSize,
        color: BRAND.slate,
        align: column.align ?? 'left',
        maxWidth: (widths[index] ?? 0) - padding * 2,
      });
    });
    y += rowHeight;
    page.line(MARGIN, y, MARGIN + width, y, BRAND.line, 0.3);
  });
  return { page, y };
}

// ---------------------------------------------------------------------------
// A branded report: title, filters, summary strip and a paginated table
// ---------------------------------------------------------------------------

export interface ReportPdfOptions {
  title: string;
  /** The date range and filters, in words. */
  subtitle?: string | undefined;
  kpis?: readonly { label: string; value: string }[] | undefined;
  columns: readonly PdfTableColumn[];
  rows: readonly (readonly string[])[];
  generatedAt: Date;
}

/** Column weights from the header and the longest values (sampled), within bounds. */
export function weightsFor(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  fontSize = 8.5,
): number[] {
  return headers.map((header, index) => {
    let widest = textWidth(header, fontSize, 'bold');
    for (const row of rows.slice(0, 300)) {
      widest = Math.max(widest, textWidth(row[index] ?? '', fontSize));
    }
    return Math.min(220, Math.max(36, widest + 10));
  });
}

export function renderReportPdf(options: ReportPdfOptions): Buffer {
  const landscape = options.columns.length > 6;
  const document = landscape
    ? new PdfDocument(A4.height, A4.width)
    : new PdfDocument(A4.width, A4.height);

  const brandHeader = (page: PdfPage) => {
    drawBrand(page, MARGIN, MARGIN - 6, 22);
    page.text(page.width - MARGIN, MARGIN + 10, options.title, {
      size: 9,
      color: BRAND.muted,
      align: 'right',
      maxWidth: page.width / 2,
    });
    page.line(MARGIN, MARGIN + 26, page.width - MARGIN, MARGIN + 26, BRAND.line);
    return MARGIN + 40;
  };

  const first = document.addPage();
  let top = brandHeader(first);
  first.text(MARGIN, top + 12, options.title, {
    size: 18,
    font: 'bold',
    color: BRAND.navy,
    maxWidth: first.width - MARGIN * 2,
  });
  top += 22;
  if (options.subtitle) {
    first.text(MARGIN, top + 10, options.subtitle, {
      size: 9.5,
      color: BRAND.slate,
      maxWidth: first.width - MARGIN * 2,
    });
    top += 18;
  }
  const kpis = (options.kpis ?? []).slice(0, 6);
  if (kpis.length > 0) {
    top += 8;
    const gap = 8;
    const boxWidth = (first.width - MARGIN * 2 - gap * (kpis.length - 1)) / kpis.length;
    kpis.forEach((kpi, index) => {
      const x = MARGIN + index * (boxWidth + gap);
      first.roundedRect(x, top, boxWidth, 40, 4, { fill: BRAND.soft });
      first.text(x + 8, top + 14, kpi.label, {
        size: 7.5,
        color: BRAND.muted,
        maxWidth: boxWidth - 16,
      });
      first.text(x + 8, top + 31, kpi.value, {
        size: 12,
        font: 'bold',
        color: BRAND.navy,
        maxWidth: boxWidth - 16,
      });
    });
    top += 40;
  }
  top += 14;

  if (options.rows.length === 0) {
    first.text(MARGIN, top + 14, 'No rows match these filters.', { size: 10, color: BRAND.muted });
  } else {
    drawTable({
      columns: options.columns,
      rows: options.rows,
      top,
      page: first,
      newPage: () => {
        const page = document.addPage();
        return { page, top: brandHeader(page) };
      },
    });
  }

  drawFooters(document, options.generatedAt);
  return document.toBuffer({ title: options.title, createdAt: options.generatedAt });
}
