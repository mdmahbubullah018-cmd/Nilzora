import { describe, expect, it } from 'vitest';
import { bannerInputSchema } from './merchandising';

const base = {
  placement: 'home_secondary' as const,
  categoryId: null,
  subtitle: null,
  ctaLabel: null,
  ctaHref: null,
  sortOrder: 0,
  isActive: true,
  startsAt: null,
  endsAt: null,
};

describe('bannerInputSchema: every word is optional', () => {
  it('accepts a picture-only banner that is described for screen readers', () => {
    const parsed = bannerInputSchema.safeParse({ ...base, imageAlt: 'Two cotton sarees' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.title).toBe('');
  });

  it('accepts a banner with a heading and no picture description', () => {
    expect(bannerInputSchema.safeParse({ ...base, title: 'Winter sale' }).success).toBe(true);
  });

  it('refuses a banner with neither a heading nor a picture description', () => {
    const parsed = bannerInputSchema.safeParse({ ...base, title: '   ', imageAlt: null });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['imageAlt']);
  });

  it('still needs a button label and link together, or neither', () => {
    expect(
      bannerInputSchema.safeParse({ ...base, title: 'Sale', ctaLabel: 'Shop', ctaHref: null })
        .success,
    ).toBe(false);
    expect(
      bannerInputSchema.safeParse({
        ...base,
        title: 'Sale',
        ctaLabel: 'Shop',
        ctaHref: '/products',
      }).success,
    ).toBe(true);
  });

  it('keeps the length limits', () => {
    expect(bannerInputSchema.safeParse({ ...base, title: 'x'.repeat(81) }).success).toBe(false);
    expect(
      bannerInputSchema.safeParse({ ...base, title: 'Sale', imageAlt: 'x'.repeat(161) }).success,
    ).toBe(false);
  });
});
