import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Font, Glyph } from 'fontkit';

/*
 * Bengali text for the PDF writer (server-side only).
 *
 * The writer's built-in Helvetica covers Latin text only. For Bengali this module shapes
 * runs with fontkit (OpenType layout with an Indic shaper: conjuncts, vowel-sign
 * reordering, reph, mark positioning) using Noto Sans Bengali (SIL Open Font License 1.1,
 * package @fontsource/noto-sans-bengali, TrueType outlines, Regular 400 and Bold 700), and
 * `pdf.ts` embeds the glyphs actually used as a CIDFontType2 / Identity-H composite font.
 *
 * Fonts are read and parsed lazily, once per process, on the first text that needs them.
 * If a font cannot be loaded, `splitRuns` answers null and the writer keeps its old
 * behaviour (characters outside WinAnsi show as "?"); nothing throws.
 */

export type BengaliWeight = 'regular' | 'bold';

const FILES: Readonly<Record<BengaliWeight, string>> = {
  regular: 'noto-sans-bengali-bengali-400-normal.woff',
  bold: 'noto-sans-bengali-bengali-700-normal.woff',
};

interface Face {
  font: Font;
  unitsPerEm: number;
}

type FontkitModule = { create: (buffer: Buffer) => Font | { fonts: Font[] } };

let fontkit: FontkitModule | undefined;
function packagedFontFile(weight: BengaliWeight): Buffer {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('@fontsource/noto-sans-bengali/package.json'));
  return readFileSync(join(root, 'files', FILES[weight]));
}

let readFontFile: (weight: BengaliWeight) => Buffer = packagedFontFile;
const faces = new Map<BengaliWeight, Face | null>();
const shapedCache = new Map<string, ShapedRun>();
const SHAPED_CACHE_LIMIT = 4000;

/**
 * Replaces where the font files come from, or clears everything that was loaded
 * (`undefined` restores the packaged files). Used by tests to simulate a missing font.
 */
export function configureBengaliFonts(source?: (weight: BengaliWeight) => Buffer): void {
  faces.clear();
  shapedCache.clear();
  fontkit = undefined;
  readFontFile = source ?? packagedFontFile;
}

function loadFace(weight: BengaliWeight): Face | null {
  const known = faces.get(weight);
  if (known !== undefined) return known;
  let face: Face | null = null;
  try {
    if (fontkit === undefined) {
      fontkit = createRequire(import.meta.url)('fontkit') as FontkitModule;
    }
    const opened = fontkit.create(readFontFile(weight));
    const font = 'fonts' in opened ? opened.fonts[0] : opened;
    if (font && font.unitsPerEm > 0 && font.hasGlyphForCodePoint(0x995)) {
      // Prove now that the file can be subset, so embedding later cannot fail halfway.
      const probe = createSubset(font);
      probe.includeGlyph(font.glyphForCodePoint(0x995).id);
      if (probe.encode().length > 0) face = { font, unitsPerEm: font.unitsPerEm };
    }
  } catch {
    face = null;
  }
  faces.set(weight, face);
  return face;
}

// ---------------------------------------------------------------------------
// Splitting text into Latin (Helvetica) and Bengali (embedded font) runs
// ---------------------------------------------------------------------------

export interface TextRun {
  kind: 'latin' | 'bengali';
  text: string;
}

const ZERO_WIDTH_JOINERS = new Set([0x200c, 0x200d]);

/** Whether the writer's WinAnsi path can show this code point (see `winAnsi` in pdf.ts). */
export type WinAnsiTest = (codePoint: number) => boolean;

/**
 * The text split into runs, or null when it has no Bengali to embed (no character outside
 * WinAnsi that the font covers, or the font is unavailable). Spaces and joiners between two
 * Bengali characters stay inside the Bengali run so a phrase is shaped and drawn as one.
 */
