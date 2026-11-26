import type { Voucher } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import { ProductOffers, voucherCardWidth } from '../features/vouchers/product-offers';
import { resetRouterMock, router, setPathname } from '@/test-utils/expo-router-mock';
import { createFakeApiClient } from '@/test-utils/api-fakes';
import { renderWithProviders } from '@/test-utils/render-with-providers';
import { FAKE_ACCESS_TOKEN } from '@/test-utils/session-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * The product screen's compact voucher strip: one row of small tickets, each collectable in
 * place, with the full list in a sheet. The tests hold the behaviour a shopper relies on: the
 * offer, its minimum and the expiry read at a glance; a collection shows at once; a guest is
 * sent to sign in; a voucher that can no longer be collected is hidden.
 */

const SLUG = 'cotton-shirt';

function voucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: null,
    title: '৳60 off on your order',
    description: null,
    kind: 'fixed',
    value: 6_000,
    maxDiscountMinor: null,
    minOrderMinor: 50_000,
    startsAt: null,
    endsAt: '2026-11-30T17:59:59.000Z',
    scope: 'storewide',
    audience: 'all',
    categories: [],
    products: [],
    state: 'available',
    collectedAt: null,
    usedCount: 0,
    perCustomerLimit: 1,
    ...overrides,
  };
}

beforeEach(() => {
  resetRouterMock();
  setPathname(`/product/${SLUG}`);
});

describe('the product voucher strip', () => {
  it('draws the offer, its minimum, the expiry and a Collect action', async () => {
    const api = createFakeApiClient();
    api.productVouchers.mockResolvedValue({ vouchers: [voucher()] });

    await renderWithProviders(<ProductOffers slug={SLUG} />, { api });

    expect(await screen.findByText('Vouchers')).toBeOnTheScreen();
    expect(screen.getByText('৳60')).toBeOnTheScreen();
    expect(screen.getByText('Min. spend ৳500 · On everything in the store')).toBeOnTheScreen();
    expect(screen.getByText('৳60 off on your order')).toBeOnTheScreen();
    expect(screen.getByText('Till 30 Nov')).toBeOnTheScreen();
    expect(screen.getByText('VOUCHER')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Collect voucher' })).toBeOnTheScreen();
  });

  it('sizes the row so one ticket and about 30% of the next fill a phone', () => {
    // 360dp phone: 360 - 40 padding - 8 gap = 312; / 1.3 = 240, and the next shows 30%.
    expect(voucherCardWidth(360)).toBeCloseTo(240, 5);
    expect((360 - 40 - 8) / voucherCardWidth(360)).toBeCloseTo(1.3, 5);
  });

  it('turns Collected at once for a signed-in customer and calls the existing API', async () => {
    const api = createFakeApiClient();
    const offer = voucher();
    api.productVouchers.mockResolvedValue({ vouchers: [offer] });
    api.collectVoucher.mockResolvedValue({
      voucher: { ...offer, state: 'collected', collectedAt: '2026-11-23T12:00:00.000Z' },
    });

    const view = await renderWithProviders(<ProductOffers slug={SLUG} />, { api });
    await screen.findByText('৳60');

    await view.user.press(screen.getByRole('button', { name: 'Collect voucher' }));

    expect(screen.getByRole('button', { name: 'Use voucher' })).toBeOnTheScreen();
    expect(api.collectVoucher).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, offer.id);
  });

  it('sends a guest to sign in, remembering the voucher for the trip back', async () => {
    const api = createFakeApiClient();
    api.productVouchers.mockResolvedValue({ vouchers: [voucher()] });

    const view = await renderWithProviders(<ProductOffers slug={SLUG} />, { api, session: null });
    await screen.findByText('৳60');

    await view.user.press(screen.getByRole('button', { name: 'Collect voucher' }));

    expect(api.collectVoucher).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: `/product/${SLUG}` },
    });
  });

  it('hides a voucher that can no longer be collected, and its section with it', async () => {
    const api = createFakeApiClient();
    api.productVouchers.mockResolvedValue({ vouchers: [voucher({ state: 'expired' })] });

    const view = await renderWithProviders(<ProductOffers slug={SLUG} />, { api });

    await waitFor(() => expect(api.productVouchers).toHaveBeenCalled());
    expect(screen.queryByText('Vouchers')).toBeNull();
    expect(view.toJSON()).toBeNull();
  });

  it('opens the whole list in a sheet with a way to the Voucher Center', async () => {
    const api = createFakeApiClient();
    api.productVouchers.mockResolvedValue({
      vouchers: [
        voucher(),
        voucher({
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Ten percent off',
          kind: 'percent',
          value: 10,
        }),
      ],
    });

    const view = await renderWithProviders(<ProductOffers slug={SLUG} />, { api });
    await screen.findByText('৳60');

    await view.user.press(screen.getByRole('button', { name: 'Vouchers' }));

    expect(await screen.findByTestId('product-voucher-sheet')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open the Voucher Center' })).toBeOnTheScreen();
    expect(screen.getAllByText('Vouchers').length).toBeGreaterThan(1);
  });
});
