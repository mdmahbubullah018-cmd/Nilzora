import type { ShoppingZone } from '@nilzora/contracts';
import { act, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions } from 'react-native';
import { PHOTO_SHADE_STOPS } from '../components/photo-shade';
import {
  BANNER_RATIO,
  BANNER_SHADE_MAX_HEIGHT,
  BANNER_TEXT_SCALE_LIMIT,
  bannerShadeHeight,
} from '../features/catalog/promo-carousel';
import {
  ZONE_BANNER_MIN_HEIGHT,
  ZONE_TEXT_SCALE_LIMIT,
  ZoneSection,
  zoneBannerHeight,
  zoneCardWidth,
  zoneShadeHeight,
} from '../features/catalog/zone-section';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { styleOf } from '../test-utils/style-of';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * Layout and contrast of the banners at the phone widths the app is used at (320, 360, 390, 412)
 * and on a tablet (600, 768). Nothing here is a screenshot: it is the arithmetic the layout is
 * built from, checked against the WCAG contrast formula, plus what is actually rendered.
 */

const WIDTHS = [320, 360, 390, 412, 600, 768];
const NAVY = [15, 23, 42] as const;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The fade's opacity `t` of the way down (0 top, 1 bottom), by linear interpolation. */
function shadeAlpha(t: number): number {
  const stops = PHOTO_SHADE_STOPS.text;
  for (let i = 1; i < stops.length; i += 1) {
    const [x0, a0] = stops[i - 1] as readonly [number, number];
    const [x1, a1] = stops[i] as readonly [number, number];
    if (t <= x1) return a0 + ((a1 - a0) * (t - x0)) / (x1 - x0);
  }
  return (stops.at(-1) as readonly [number, number])[1];
}

/** White type over the fade over the lightest plausible artwork: pure white. */
function contrastOverWhiteArtwork(alpha: number): number {
  const background = NAVY.map((n) => alpha * n + (1 - alpha) * 255) as [number, number, number];
  return 1.05 / (luminance(background) + 0.05);
}

/** How far up the banner (dp) the top of the words reaches, at the largest allowed text size. */
function zoneWordsHeight(): number {
  const paddingBottom = 16;
  return paddingBottom + 25 * ZONE_TEXT_SCALE_LIMIT + 2 + 18 * ZONE_TEXT_SCALE_LIMIT;
}

