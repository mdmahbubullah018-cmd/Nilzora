// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testUser } from '@/test/fixtures';
import { WorkspaceFrame, WorkspaceShell } from './workspace-shell';

// The bell reads the unread count on the server; the shell's own tests do not exercise it.
vi.mock('./notification-bell', () => ({
  NotificationBell: () => <span data-testid="bell" />,
  NotificationNavBadge: () => <span data-testid="nav-badge">2</span>,
}));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
const navigation = vi.hoisted(() => ({ pathname: '/admin', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  navigation.pathname = '/admin';
  navigation.push.mockReset();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
  delete document.documentElement.dataset.sidebar;
  delete document.documentElement.dataset.sidebarEffective;
  document.cookie = 'nza_theme=; Path=/; Max-Age=0';
  document.cookie = 'nza_sidebar=; Path=/; Max-Age=0';
});

const csrf = { name: 'csrf_token', token: 'signed-test-token' };

function navLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
  return within(nav)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

describe('WorkspaceShell', () => {
  it('shows the verified identity, role and a sign-out form', () => {
    const owner = testUser('super_admin', {
      profile: { ...testUser('super_admin').profile, fullName: 'Ayesha Rahman' },
    });
    const { container } = render(
      <WorkspaceFrame workspace="admin" user={owner} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );

    expect(screen.getAllByText('Ayesha Rahman').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Owner').length).toBeGreaterThan(0);
    expect(screen.queryByText('Not signed in')).toBeNull();
    // Initials stand in for the picture, in the rail's account card and the account menu.
    expect(screen.getAllByText('AR').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    const field = container.querySelector<HTMLInputElement>('input[name="csrf_token"]');
    expect(field?.value).toBe('signed-test-token');
  });

  it('falls back to the email address without a name', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    expect(screen.getAllByText('staff@example.test').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Staff').length).toBeGreaterThan(0);
  });

  it('offers the other workspace only to accounts allowed into it', () => {
    const { unmount } = render(
      <WorkspaceFrame workspace="admin" user={testUser('admin')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    expect(screen.getByRole('link', { name: 'Moderator workspace' }).getAttribute('href')).toBe(
      '/moderator',
    );
    unmount();

    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    expect(screen.queryByRole('link', { name: 'Moderator workspace' })).toBeNull();
  });

  it('lists only the navigation the account holds permissions for', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    expect(navLabels()).toEqual([
      'Dashboard',
      'Reports',
      'Products',
      'Categories',
      'Brands',
      'Attributes & variants',
      'Inventory',
      'Media library',
      'Orders',
      'COD collections',
      'Abandoned checkouts',
      'Returns',
      'Refunds',
      'Customers',
      'Communication',
      'Customer insight',
      'SEO',
      // The rail's unread badge sits beside the inbox link.
      'Notifications2',
    ]);
    expect(screen.queryByText('Team')).toBeNull();
    // Staff now see the inbox, which is the only system destination they hold.
    expect(screen.queryByText('Audit log')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('names the current page in the breadcrumb, with any deeper levels', () => {
    navigation.pathname = '/admin/orders/NZ100042';
    render(
      // The frame lives in the layout; the page hands its deeper levels up to the header.
      <WorkspaceFrame workspace="admin" user={testUser('admin')} csrf={csrf}>
        <WorkspaceShell
          workspace="admin"
          user={testUser('admin')}
          csrf={csrf}
          breadcrumbs={[{ label: 'NZ100042' }]}
        >
          <p>Page content</p>
        </WorkspaceShell>
      </WorkspaceFrame>,
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });

    expect(within(breadcrumb).getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe(
      '/admin',
    );
    expect(within(breadcrumb).getByRole('link', { name: 'Orders' }).getAttribute('href')).toBe(
      '/admin/orders',
    );
    expect(within(breadcrumb).getByText('NZ100042').getAttribute('aria-current')).toBe('page');
  });

  it('names each route once: the workspace home by its navigation label', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('admin')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Dashboard']);
    expect(within(breadcrumb).getByText('Dashboard').getAttribute('aria-current')).toBe('page');
  });

  it('puts the inbox bell in the header for accounts that may use the workspace', () => {
    const { container } = render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    expect(container.querySelector('[data-testid="bell"]')).not.toBeNull();
  });

  it('leaves the bell out for an account without admin_workspace.access', () => {
    const { container } = render(
      <WorkspaceFrame workspace="admin" user={testUser('staff', { permissions: [] })} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    expect(container.querySelector('[data-testid="bell"]')).toBeNull();
  });

  it('serves phone navigation as a disclosure that works without JavaScript', () => {
    const html = renderToString(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const page = document.createElement('div');
    page.innerHTML = html;
    const menu = page.querySelector('summary[aria-label="Navigation"]')?.closest('details');

    expect(menu?.open).toBe(false);
    const links = [...(menu?.querySelectorAll('a') ?? [])].map((link) => link.getAttribute('href'));
    expect(links).toContain('/admin/orders');
    expect(links).not.toContain('/admin/audit');
    // Phones keep search: the drawer carries it, with the lists this account may read.
    const search = menu?.querySelector('[role="search"][aria-label="Search from the navigation"]');
    expect(search).not.toBeNull();
    expect([...(search?.querySelectorAll('option') ?? [])].map((o) => o.textContent)).toEqual([
      'Products',
      'Orders',
      'Customers',
    ]);
  });

  it('switches the theme at once and remembers the choice in the preference cookie', async () => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.themePreference = 'light';
    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const menu = within(screen.getByRole('group', { name: 'Theme' }));
    expect(menu.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(menu.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreference).toBe('dark');
    expect(document.cookie).toContain('nza_theme=dark');
    // The menu re-reads the preference from <html> (a MutationObserver, so after this tick).
    await waitFor(() => {
      expect(menu.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.click(menu.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.cookie).toContain('nza_theme=light');
  });

  it('follows the device when the theme is set to System', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      render(
        <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
          <p>Page content</p>
        </WorkspaceFrame>,
      );
      const menu = within(screen.getByRole('group', { name: 'Theme' }));
      fireEvent.click(menu.getByRole('button', { name: 'System' }));
      expect(document.documentElement.dataset.themePreference).toBe('system');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.cookie).toContain('nza_theme=system');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps sign-out in an account menu that Escape closes', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const menu = screen.getByLabelText('Account: staff@example.test, Staff').closest('details');
    if (!menu) throw new Error('account menu not rendered');

    menu.open = true;
    fireEvent(menu, new Event('toggle'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu.open).toBe(false);
    // The initials are drawn in the trigger and again in the panel's header.
    expect(within(menu).getAllByText('S').length).toBeGreaterThan(0);
  });

  it('remembers the chosen navigation width in a cookie', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('admin')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const control = document.querySelector('.nz-rail details');
    if (!(control instanceof HTMLDetailsElement)) throw new Error('width control not rendered');
    const choose = (name: RegExp) => {
      control.open = true;
      fireEvent(control, new Event('toggle'));
      fireEvent.click(screen.getByRole('button', { name }));
    };

    choose(/^Collapsed/);
    expect(document.documentElement.dataset.sidebar).toBe('collapsed');
    expect(document.documentElement.dataset.sidebarEffective).toBe('collapsed');
    expect(document.cookie).toContain('nza_sidebar=collapsed');

    choose(/^Auto/);
    expect(document.documentElement.dataset.sidebar).toBe('auto');
    expect(document.cookie).toContain('nza_sidebar=auto');

    // "Expand on hover" rests at the icon width; the pointer opens it (see sidebar.ts).
    choose(/^Expand on hover/);
    expect(document.documentElement.dataset.sidebar).toBe('hover');
    expect(document.documentElement.dataset.sidebarEffective).toBe('collapsed');
    expect(document.cookie).toContain('nza_sidebar=hover');

    choose(/^Expanded/);
    expect(document.documentElement.dataset.sidebar).toBe('expanded');
    expect(document.cookie).toContain('nza_sidebar=expanded');
  });

  it('keeps the width control at the top of the rail, directly under the search', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('admin')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    // The rail's own search has no aria-label (its visible text names it), so it is found
    // by the shortcut it advertises; the nav list is the element the menu is.
    const search = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-keyshortcuts')?.includes('Control+K'));
    const control = document.querySelector('.nz-rail summary[aria-label^="Navigation width:"]');
    const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
    if (!search || !control) throw new Error('rail controls not rendered');

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    // Search → width control → menu: the control is above the links, not buried under them.
    expect(search.compareDocumentPosition(control) & FOLLOWING).toBeTruthy();
    expect(control.compareDocumentPosition(nav) & FOLLOWING).toBeTruthy();
  });

  it('offers search only for the lists the account may open', () => {
    render(
      <WorkspaceFrame
        workspace="admin"
        user={testUser('staff', {
          permissions: ['admin_workspace.access', 'orders.read'],
        })}
        csrf={csrf}
      >
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const form = screen.getByRole('search', { name: 'Search the workspace' });
    expect(within(form).getByLabelText('Search term')).toBeTruthy();
    // One scope needs no chooser; the form submits straight to it.
    expect(within(form).queryByLabelText('Search in')).toBeNull();
  });

  it('lets the account choose between the lists it may search', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const form = screen.getByRole('search', { name: 'Search the workspace' });
    const options = within(form)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Products', 'Orders', 'Customers']);
  });

  it('hands a search term to the chosen list filter', () => {
    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const form = screen.getByRole('search', { name: 'Search the workspace' });
    fireEvent.change(within(form).getByLabelText('Search in'), { target: { value: 'orders' } });
    fireEvent.change(within(form).getByLabelText('Search term'), {
      target: { value: 'NZ100042' },
    });

    fireEvent.submit(form);
    expect(navigation.push).toHaveBeenCalledWith('/admin/orders?q=NZ100042');
  });
});

describe('WorkspaceShell command palette and create menu', () => {
  it('opens the palette with Ctrl+K and offers only permitted destinations and actions', () => {
    // jsdom lacks the modal methods of <dialog>; this mirrors what the palette relies on.
    if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.open = true;
      };
    }
    if (typeof HTMLDialogElement.prototype.close !== 'function') {
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.open = false;
      };
    }
    render(
      <WorkspaceFrame workspace="admin" user={testUser('staff')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = screen.getByRole('dialog', { name: 'Command palette', hidden: true });
    const options = () =>
      within(palette)
        .getAllByRole('option', { hidden: true })
        .map((option) => option.textContent);

    expect(options()).toContain('ProductsCatalog');
    expect(options()).not.toContain('Audit logSystem');
    // Staff may create products, but not coupons.
    expect(options().some((label) => label?.startsWith('New product'))).toBe(true);
    expect(options().some((label) => label?.startsWith('New coupon'))).toBe(false);

    const field = within(palette).getByRole('combobox', { hidden: true });
    fireEvent.change(field, { target: { value: 'NZ100042' } });
    expect(options()[0]).toBe('Search products for “NZ100042”');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(navigation.push).toHaveBeenCalledWith('/admin/orders?q=NZ100042');
  });

  it('offers the create pages the account may use, and nothing for an account with none', () => {
    const { unmount } = render(
      <WorkspaceFrame workspace="admin" user={testUser('super_admin')} csrf={csrf}>
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    const menu = document.querySelector('summary[aria-label="Create"]')?.closest('details');
    if (!menu) throw new Error('create menu not rendered');
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/admin/products/new',
      '/admin/categories/new',
      '/admin/coupons/new',
      '/admin/discounts/new',
      '/admin/banners',
      '/admin/brands',
      '/admin/broadcasts',
      '/admin/marketing/onboarding/new',
    ]);
    unmount();

    render(
      <WorkspaceFrame
        workspace="admin"
        user={testUser('staff', { permissions: ['admin_workspace.access', 'orders.read'] })}
        csrf={csrf}
      >
        <p>Page content</p>
      </WorkspaceFrame>,
    );
    expect(document.querySelector('summary[aria-label="Create"]')).toBeNull();
  });
});
