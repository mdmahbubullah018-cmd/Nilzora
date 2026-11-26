import { render, screen, within } from '@testing-library/react';
import type { SessionState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signedIn } from '@/testing/commerce-fixtures';
import AccountPage from './page';

const current = vi.hoisted(() => {
  const holder: { state: SessionState; prompt: unknown } = {
    state: { status: 'unavailable' },
    prompt: null,
  };
  return holder;
});

vi.mock('@/lib/session', () => ({
  session: {
    getSession: () => Promise.resolve(current.state),
    csrfToken: () => Promise.resolve('signed-csrf-value'),
    // The account page reads the wishlist for its saved count; an empty list is enough here.
    // The review prompt read answers what the test set; everything else an empty list.
    read: (call: (api: unknown, token: string) => unknown) =>
      Promise.resolve({
        kind: 'ok',
        value: call(
          {
            myWishlist: () => ({ items: [] }),
            reviewPrompt: () => ({ item: current.prompt }),
          },
          'token',
        ),
      }),
  },
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/lib/auth-actions', () => ({ signOutAction: vi.fn(), updateProfileAction: vi.fn() }));

beforeEach(() => {
  current.state = { status: 'unavailable' };
  current.prompt = null;
});

describe('AccountPage', () => {
  it('offers a retry and a sign-out when the API cannot be reached', async () => {
    const { container } = render(await AccountPage());

    expect(screen.queryByText('We could not load your account')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/account');
    expect(screen.getByRole('button', { name: 'Sign out' }).getAttribute('type')).toBe('submit');
    const csrf = container.querySelector('input[type="hidden"][name="csrf_token"]');
    expect(csrf?.getAttribute('value')).toBe('signed-csrf-value');
  });

  it('shows the profile and links to orders and addresses when signed in', async () => {
    current.state = signedIn;

    render(await AccountPage());

    // The signed-in header greets the customer by name; "Your account" is the fallback.
    expect(screen.getByRole('heading', { level: 1, name: 'Rahima Khatun' })).not.toBeNull();
    expect(screen.getAllByText('rahima@example.com').length).toBeGreaterThan(0);
    const shopping = screen.getByRole('navigation', { name: 'Shopping' });
    expect(
      within(shopping)
        .getByRole('link', { name: /^My wishlist/ })
        .getAttribute('href'),
    ).toBe('/wishlist');
    expect(
      within(shopping)
        .getByRole('link', { name: /^Your orders/ })
        .getAttribute('href'),
    ).toBe('/account/orders');
    expect(
      within(shopping)
        .getByRole('link', { name: /^Addresses/ })
        .getAttribute('href'),
    ).toBe('/account/addresses');
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeNull();
  });

  it('offers no shopping links to a suspended account', async () => {
    current.state = { status: 'suspended' };

    render(await AccountPage());

    expect(screen.getByText('This account is suspended')).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Shopping' })).toBeNull();
  });

  it('sends a signed-out visitor to sign in', async () => {
    current.state = { status: 'signed_out' };

    await expect(AccountPage()).rejects.toMatchObject({
      digest: expect.stringContaining('/login?next=/account') as unknown,
    });
  });

  it('asks about a delivered product the server names, and nothing otherwise', async () => {
    current.state = signedIn;
    const first = render(await AccountPage());
    expect(screen.queryByRole('dialog', { name: 'How was your order?' })).toBeNull();
    first.unmount();

    current.prompt = {
      productId: '0b9f7f5e-6a14-4c43-8d63-2d1e8f3b7a01',
      productName: 'Cotton kurta',
      productSlug: 'cotton-kurta',
      variantLabel: null,
      image: null,
      orderNumber: 'NZ100042',
      deliveredAt: '2026-01-07T10:00:00.000Z',
    };
    render(await AccountPage());
    const dialog = await screen.findByRole('dialog', { name: 'How was your order?' });
    expect(within(dialog).getByText('Cotton kurta')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Not now' })).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Write a review' })).not.toBeNull();
  });
});