describe('the collection banner at every width', () => {
  it.each(WIDTHS)('is never squat or squashed at %i dp', (width) => {
    const card = zoneCardWidth(width);
    const height = zoneBannerHeight(card);
    expect(height).toBeGreaterThanOrEqual(ZONE_BANNER_MIN_HEIGHT);
    // Never taller than square-ish and never a thin strip: between 1.6:1 and 2.4:1.
    expect(card / height).toBeGreaterThan(1.6);
    expect(card / height).toBeLessThanOrEqual(2.4);
    expect(zoneShadeHeight(card)).toBeLessThanOrEqual(height);
  });

  it.each(WIDTHS)('keeps white words at 4.5:1 or better over white artwork at %i dp', (width) => {
    const card = zoneCardWidth(width);
    const shade = zoneShadeHeight(card);
    // The top of the words, measured down the fade; bounded by the fade itself.
    const wordsTop = Math.min(zoneWordsHeight(), shade);
    const t = 1 - wordsTop / shade;
    expect(contrastOverWhiteArtwork(shadeAlpha(t))).toBeGreaterThanOrEqual(4.5);
    // The words also fit inside the banner, so nothing is clipped at the top.
    expect(zoneWordsHeight()).toBeLessThanOrEqual(zoneBannerHeight(card));
  });

  it('the old fade did not guarantee it: the words sat in a fade that is too light for white artwork', () => {
    // Documents why the "text" fade exists: the earlier "strong" stops at the same spot are < 4.5:1
    // on a 320 dp phone.
    const stops = PHOTO_SHADE_STOPS.strong;
    const card = zoneCardWidth(320);
    const shade = 0.8 * zoneBannerHeight(card);
    const t = 1 - zoneWordsHeight() / shade;
    let alpha = 0;
    for (let i = 1; i < stops.length; i += 1) {
      const [x0, a0] = stops[i - 1] as readonly [number, number];
      const [x1, a1] = stops[i] as readonly [number, number];
      if (t <= x1) {
        alpha = a0 + ((a1 - a0) * (t - x0)) / (x1 - x0);
        break;
      }
    }
    expect(contrastOverWhiteArtwork(alpha)).toBeLessThan(4.5);
  });

  it('the darkest part of the fade keeps white type very legible, and the lightest plausible is still 4.5:1', () => {
    expect(contrastOverWhiteArtwork(shadeAlpha(1))).toBeGreaterThan(7);
    expect(contrastOverWhiteArtwork(0.6)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the promotion banner at every width', () => {
  const heroWordsHeight = 10 + 21 * BANNER_TEXT_SCALE_LIMIT + 2 + 18 * BANNER_TEXT_SCALE_LIMIT;
  const rowWordsHeight = 10 + 19 * BANNER_TEXT_SCALE_LIMIT + 2 + 18 * BANNER_TEXT_SCALE_LIMIT;

  it.each(WIDTHS)('keeps the hero words at 4.5:1 over white artwork at %i dp', (width) => {
    const card = width - 40;
    const picture = card / BANNER_RATIO;
    const shade = bannerShadeHeight(card);
    expect(shade).toBeLessThanOrEqual(picture);
    expect(shade).toBeLessThanOrEqual(BANNER_SHADE_MAX_HEIGHT);
    expect(heroWordsHeight).toBeLessThanOrEqual(picture);
    const t = 1 - Math.min(heroWordsHeight, shade) / shade;
    expect(contrastOverWhiteArtwork(shadeAlpha(t))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(WIDTHS)('keeps the compact row words at 4.5:1 over white artwork at %i dp', (width) => {
    // PromoRow cards are 72% of the screen, between 240 and 320 dp wide.
    const card = Math.min(Math.max(width * 0.72, 240), 320);
    const picture = card / BANNER_RATIO;
    const shade = bannerShadeHeight(card);
    expect(rowWordsHeight).toBeLessThanOrEqual(picture);
    const t = 1 - Math.min(rowWordsHeight, shade) / shade;
    expect(contrastOverWhiteArtwork(shadeAlpha(t))).toBeGreaterThanOrEqual(4.5);
  });
});

function zone(overrides: Partial<ShoppingZone> = {}): ShoppingZone {
  return {
    id: '3f2a1b4c-0000-4000-8000-000000000001',
    slug: 'long',
    name: 'The Very Long Festive Occasion Wear and Accessories Collection for Everyone',
    description:
      'Hand-picked sarees, panjabis, kurtas, jewellery and gifts for every celebration this season',
    audience: 'all',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: 12,
    ...overrides,
  };
}

describe('a collection banner with long words, as rendered', () => {
  const original = Dimensions.get('window');

  afterEach(async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await act(() => {
      Dimensions.set({ window: original });
    });
  });

  it.each(WIDTHS)(
    'ellipsizes the name and the line under it at %i dp, in the dark part of the fade',
    async (width) => {
      await act(() => {
        Dimensions.set({ window: { ...original, width } });
      });
      await renderWithProviders(
        <ZoneSection
          query={{
            status: 'success',
            data: [zone()],
            error: null,
            refetch: jest.fn(),
            isRefetching: false,
          }}
          onSelect={jest.fn()}
        />,
      );

      const name = screen.getByText(/^The Very Long/);
      const caption = screen.getByText(/^Hand-picked/);
      for (const text of [name, caption]) {
        expect(text.props.numberOfLines).toBe(1);
        expect(text.props.maxFontSizeMultiplier).toBe(ZONE_TEXT_SCALE_LIMIT);
        expect(styleOf(text).color).toBe('#FFFFFF');
      }
      // The label still carries the full words for a screen reader.
      expect(
        screen.getByRole('button', { name: /^Shop the The Very Long Festive Occasion Wear/ }),
      ).toBeOnTheScreen();
      const banner = JSON.stringify(screen.toJSON());
      expect(banner).toContain(`"height":${String(zoneBannerHeight(zoneCardWidth(width)))}`);
      expect(banner).toContain(`"height":${String(zoneShadeHeight(zoneCardWidth(width)))}`);
    },
  );
});
