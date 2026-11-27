// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** [Tailwind colour role, design-token role] pairs whose values are WCAG-checked. */
const verifiedRoles: [string, string][] = [
  ['primary-action', 'primary-action'],
  ['primary-action-hover', 'primary-action-hover'],
  ['primary-action-foreground', 'primary-action-foreground'],
  ['danger-action', 'danger-action'],
  ['danger-action-hover', 'danger-action-hover'],
  ['danger-action-foreground', 'danger-action-foreground'],
  ['offer-badge', 'offer-badge'],
  ['offer-badge-foreground', 'offer-badge-foreground'],
  ['input-border', 'input-border'],
  ['ring', 'ring'],
  ['ring-on-dark', 'ring-on-dark'],
  ['link', 'link'],
  ['muted-foreground', 'muted-foreground'],
];

describe('styles.css', () => {
  it.each(verifiedRoles)('maps --color-%s to the verified --nz-%s token', (role, token) => {
    expect(styles).toMatch(new RegExp(`--color-${role}:\\s*var\\(--nz-${token}\\);`));
  });

  it('only maps Tailwind colours to --nz-* source variables (no circular references)', () => {
    for (const [, value = ''] of styles.matchAll(/--color-[\w-]+:\s*([^;]+);/g)) {
      expect(value).toMatch(/^var\(--nz-[\w-]+\)$/);
    }
  });

  it('keys dark: utilities to an explicit data-theme attribute', () => {
    expect(styles).toContain(
      "@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));",
    );
  });

  it('gives every font variable a fallback and includes the Bengali face', () => {
    const fontStacks = [...styles.matchAll(/--font-(?:sans|display):([^;]+);/g)].map(
      ([, stack = '']) => stack,
    );
    expect(fontStacks).toHaveLength(2);
    for (const stack of fontStacks) {
      expect(stack).toContain('var(--font-bengali, ');
      expect(stack).not.toMatch(/var\(--font-[\w-]+\)/);
    }
  });
});

/*
 * The brand artwork is a stylesheet decision, so it is pinned here: the four official files,
 * one tone per surface, and a dark-theme rule that swaps the picture rather than loading both.
 */
describe('brand artwork', () => {
  const paths = [
    '/brand/nilzora-logo-on-light.png',
    '/brand/nilzora-logo-on-dark.png',
    '/brand/nilzora-mark-navy.png',
    '/brand/nilzora-mark-sky.png',
  ];

  it.each(paths)('references the official file %s from public/brand', (path) => {
    expect(styles).toContain(`url('${path}')`);
  });

  it('swaps the logo picture under the dark theme without a second request', () => {
    expect(styles).toMatch(
      /\[data-theme='dark'\]\s+\.nz-brand-logo:not\(\[data-tone\]\)\s*\{\s*background-image:\s*var\(--nz-brand-logo-dark\);/,
    );
    expect(styles).toMatch(
      /\[data-theme='dark'\]\s+\.nz-brand-mark:not\(\[data-tone\]\)\s*\{\s*background-image:\s*var\(--nz-brand-mark-dark\);/,
    );
  });

  it('lets a surface pin a tone regardless of the theme', () => {
    expect(styles).toMatch(
      /\.nz-brand-logo\[data-tone='dark'\]\s*\{\s*background-image:\s*var\(--nz-brand-logo-dark\);/,
    );
    expect(styles).toMatch(
      /\.nz-brand-mark\[data-tone='light'\]\s*\{\s*background-image:\s*var\(--nz-brand-mark-light\);/,
    );
  });

  it('keeps the artwork aspect ratios, so nothing is stretched', () => {
    expect(styles).toContain('--nz-brand-logo-ratio: 1023 / 243;');
    expect(styles).toContain('--nz-brand-mark-ratio: 725 / 724;');
  });
});
