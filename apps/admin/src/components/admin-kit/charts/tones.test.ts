import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ORDER_STATUSES } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { ORDER_STATUS_CHART_TONE } from '../status-badge';
import { CHART_SERIES, CHART_SURFACES, CHART_TONES, seriesTone } from './tones';

/** WCAG relative luminance and contrast ratio of two #RRGGBB colours. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/*
 * The token values as globals.css defines them: the light block is `:root`, the dark
 * one `[data-theme='dark']`. Reading the stylesheet keeps the recorded hex values (and
 * so the contrast checks below) honest when a token changes.
 */
const css = readFileSync(
  fileURLToPath(new URL('../../../app/globals.css', import.meta.url)),
  'utf8',
);

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} block not found in globals.css`);
  return css.slice(start, css.indexOf('\n}', start));
}

function tokens(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name = '', value = ''] of block(selector).matchAll(
    /(--nz-chart-[\w-]+):\s*([^;]+);/g,
  )) {
    found.set(name, value.trim().toUpperCase());
  }
  return found;
}

const declared = { light: tokens(':root'), dark: tokens("[data-theme='dark']") };
const themes = ['light', 'dark'] as const;

/** `text-chart-3` → `--nz-chart-3`. */
function tokenOf(className: string): string {
  const match = /^text-chart-([\w-]+)$/.exec(className);
  if (!match) throw new Error(`${className} is not a chart token class`);
  return `--nz-chart-${match[1] ?? ''}`;
}

describe('chart tones', () => {
  it('reads the chart tokens of both themes from globals.css', () => {
    for (const theme of themes) {
      for (const slot of [1, 2, 3, 4, 5, 6, 7, 8]) {
        expect(declared[theme].get(`--nz-chart-${String(slot)}`)).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it.each(Object.entries(CHART_TONES))('%s records the values of its token', (_, tone) => {
    const token = tokenOf(tone.text);
    expect(declared.light.get(token)).toBe(tone.light);
    expect(declared.dark.get(token)).toBe(tone.dark);
    expect(tone.swatch).toBe(tone.text.replace('text-', 'bg-'));
  });

  it.each(themes)('keeps every tone at 3:1 or more against the %s card surface', (theme) => {
    for (const tone of Object.values(CHART_TONES)) {
      expect(contrast(tone[theme], CHART_SURFACES[theme])).toBeGreaterThanOrEqual(3);
    }
  });

  it('measures the dark tones against the admin dark surface token', () => {
    const surface = /--nz-surface:\s*(#[0-9a-fA-F]{6});/.exec(block("[data-theme='dark']"));
    expect(surface?.[1]?.toUpperCase()).toBe(CHART_SURFACES.dark);
  });

  it('orders the series by the eight palette slots, without cycling', () => {
    expect(CHART_SERIES.map((tone) => CHART_TONES[tone].text)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => `text-chart-${String(slot)}`),
    );
    expect(seriesTone(0)).toBe('primary');
    expect(seriesTone(7)).toBe('sky');
    expect(seriesTone(8)).toBe('neutral');
  });

  it.each(themes)('gives every order status its own colour in the %s theme', (theme) => {
    const colours = ORDER_STATUSES.map(
      (status) => CHART_TONES[ORDER_STATUS_CHART_TONE[status]][theme],
    );
    expect(new Set(colours).size).toBe(ORDER_STATUSES.length);
  });
});
