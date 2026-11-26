import { screen } from '@testing-library/react-native';
import HomeScreen from '../../app/(tabs)/index';
import { brand } from '../features/brands/test-fixtures';
import { banner, FASHION, page, summary } from '../features/catalog/test-fixtures';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

/*
 * The order of Home's sections.
 *
 * The mobile home draws the same page as the website, in the same order: the banner and its
 * promises, the promotions strip, the departments, the live sale, new arrivals, the brands, the
 * collections, and the featured shelf last. A shopper meets the departments and the sale before
 * the makers, and the brands sit directly under the new arrivals while the collections stay
 * directly above the featured shelf.
 */

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

function stockedApi() {
  const api = createFakeApiClient();
  api.listCategories.mockResolvedValue({ categories: [FASHION] });
  api.listProducts.mockResolvedValue(page([summary({ isFeatured: true }), summary({})]));
  api.listBrands.mockResolvedValue({
    brands: [brand({ slug: 'aarong', name: 'Aarong' })],
  });
  api.listCampaigns.mockResolvedValue({
    campaigns: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Winter picks',
        scope: 'storewide',
        discountKind: 'percent',
        discountValue: 20,
        maxDiscountMinor: null,
        endsAt: null,
        banner: null,
        productCount: 3,
      },
    ],
  });
  api.shoppingZones.mockResolvedValue({
    zones: [
      {
        id: '3f2a1b4c-0000-4000-8000-000000000001',
        slug: 'mens',
        name: "Men's",
        description: null,
        audience: 'men',
        banner: null,
        bannerAlt: null,
        mobileBanner: null,
        productCount: 4,
      },
    ],
  });
  return api;
}

/** The section headings in the order they are drawn. */
function headings(): string[] {
  return screen
    .getAllByRole('header')
    .map((node) => {
      const children: unknown = node.props.children;
      return typeof children === 'string' ? children : '';
    })
    .filter((text) => text !== '');
}

describe('Home section order', () => {
  it('runs categories, the sale, new arrivals, brands, collections, then featured', async () => {
    await renderWithProviders(<HomeScreen />, { api: stockedApi() });

    const sequence = [
      'Shop by category',
      'On sale now',
      'New arrivals',
      'Shop by brand',
      'Shop by collection',
      'Featured',
    ];
    // The last section arriving means every section above it has rendered too.
    await screen.findByRole('header', { name: 'Featured' });

    const order = headings();
    const at = (name: string) => order.indexOf(name);
    for (const name of sequence) {
      expect(at(name)).toBeGreaterThan(-1);
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      expect(at(sequence[index] ?? '')).toBeLessThan(at(sequence[index + 1] ?? ''));
    }
  });

  it('keeps the promotions strip above the categories, with no heading of its own', async () => {
    const api = stockedApi();
    api.listBanners.mockImplementation((query) =>
      Promise.resolve({
        banners:
          query?.placement === 'home_secondary'
            ? [banner({ placement: 'home_secondary', title: 'Winter sale' })]
            : [],
      }),
    );
    await renderWithProviders(<HomeScreen />, { api });
    // The banner is there; the section title it used to carry is not.
    expect(await screen.findByRole('header', { name: 'Shop by category' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Promotions' })).toBeNull();
  });
});
