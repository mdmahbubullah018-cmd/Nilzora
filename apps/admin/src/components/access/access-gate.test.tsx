// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testUser } from '@/test/fixtures';
import { AccessGate } from './access-gate';

vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));

afterEach(cleanup);

const csrf = { name: 'csrf_token', token: 'signed-test-token' };

function links() {
  return screen.queryAllByRole('link').map((link) => link.getAttribute('href'));
}

describe('AccessGate', () => {
  it('explains a refused workspace and offers the one the account can use', () => {
    render(
      <AccessGate
        access="forbidden"
        user={testUser('staff')}
        workspace="moderator"
        retryHref="/moderator"
        csrf={csrf}
      />,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'You do not have access to the Moderator workspace',
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Signed in as/).textContent).toBe(
      'Signed in as staff@example.test (Staff)',
    );
    expect(links()).toEqual(['/admin']);
    expect(screen.getByRole('link', { name: 'Go to the Admin workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('offers no workspace to an account without any', () => {
    render(
      <AccessGate
        access="forbidden"
        user={testUser('customer')}
        workspace="admin"
        retryHref="/admin"
        csrf={csrf}
      />,
    );

    expect(links()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('names no workspace when none was asked for', () => {
    render(<AccessGate access="forbidden" user={testUser('customer')} retryHref="/" csrf={csrf} />);
    expect(screen.getByRole('heading', { level: 1, name: 'No workspace access' })).toBeTruthy();
  });

  it('tells a suspended account only to sign out', () => {
    render(<AccessGate access="suspended" workspace="admin" retryHref="/admin" csrf={csrf} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'This account is suspended' }),
    ).toBeTruthy();
    expect(links()).toEqual([]);
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('offers a retry when the API could not be reached', () => {
    render(<AccessGate access="unavailable" workspace="admin" retryHref="/admin" csrf={csrf} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'We could not confirm your access' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/admin');
  });

  it.each(['forbidden', 'suspended', 'unavailable'] as const)(
    'renders no workspace navigation and carries the CSRF field (%s)',
    (access) => {
      const props =
        access === 'forbidden'
          ? ({ access, user: testUser('moderator') } as const)
          : ({ access } as const);
      const { container } = render(
        <AccessGate {...props} workspace="admin" retryHref="/admin" csrf={csrf} />,
      );

      expect(screen.queryByRole('navigation')).toBeNull();
      const field = container.querySelector<HTMLInputElement>('input[type="hidden"]');
      expect(field?.name).toBe('csrf_token');
      expect(field?.value).toBe('signed-test-token');
    },
  );
});
