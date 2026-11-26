import { render, screen } from '@testing-library/react';
import type { Address } from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '@/lib/auth-params';
import { address, apiError, fakeRead, redirectedTo } from '@/testing/commerce-fixtures';
import NewAddressPage from './page';

const api = vi.hoisted(() => ({
  listAddresses: vi.fn<(token: string) => Promise<{ addresses: Address[] }>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    csrfToken: () => Promise.resolve('signed-csrf-value'),
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));
vi.mock('@/lib/address-actions', () => ({ saveAddressAction: vi.fn() }));

async function renderPage(params: SearchParams = {}) {
  return render(await NewAddressPage({ searchParams: Promise.resolve(params) }));
}

function hiddenValue(container: HTMLElement, name: string): string | undefined {
  const element = container.querySelector(`input[type="hidden"][name="${name}"]`);
  return element instanceof HTMLInputElement ? element.value : undefined;
}

beforeEach(() => {
  api.listAddresses.mockReset();
  api.listAddresses.mockResolvedValue({ addresses: [address()] });
});

describe('NewAddressPage', () => {
  it('offers an empty form that returns to the address book', async () => {
    const { container } = await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Add an address' })).not.toBeNull();
    expect(hiddenValue(container, 'next')).toBe('/account/addresses');
    expect(hiddenValue(container, 'addressId')).toBeUndefined();
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(
      screen.getByRole('checkbox', { name: 'Use as my default delivery address' }),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save address' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe(
      '/account/addresses',
    );
  });

  it('returns to checkout when it came from there', async () => {
    const { container } = await renderPage({ next: '/checkout' });

    expect(hiddenValue(container, 'next')).toBe('/checkout');
    expect(screen.getByRole('link', { name: 'Back to checkout' }).getAttribute('href')).toBe(
      '/checkout',
    );
    expect(screen.getByRole('button', { name: 'Save and use this address' })).not.toBeNull();
  });

  it.each([
    ['another site', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['a repeated parameter', ['/checkout', '/checkout']],
  ])('ignores `next` naming %s', async (_label, next) => {
    const { container } = await renderPage({ next });
    expect(hiddenValue(container, 'next')).toBe('/account/addresses');
  });

  it('explains that a first address becomes the default', async () => {
    api.listAddresses.mockResolvedValue({ addresses: [] });

    await renderPage();

    expect(
      screen.getByText('Your first address becomes your default delivery address.'),
    ).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('explains a full address book instead of showing the form', async () => {
    api.listAddresses.mockResolvedValue({
      addresses: Array.from({ length: 10 }, (_, index) =>
        address({ id: `ad000000-0000-4000-8000-${String(index).padStart(12, '0')}` }),
      ),
    });

    await renderPage();

    expect(screen.getByText('Your address book is full')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Save address' })).toBeNull();
  });

  it('sends a signed-out visitor to sign in, keeping the way back to checkout', async () => {
    api.listAddresses.mockRejectedValue(apiError(401, 'unauthenticated'));

    await expect(
      NewAddressPage({ searchParams: Promise.resolve({ next: '/checkout' }) }),
    ).rejects.toMatchObject(
      redirectedTo('/login?next=%2Faccount%2Faddresses%2Fnew%3Fnext%3D%2Fcheckout'),
    );
    await expect(NewAddressPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(
      redirectedTo('/login?next=/account/addresses/new'),
    );
  });

  it('explains an outage and a suspended account', async () => {
    api.listAddresses.mockRejectedValueOnce(apiError(503, 'service_unavailable'));
    const { unmount } = await renderPage({ next: '/checkout' });
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/account/addresses/new?next=/checkout',
    );
    unmount();

    api.listAddresses.mockRejectedValueOnce(apiError(403, 'account_suspended'));
    await renderPage();
    expect(screen.getByText('This account is suspended')).not.toBeNull();
  });
});
