import type { Voucher } from '@nilzora/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductOffers } from './product-offers';

const actions = vi.hoisted(() => ({ collectVoucherAction: vi.fn() }));
vi.mock('@/lib/voucher-actions', () => actions);

const CSRF = { name: 'csrf_token', token: 'token-1' };

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

function strip() {
  return within(screen.getByRole('list', { name: 'Vouchers for this product' }));
}

function renderOffers(vouchers: readonly Voucher[], signedIn = true) {
  return render(
    <ProductOffers
      vouchers={vouchers}
      csrf={signedIn ? CSRF : null}
      signedIn={signedIn}
      returnTo="/products/cotton-panjabi"
      productSlug="cotton-panjabi"
    />,
  );
}

beforeEach(() => {
  actions.collectVoucherAction.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the product voucher strip', () => {
  it('draws a ticket with the offer, its minimum and the expiry, in the Voucher Center style', () => {
    renderOffers([voucher()]);

    expect(screen.getByRole('heading', { name: 'Vouchers' })).toBeTruthy();
    expect(strip().getByText('৳60')).toBeTruthy();
    expect(strip().getByText('Min. spend ৳500 · On everything in the store')).toBeTruthy();
    expect(strip().getByText('৳60 off on your order')).toBeTruthy();
    expect(strip().getByText('Till 30 Nov')).toBeTruthy();
    expect(strip().getByRole('button', { name: 'Collect voucher' })).toBeTruthy();
    // The stub repeats the card's own vocabulary, as the Voucher Center's ticket does.
    expect(strip().getByText('Voucher')).toBeTruthy();
    expect(strip().getByText('OFF')).toBeTruthy();
  });

  it('shows one card and a third of the next on a phone, two and a tenth on a wider screen', () => {
    renderOffers([voucher(), voucher({ id: '22222222-2222-4222-8222-222222222222' })]);

    const card = strip().getAllByRole('listitem')[0];
    // The row's own side padding is added back into the share, so the peek lands at 30% on a
    // phone and 10% from `md` instead of widening the sliver the padding would allow.
    expect(card?.className).toContain('w-[calc((100%+4px)/1.3)]');
    expect(card?.className).toContain('md:w-[calc((100%-4px)/2.1)]');
    expect(card?.className).toContain('shrink-0');
  });

  it('keeps the description for the expanded list, where every term is read in full', () => {
    renderOffers([voucher({ description: 'A short line from the admin' })]);

    expect(strip().queryByText('A short line from the admin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Vouchers' }));
    expect(screen.getByRole('dialog').textContent).toContain('A short line from the admin');
  });

  it('hides expired vouchers and ones aimed at other products, and disappears when none is left', () => {
    const { container } = renderOffers([
      voucher({ id: '33333333-3333-4333-8333-333333333333', state: 'expired' }),
      voucher({
        id: '44444444-4444-4444-8444-444444444444',
        scope: 'products',
        products: [{ slug: 'another-product', name: 'Another product' }],
      }),
    ]);

    expect(container.innerHTML).toBe('');
  });

  it('keeps up to six vouchers in the row and every one in the full list', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      voucher({
        id: `55555555-5555-4555-8555-55555555555${String(index)}`,
        title: `Voucher ${String(index + 1)}`,
      }),
    );
    renderOffers(many);

    fireEvent.click(screen.getByRole('button', { name: 'Vouchers' }));
    const dialog = screen.getByRole('dialog');
    // Eight in the full list; the row itself holds six.
    expect(within(dialog).getAllByText(/^Voucher \d$/)).toHaveLength(8);
    expect(within(dialog).getByRole('link', { name: 'Open the Voucher Center' })).toBeTruthy();
    expect(
      within(dialog).getByRole('link', { name: 'Open the Voucher Center' }).getAttribute('href'),
    ).toBe('/vouchers');
  });

  it('gives a guest a Collect link to sign in that comes back to this voucher', () => {
    renderOffers([voucher()], false);

    const link = screen.getByRole('link', { name: 'Collect voucher' });
    expect(link.getAttribute('href')).toBe(
      `/login?next=${encodeURIComponent(
        '/products/cotton-panjabi?collect=11111111-1111-4111-8111-111111111111',
      )}`,
    );
    expect(actions.collectVoucherAction).not.toHaveBeenCalled();
  });

  it('turns Collect into Use at once for a signed-in customer, then keeps it when the server agrees', async () => {
    actions.collectVoucherAction.mockResolvedValue({ ok: true });
    renderOffers([voucher()]);

    fireEvent.click(screen.getByRole('button', { name: 'Collect voucher' }));

    expect(await strip().findByRole('link', { name: 'Use' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Voucher collected');
    await waitFor(() => expect(actions.collectVoucherAction).toHaveBeenCalledTimes(1));
    const form = actions.collectVoucherAction.mock.calls[0]?.[0] as FormData;
    expect(form.get('csrf_token')).toBe('token-1');
    expect(form.get('voucherId')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('puts a refused collection back and says why', async () => {
    actions.collectVoucherAction.mockResolvedValue({
      ok: false,
      message: 'This voucher cannot be collected on your account right now.',
    });
    renderOffers([voucher()]);

    fireEvent.click(screen.getByRole('button', { name: 'Collect voucher' }));

    expect(
      await screen.findByText('This voucher cannot be collected on your account right now.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collect voucher' })).toBeTruthy();
  });

  it('offers Use for a voucher this account already collected, following its own path', () => {
    renderOffers([
      voucher({
        state: 'collected',
        scope: 'categories',
        categories: [{ slug: 'panjabi', name: 'Panjabi' }],
      }),
    ]);

    const use = strip().getByRole('link', { name: 'Use' });
    expect(use.getAttribute('href')).toBe('/categories/panjabi');
    expect(strip().queryByRole('button', { name: 'Collect voucher' })).toBeNull();
  });

  it('offers nothing to press for a voucher that has not opened yet', () => {
    renderOffers([voucher({ state: 'upcoming' })]);

    expect(strip().getByText('Soon')).toBeTruthy();
    expect(strip().queryByRole('button', { name: 'Collect voucher' })).toBeNull();
    expect(strip().queryByRole('link', { name: 'Collect voucher' })).toBeNull();
  });
});
