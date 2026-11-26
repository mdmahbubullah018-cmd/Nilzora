import { render, screen } from '@testing-library/react';
import type { Address } from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import DeleteAddressPage from './page';

const api = vi.hoisted(() => ({
  listAddresses: vi.fn<(token: string) => Promise<{ addresses: Address[] }>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    csrfToken: () => Promise.resolve('signed-csrf-value'),
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));
vi.mock('@/lib/address-actions', () => ({ deleteAddressAction: vi.fn() }));

const page = (id: string) => DeleteAddressPage({ params: Promise.resolve({ id }) });

beforeEach(() => {
  api.listAddresses.mockReset();
  api.listAddresses.mockResolvedValue({ addresses: [address(), officeAddress()] });
});

describe('DeleteAddressPage', () => {
  it('asks for confirmation, showing the address, with a way to keep it', async () => {
    const { container } = render(await page(OFFICE_ID));

    expect(screen.getByRole('heading', { level: 1, name: 'Delete this address?' })).not.toBeNull();
    expect(screen.getByText('Level 4, Agrabad Tower')).not.toBeNull();
    expect(
      screen.getByText(/Orders you have already placed keep their delivery details/),
    ).not.toBeNull();
    expect(screen.queryByText(/becomes the default/)).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="addressId"]')?.value).toBe(
      OFFICE_ID,
    );
    expect(container.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value).toBe(
      'signed-csrf-value',
    );
    expect(
      screen.getByRole('button', { name: 'Delete address: Office · Agrabad, Chattogram' }),
    ).toHaveProperty('type', 'submit');
    expect(screen.getByRole('link', { name: 'Keep address' }).getAttribute('href')).toBe(
      '/account/addresses',
    );
  });

  it('says another address becomes the default', async () => {
    render(await page(HOME_ID));
    expect(screen.getByText(/One of your other addresses becomes the default/)).not.toBeNull();
  });

  it.each([
    ['a malformed id', 'not-an-id'],
    ['an address that is not the customer one', 'ad000000-0000-4000-8000-0000000000ff'],
  ])('is not found for %s', async (_label, id) => {
    await expect(page(id)).rejects.toMatchObject(NOT_FOUND);
  });

  it('sends a signed-out visitor to sign in', async () => {
    api.listAddresses.mockRejectedValue(apiError(401, 'unauthenticated'));
    await expect(page(HOME_ID)).rejects.toMatchObject(
      redirectedTo('/login?next=/account/addresses'),
    );
  });

  it('explains a suspended account', async () => {
    api.listAddresses.mockRejectedValue(apiError(403, 'account_suspended'));

    render(await page(HOME_ID));

    expect(screen.getByText('This account is suspended')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Delete address/ })).toBeNull();
  });
});
