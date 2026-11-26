import { render, screen } from '@testing-library/react';
import type { Address } from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '@/lib/auth-params';
import {
  address,
  apiError,
  fakeRead,
  HOME_ID,
  NOT_FOUND,
  OFFICE_ID,
  officeAddress,
  redirectedTo,
} from '@/testing/commerce-fixtures';
import EditAddressPage from './page';

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

function page(id: string, params: SearchParams = {}) {
  return EditAddressPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(params),
  });
}

function hiddenValue(container: HTMLElement, name: string): string | undefined {
  const element = container.querySelector(`input[type="hidden"][name="${name}"]`);
  return element instanceof HTMLInputElement ? element.value : undefined;
}

function field(label: RegExp): HTMLInputElement | HTMLSelectElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
    throw new Error('not a form control');
  }
  return element;
}

beforeEach(() => {
  api.listAddresses.mockReset();
  api.listAddresses.mockResolvedValue({
    addresses: [address(), officeAddress({ landmark: 'Near the bank' })],
  });
});

describe('EditAddressPage', () => {
  it('fills the form with the saved address, its phone in local form', async () => {
    const { container } = render(await page(OFFICE_ID));

    expect(hiddenValue(container, 'addressId')).toBe(OFFICE_ID);
    expect(hiddenValue(container, 'next')).toBe('/account/addresses');
    expect(field(/^Recipient name/).value).toBe('Rahima Khatun');
    expect(field(/^Mobile phone/).value).toBe('01712-345678');
    expect(field(/^Division/).value).toBe('Chattogram');
    expect(field(/^District/).value).toBe('Chattogram');
    expect(field(/^Postal code/).value).toBe('');
    expect(field(/^Nearby landmark/).value).toBe('Near the bank');
    expect(field(/^Label/).value).toBe('Office');
    expect(screen.getByRole('checkbox')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeNull();
  });

  it('does not offer to make the default address the default', async () => {
    render(await page(HOME_ID));
    expect(screen.getByText('This is your default delivery address.')).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('returns to checkout when it came from there', async () => {
    const { container } = render(await page(HOME_ID, { next: '/checkout' }));
    expect(hiddenValue(container, 'next')).toBe('/checkout');
    expect(screen.getByRole('link', { name: 'Back to checkout' }).getAttribute('href')).toBe(
      '/checkout',
    );
  });

  it.each([
    ['a malformed id', '../../admin'],
    ['an address that is not the customer one', 'ad000000-0000-4000-8000-0000000000ff'],
  ])('is not found for %s', async (_label, id) => {
    await expect(page(id)).rejects.toMatchObject(NOT_FOUND);
  });

  it('sends a signed-out visitor to sign in and back here', async () => {
    api.listAddresses.mockRejectedValue(apiError(401, 'unauthenticated'));
    await expect(page(HOME_ID)).rejects.toMatchObject(
      redirectedTo(`/login?next=${encodeURIComponent(`/account/addresses/${HOME_ID}/edit`)}`),
    );
  });

  it('keeps the way back to checkout through sign-in', async () => {
    api.listAddresses.mockRejectedValue(apiError(401, 'unauthenticated'));
    await expect(page(HOME_ID, { next: '/checkout' })).rejects.toMatchObject(
      redirectedTo(
        `/login?next=${encodeURIComponent(`/account/addresses/${HOME_ID}/edit?next=/checkout`)}`,
      ),
    );
  });

  it('offers a retry when the address cannot be loaded', async () => {
    api.listAddresses.mockRejectedValue(apiError(503, 'service_unavailable'));

    render(await page(HOME_ID));

    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      `/account/addresses/${HOME_ID}/edit`,
    );
  });

  it('keeps the way back to checkout in the retry', async () => {
    api.listAddresses.mockRejectedValue(apiError(503, 'service_unavailable'));

    render(await page(HOME_ID, { next: '/checkout' }));

    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      `/account/addresses/${HOME_ID}/edit?next=/checkout`,
    );
  });

  it('ignores a `next` that is not checkout or the address book', async () => {
    const { container } = render(await page(HOME_ID, { next: 'https://evil.example/checkout' }));
    expect(hiddenValue(container, 'next')).toBe('/account/addresses');
  });
});
