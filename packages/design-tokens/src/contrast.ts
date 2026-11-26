/** WCAG 2.2 relative luminance and contrast ratio for opaque sRGB hex colours. */

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) throw new Error(`Expected an opaque hex colour, received "${hex}"`);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function linearChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(linearChannel) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composites `foreground` at `alpha` over an opaque `background`, e.g. for opacity states. */
export function blend(foreground: string, background: string, alpha: number): string {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  const mixed = fg.map((channel, i) => Math.round(channel * alpha + (bg[i] ?? 0) * (1 - alpha)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2.2 AA minimums. */
export const AA = {
  /** Normal-size text (1.4.3). */
  text: 4.5,
  /** Large text, and non-text UI such as focus indicators and input borders (1.4.3 / 1.4.11). */
  largeTextOrUi: 3,
} as const;
