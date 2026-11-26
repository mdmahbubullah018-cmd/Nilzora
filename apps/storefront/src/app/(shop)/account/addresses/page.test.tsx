import { render, screen, within } from '@testing-library/react';
import type { Address } from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '@/lib/auth-params';
import {
  address,
  apiError,
  fakeRead,
  officeAddress,
  redirectedTo,
} from '@/testing/commerce-fixtures';
import AddressesPage from './page';

const api = vi.hoisted(() => ({
  listAddresses: vi.fn<(token: string) => Promise<{ addresses: Address[] }>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    csrfToken: () => Promise.resolve('signed-csrf-value'),
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));
vi.mock('@/lib/address-actions', () => ({ makeDefaultAddressAction: vi.fn() }));

async function renderPage(params: SearchParams = {}) {
  return render(await AddressesPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  api.listAddresses.mockReset();
  api.listAddresses.mockResolvedValue({ addresses: [address(), officeAddress()] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('AddressesPage', () => {
  it('lists the saved addresses, default first, with their controls', async () => {
    const { container } = await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Addresses' })).not.toBeNull();
    // The account sections are one labelled rail; this page is the Addresses one.
    const accountNav = screen.getByRole('navigation', { name: 'Your account' });
    expect(
      within(accountNav).getByRole('link', { name: 'Addresses' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(accountNav).getAllByRole('listitem')).toHaveLength(7);
    // Two saved addresses, each its own list item; the seven section pills are counted above.
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    expect(screen.getAllByText('Default')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Add an address' }).getAttribute('href')).toBe(
      '/account/addresses/new',
    );
    expect(
      screen.getByRole('button', { name: 'Make default: Office · Agrabad, Chattogram' }),
    ).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value).toBe(
      'signed-csrf-value',
    );
  });

  it.each([
    [{ saved: '1' }, 'Your address has been saved.'],
    [{ deleted: '1' }, 'The address has been deleted.'],
    [{ default: '1' }, 'Your default address has been updated.'],
  ])('confirms a change chosen by a known flag (%o)', async (params, message) => {
    await renderPage(params);
    expect(screen.getByRole('status').textContent).toBe(message);
  });

  it('shows nothing for unknown or repeated flags', async () => {
    await renderPage({ saved: 'yes', deleted: ['1', '1'], message: 'Hacked' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Hacked')).toBeNull();
  });

  it('invites a first address', async () => {
    api.listAddresses.mockResolvedValue({ addresses: [] });

    await renderPage();

    expect(screen.getByText('No saved addresses yet')).not.toBeNull();
    expect(screen.getAllByRole('link', { name: 'Add an address' })).toHaveLength(2);
  });

  it('stops offering new addresses at the limit', async () => {
    api.listAddresses.mockResolvedValue({
      addresses: Array.from({ length: 10 }, (_, index) =>
        address({
          id: `ad000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          isDefault: index === 0,
        }),
      ),
    });

    await renderPage();

    expect(screen.queryByRole('link', { name: 'Add an address' })).toBeNull();
    expect(screen.getByText(/You can keep up to 10 addresses/)).not.toBeNull();
  });

  it('sends a signed-out visitor to sign in and back here', async () => {
    api.listAddresses.mockRejectedValue(apiError(401, 'unauthenticated'));

    await expect(AddressesPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(
      redirectedTo('/login?next=/account/addresses'),
    );
  });

  it('explains a suspended account and an outage', async () => {
    api.listAddresses.mockRejectedValueOnce(apiError(403, 'account_suspended'));
    const { unmount } = await renderPage();
    expect(screen.getByText('This account is suspended')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Add an address' })).toBeNull();
    unmount();

    api.listAddresses.mockRejectedValueOnce(apiError(0, 'network_error'));
    await renderPage();
    expect(screen.getByText('We could not load your addresses')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/account/addresses',
    );
  });
});