export function splitRuns(
  text: string,
  weight: BengaliWeight,
  inWinAnsi: WinAnsiTest,
): TextRun[] | null {
  let candidate = false;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (!inWinAnsi(code)) {
      candidate = true;
      break;
    }
  }
  if (!candidate) return null;
  const face = loadFace(weight);
  if (!face) return null;

  const chars = [...text.normalize('NFC')];
  const covered = chars.map((char) => {
    const code = char.codePointAt(0) ?? 0;
    return !inWinAnsi(code) && !ZERO_WIDTH_JOINERS.has(code) && face.font.hasGlyphForCodePoint(code);
  });
  if (!covered.some(Boolean)) return null;

  // A space or joiner between two Bengali characters belongs to the Bengali run.
  const bengali = chars.map((char, index) => {
    if (covered[index]) return true;
    const code = char.codePointAt(0) ?? 0;
    const joiner = ZERO_WIDTH_JOINERS.has(code);
    if (!joiner && code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
    let before = index - 1;
    while (before >= 0 && !covered[before] && isGap(chars[before])) before -= 1;
    let after = index + 1;
    while (after < chars.length && !covered[after] && isGap(chars[after])) after += 1;
    const prevBengali = before >= 0 && covered[before] === true;
    const nextBengali = after < chars.length && covered[after] === true;
    return joiner ? prevBengali : prevBengali && nextBengali;
  });

  const runs: TextRun[] = [];
  chars.forEach((char, index) => {
    const kind = bengali[index] ? 'bengali' : 'latin';
    const last = runs[runs.length - 1];
    if (last?.kind === kind) last.text += char;
    else runs.push({ kind, text: char });
  });
  return runs;
}

