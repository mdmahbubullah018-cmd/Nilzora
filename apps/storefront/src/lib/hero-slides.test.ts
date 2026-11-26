import type { Banner } from '@nilzora/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devSampleSlides, heroSlides, MAX_HERO_SLIDES } from './hero-slides';
import {
  appDownloadLinks,
  appStoreUrl,
  hasAppAction,
  NO_APP_LINKS,
  playStoreUrl,
} from './app-links';

function banner(n: number, overrides: Partial<Banner> = {}): Banner {
  return {
    id: `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    placement: 'home_hero',
    title: `Banner ${n}`,
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: {
      url: `https://media.nilzora.test/banners/${n}/full.webp`,
      thumbUrl: `https://media.nilzora.test/banners/${n}/thumb.webp`,
    },
    categorySlug: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('heroSlides', () => {
  it('turns banners into image-only slides, titled for screen readers', () => {
    expect(heroSlides([banner(1, { ctaLabel: 'Shop', ctaHref: '/categories/women' })])).toEqual([
      {
        id: '0b000000-0000-4000-8000-000000000001',
        alt: 'Banner 1',
        // An older payload (no imageAlt): the words lived in the artwork, so no caption at all.
        heading: null,
        text: null,
        ctaLabel: null,
        href: '/categories/women',
        desktopSrc: 'https://media.nilzora.test/banners/1/full.webp',
        mobileSrc: null,
      },
    ]);
  });

  it('shows optional words as a caption only under the optional-text model', () => {
    const [withWords] = heroSlides([
      banner(1, {
        title: 'Winter sale',
        imageAlt: null,
        subtitle: 'Up to 30% off',
        ctaLabel: 'Shop',
        ctaHref: '/products',
      }),
    ]);
    expect(withWords).toMatchObject({
      heading: 'Winter sale',
      text: 'Up to 30% off',
      ctaLabel: 'Shop',
      alt: '',
    });

    const [pictureOnly] = heroSlides([
      banner(2, { title: '', imageAlt: 'Two cotton sarees', subtitle: null }),
    ]);
    expect(pictureOnly).toMatchObject({
      heading: null,
      text: null,
      ctaLabel: null,
      alt: 'Two cotton sarees',
    });
  });

  it('shows no button label when the banner has no destination the store can open', () => {
    const [slide] = heroSlides([banner(3, { imageAlt: null, ctaLabel: 'Shop', ctaHref: null })]);
    expect(slide?.ctaLabel).toBeNull();
  });

  it('skips banners without a picture and keeps at most five', () => {
    const banners = [banner(1, { image: null }), ...[2, 3, 4, 5, 6, 7].map((n) => banner(n))];
    const slides = heroSlides(banners);
    expect(slides).toHaveLength(MAX_HERO_SLIDES);
    expect(slides.map((s) => s.alt)).toEqual([
      'Banner 2',
      'Banner 3',
      'Banner 4',
      'Banner 5',
      'Banner 6',
    ]);
  });

  it('never links a banner outside the store', () => {
    for (const ctaHref of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      'products',
    ]) {
      expect(heroSlides([banner(1, { ctaHref })])[0]?.href).toBeNull();
    }
  });
});

describe('devSampleSlides', () => {
  it('stays off unless explicitly enabled in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NILZORA_DEV_SAMPLE_BANNERS', '');
    expect(devSampleSlides()).toEqual([]);
  });

  it('is never active in a production build, whatever the flag says', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NILZORA_DEV_SAMPLE_BANNERS', '1');
    expect(devSampleSlides()).toEqual([]);
  });

  it('returns clearly labelled samples with phone and desktop artwork when enabled in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NILZORA_DEV_SAMPLE_BANNERS', '1');
    const samples = devSampleSlides();
    expect(samples).toHaveLength(3);
    for (const sample of samples) {
      expect(sample.alt).toMatch(/^Development sample banner/);
      expect(decodeURIComponent(sample.desktopSrc)).toContain('DEV SAMPLE BANNER');
      // The banner API has one image per banner, so the samples do too, at the recommended 3:1.
      expect(sample.mobileSrc).toBeNull();
      expect(decodeURIComponent(sample.desktopSrc)).toContain('1920 × 640 (3:1)');
    }
  });
});

describe('app download links', () => {
  it('has no published links yet', () => {
    expect(appDownloadLinks()).toEqual({
      googlePlayUrl: null,
      appStoreUrl: null,
    });
    expect(hasAppAction(appDownloadLinks())).toBe(false);
  });

  it('accepts only an https Google Play address', () => {
    expect(playStoreUrl('https://play.google.com/store/apps/details?id=com.nilzora.app')).toBe(
      'https://play.google.com/store/apps/details?id=com.nilzora.app',
    );
    for (const value of [
      null,
      '',
      'http://play.google.com/store/apps/details?id=x',
      'https://play.google.com.evil.example/x',
      'javascript:alert(1)',
    ]) {
      expect(playStoreUrl(value)).toBeNull();
    }
  });
});

describe('app store links', () => {
  it('accepts only an https App Store address', () => {
    expect(appStoreUrl('https://apps.apple.com/bd/app/nilzora/id123456789')).toBe(
      'https://apps.apple.com/bd/app/nilzora/id123456789',
    );
    for (const value of [
      null,
      'http://apps.apple.com/app/id1',
      'https://apps.apple.com.evil.example/app/id1',
      'https://play.google.com/store/apps/details?id=x',
    ]) {
      expect(appStoreUrl(value)).toBeNull();
    }
  });

  it('counts as an app action only a valid store link', () => {
    expect(hasAppAction(NO_APP_LINKS)).toBe(false);
    expect(hasAppAction({ ...NO_APP_LINKS, googlePlayUrl: 'https://evil.example/app' })).toBe(
      false,
    );
    expect(hasAppAction({ ...NO_APP_LINKS, appStoreUrl: 'https://apps.apple.com/app/id1' })).toBe(
      true,
    );
  });
});
