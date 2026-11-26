import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, parseHex, relativeLuminance } from './contrast';

describe('relativeLuminance', () => {
  it('matches the WCAG reference points', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    // Mid grey #777777 is the classic 4.48:1 on-white example.
    expect(relativeLuminance('#777777')).toBeCloseTo(0.1845, 4);
  });
});

describe('contrastRatio', () => {
  it('spans 1:1 to 21:1 and is symmetric', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#0284C7', '#0284C7')).toBe(1);
    expect(contrastRatio('#FFFFFF', '#0284C7')).toBeCloseTo(
      contrastRatio('#0284C7', '#FFFFFF'),
      12,
    );
  });

  it('reproduces the brand values that motivated darker action shades', () => {
    expect(contrastRatio('#FFFFFF', '#0284C7')).toBeCloseTo(4.1, 1);
    expect(contrastRatio('#FFFFFF', '#F43F5E')).toBeCloseTo(3.67, 2);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

describe('parseHex and blend', () => {
  it('accepts short and long hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#0284C7')).toEqual([2, 132, 199]);
  });

  it('rejects non-hex input', () => {
    expect(() => parseHex('rgb(0 0 0)')).toThrow();
  });

  it('composites a colour over a background', () => {
    expect(blend('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(blend('#0369A1', '#FFFFFF', 1)).toBe('#0369a1');
  });
});