function isGap(char: string | undefined): boolean {
  if (char === undefined) return false;
  const code = char.codePointAt(0) ?? 0;
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || ZERO_WIDTH_JOINERS.has(code);
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

export interface ShapedGlyph {
  /** Glyph id in the full font (this is the CID written to the PDF). */
  id: number;
  /** Pen advance after the glyph, in 1/1000 em. */
  advance: number;
  xOffset: number;
  yOffset: number;
  /** The glyph's default advance from the font's metrics, in 1/1000 em. */
  width: number;
  /** The characters this glyph stands for (a cluster for ligatures and conjuncts). */
  codePoints: number[];
}

export interface ShapedRun {
  glyphs: ShapedGlyph[];
  /** Total advance in 1/1000 em. */
  width: number;
}

/** A Bengali run shaped with real OpenType layout (cached). Null when the font is missing. */
export function shapeBengali(text: string, weight: BengaliWeight): ShapedRun | null {
  const face = loadFace(weight);
  if (!face) return null;
  const key = `${weight}\u0000${text}`;
  const cached = shapedCache.get(key);
  if (cached) return cached;
  let run: ShapedRun;
  try {
    const scale = 1000 / face.unitsPerEm;
    const layout = face.font.layout(text);
    let width = 0;
    const glyphs = layout.glyphs.map((glyph: Glyph, index: number) => {
      const position = layout.positions[index];
      const advance = (position?.xAdvance ?? glyph.advanceWidth) * scale;
      width += advance;
      return {
        id: glyph.id,
        advance,
        xOffset: (position?.xOffset ?? 0) * scale,
        yOffset: (position?.yOffset ?? 0) * scale,
        width: glyph.advanceWidth * scale,
        codePoints: [...glyph.codePoints],
      };
    });
    run = { glyphs, width };
  } catch {
    return null;
  }
  if (shapedCache.size >= SHAPED_CACHE_LIMIT) shapedCache.clear();
  shapedCache.set(key, run);
  return run;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

interface TrueTypeSubset {
  includeGlyph(glyph: number): number;
  encode(): Uint8Array;
}

function createSubset(font: Font): TrueTypeSubset {
  return (font as unknown as { createSubset(): TrueTypeSubset }).createSubset();
}

/** Glyphs used from one face: glyph id → the text it showed, and its default width. */
export type GlyphUsage = Map<number, { width: number; codePoints: number[] }>;

export interface EmbeddedFont {
  /** PDF objects in order: Type0 font, CIDFont, descriptor, font file, ToUnicode, CIDToGIDMap. */
  objects: (string | Buffer)[];
}

const hex4 = (value: number) => value.toString(16).toUpperCase().padStart(4, '0');

function utf16Hex(codePoints: readonly number[]): string {
  let out = '';
  for (const code of codePoints) {
    if (code > 0xffff) {
      const offset = code - 0x10000;
      out += hex4(0xd800 + (offset >> 10)) + hex4(0xdc00 + (offset & 0x3ff));
    } else out += hex4(code);
  }
  return out;
}

/** "FEFF…" UTF-16BE hex for an ActualText or Unicode title string. */
export function utf16BeHex(text: string): string {
  return `FEFF${utf16Hex([...text].map((char) => char.codePointAt(0) ?? 0x3f))}`;
}

function streamObject(dictionary: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${String(data.length)} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

/**
 * The PDF objects for the glyphs a document used from one face. `firstId` is the object number
 * the Type0 font will have; the other five follow it.
 */
export function buildEmbeddedFont(
  weight: BengaliWeight,
  usage: GlyphUsage,
  firstId: number,
): EmbeddedFont {
  const face = loadFace(weight);
  if (!face) throw new Error('Bengali font is not available');
  const scale = 1000 / face.unitsPerEm;
  const ids = [...usage.keys()].sort((a, b) => a - b);

  // Subset the TrueType outlines; the CIDToGIDMap maps each original glyph id (the CID used
  // in the content stream) to its place in the subset.
  const subset = createSubset(face.font);
  const maxId = ids[ids.length - 1] ?? 0;
  const cidToGid = Buffer.alloc((maxId + 1) * 2);
  for (const id of ids) cidToGid.writeUInt16BE(subset.includeGlyph(id), id * 2);
  const fontFile = Buffer.from(subset.encode());

  // A stable six-letter tag derived from the glyphs used (PDF subset naming convention).
  let hash = 5381;
  for (const id of ids) hash = (hash * 33 + id) >>> 0;
  let tag = '';
  for (let i = 0; i < 6; i += 1) {
    tag += String.fromCharCode(65 + (hash % 26));
    hash = Math.floor(hash / 26) + i * 7;
  }
  const baseFont = `${tag}+NotoSansBengali-${weight === 'bold' ? 'Bold' : 'Regular'}`;

  const font = face.font;
  const bbox = font.bbox;
  const widths = ids
    .map((id) => `${String(id)} [${String(Math.round(usage.get(id)?.width ?? 0))}]`)
    .join(' ');
  // Glyphs that stand for no character of their own (the connecting half of a pre-base
  // vowel sign, for example) get no entry; copy and search come from ActualText on each run.
  const mappings = ids.flatMap((id) => {
    const codePoints = usage.get(id)?.codePoints ?? [];
    return codePoints.length > 0 ? [`<${hex4(id)}> <${utf16Hex(codePoints)}>`] : [];
  });
  const toUnicode =
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    chunk(mappings, 100) +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';

  const descriptor =
    `<< /Type /FontDescriptor /FontName /${baseFont} /Flags 4 ` +
    `/FontBBox [${[bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((v) => String(Math.round(v * scale))).join(' ')}] ` +
    `/ItalicAngle 0 /Ascent ${String(Math.round(font.ascent * scale))} ` +
    `/Descent ${String(Math.round(font.descent * scale))} ` +
    `/CapHeight ${String(Math.round((font.capHeight || font.ascent) * scale))} ` +
    `/StemV ${weight === 'bold' ? '140' : '80'} /FontFile2 ${String(firstId + 3)} 0 R >>`;

  return {
    objects: [
      `<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} /Encoding /Identity-H ` +
        `/DescendantFonts [${String(firstId + 1)} 0 R] /ToUnicode ${String(firstId + 4)} 0 R >>`,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseFont} ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${String(firstId + 2)} 0 R /DW 1000 /W [${widths}] ` +
        `/CIDToGIDMap ${String(firstId + 5)} 0 R >>`,
      descriptor,
      streamObject(
        `/Filter /FlateDecode /Length1 ${String(fontFile.length)}`,
        deflateSync(fontFile),
      ),
      streamObject('', Buffer.from(toUnicode, 'latin1')),
      streamObject('/Filter /FlateDecode', deflateSync(cidToGid)),
    ],
  };
}

/** bfchar entries in blocks of at most `size` (the CMap limit), each as its own block. */
function chunk(lines: readonly string[], size: number): string {
  let out = '';
  for (let i = 0; i < lines.length; i += size) {
    const block = lines.slice(i, i + size);
    out += `${String(block.length)} beginbfchar\n${block.join('\n')}\nendbfchar\n`;
  }
  return out;
}
