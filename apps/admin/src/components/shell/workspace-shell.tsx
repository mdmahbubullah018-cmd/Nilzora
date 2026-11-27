import { LiveWorkspaceEvents } from './live-workspace-events';
import { Logo, LogoMark } from '@nilzora/ui';
import type { Permission } from '@nilzora/contracts';
import type { SessionUser } from '@nilzora/web-session';
import { ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { displayName, roleLabel } from '@/lib/identity';
import { workspaces, type Workspace } from '@/lib/navigation';
import { switchTarget } from '@/lib/workspace-access';
import { RouteProgress } from '@/components/admin-kit/route-progress';
import { AccountMenu } from './account-menu';
import { CommandPalette } from './command-palette';
import { CommandTrigger } from './command-trigger';
import { LanguageSwitch } from './language-switch';
import { MobileNav } from './mobile-nav';
import { NotificationBell, NotificationNavBadge } from './notification-bell';
import { QuickCreate } from './quick-create';
import { QuickSearch, type QuickSearchScope } from './quick-search';
import { RailAccount } from './rail-account';
import { CrumbProvider, PageCrumbs } from './page-crumbs';
import { ShellBreadcrumb, type Crumb } from './shell-breadcrumb';
import { SidebarNav } from './sidebar-nav';
import { SidebarAutoSync, SidebarHoverSync, SidebarToggle } from './sidebar-toggle';
import { ThemeSwitch } from './theme-switch';
import { Topbar } from './topbar';
import { AutoText } from '@/components/i18n/translate';

export type { Crumb } from './shell-breadcrumb';

function WorkspaceLabel({ name }: { name: string }) {
  return (
    <span className="nz-rail-group rounded-md bg-workspace-accent/15 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-workspace-accent-text uppercase ring-1 ring-workspace-accent/30">
      {name}
    </span>
  );
}

/**
 * The lists the top bar can search: the pages whose own filters accept `?q=`. Only the
 * ones this account may open are offered; the API still authorises every request.
 */
function searchScopes(permissions: readonly Permission[]): QuickSearchScope[] {
  const scopes: QuickSearchScope[] = [];
  if (permissions.includes('products.read')) {
    scopes.push({ value: 'products', label: 'Products', href: '/admin/products' });
  }
  if (permissions.includes('orders.read')) {
    scopes.push({ value: 'orders', label: 'Orders', href: '/admin/orders' });
  }
  if (permissions.includes('customers.read')) {
    scopes.push({ value: 'customers', label: 'Customers', href: '/admin/customers' });
  }
  return scopes;
}

export interface WorkspaceShellProps {
  workspace: Workspace;
  /** The account the API verified for this request; render only for an allowed gate. */
  user: Pick<SessionUser, 'email' | 'profile' | 'role' | 'permissions'>;
  csrf: CsrfInput;
  /**
   * Breadcrumb levels below the page's navigation item, e.g. `[{ label: 'NZ100042' }]`
   * on an order's page. The workspace and section come from the navigation.
   */
  breadcrumbs?: readonly Crumb[];
  children: ReactNode;
}

/**
 * Chrome shared by the admin and moderator workspaces: a navy glass navigation rail
 * (expanded, an icon rail on desktop, or a drawer on phones and tablets), a glass top
 * bar with the breadcrumb, search, create menu, inbox, theme menu and account menu, the
 * command palette (Ctrl/⌘ + K), and the page on the softly moving canvas.
 *
 * The rail width comes from `--nz-sidebar-w`, switched by <html data-sidebar> — read
 * from the visitor's preference cookie on the server, so there is no layout shift.
 * Pages render it only after their own access check passes, so a refused visitor never
 * sees it. Navigation is filtered by the account's permissions for display only; the
 * API authorises every request.
 */
/**
 * What a page renders: its content, entering with the page transition, and the breadcrumb
 * levels it adds. The workspace frame itself (rail, header, menus) lives in the workspace
 * layout (WorkspaceFrame) and stays mounted while pages change, so navigating never reloads
 * the sidebar or the header. `workspace`, `user` and `csrf` are kept for the frame's
 * contract: every page still verifies its own session before it renders this.
 */
export function WorkspaceShell({ breadcrumbs, children }: Readonly<WorkspaceShellProps>) {
  return (
    <>
      <PageCrumbs trail={breadcrumbs ?? []} />
      {/* One constrained column: a wide table (which scrolls inside its own wrapper) must
          never stretch the page's heading or filters past the viewport. */}
      <div className="nz-page-enter grid grid-cols-[minmax(0,1fr)] gap-6">
        <AutoText value={children} />
      </div>
    </>
  );
}

export type WorkspaceFrameProps = Omit<WorkspaceShellProps, 'breadcrumbs'>;

/**
 * The persistent workspace chrome, rendered once by the workspace layout for a verified
 * session: rail, header, mobile menu and command palette, around the current page.
 */
export function WorkspaceFrame({ workspace, user, csrf, children }: Readonly<WorkspaceFrameProps>) {
  const config = workspaces[workspace];
  const switchTo = switchTarget(user, workspace);
  const other = switchTo ? workspaces[switchTo] : undefined;
  const identity = {
    name: displayName(user),
    role: roleLabel(user.role),
    avatarUrl: user.profile.avatar?.thumbUrl ?? null,
  };
  const scopes = searchScopes(user.permissions);
  const inbox = user.permissions.includes('admin_workspace.access');
  const badges = inbox ? { notifications: <NotificationNavBadge /> } : {};
  // Only the admin workspace has a profile page (moderators keep their initials).
  const profileHref = workspace === 'admin' ? ('/admin/profile' as const) : undefined;

  return (
    <CrumbProvider>
      <div
        data-workspace={workspace}
        className="nz-app-canvas nz-rail-frame min-h-dvh lg:grid lg:grid-cols-[var(--nz-sidebar-w)_minmax(0,1fr)]"
      >
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-surface px-4 py-2 text-sm font-semibold text-foreground shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          <AutoText>Skip to content</AutoText>
        </a>
        {/* The bar across the top while a page change is in flight (see route-progress.tsx). */}
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
        {/* New orders and staff notifications as they are committed (a hint to re-read). */}
        <LiveWorkspaceEvents />
        {/* Keeps an "Auto" rail at the right width when the window is resized. */}
        <SidebarAutoSync />
        {/* Opens and closes a rail set to "Expand on hover". */}
        <SidebarHoverSync />

        {/*
        The rail carries the background so it spans pages taller than the viewport,
        and switches focus rings to the variant verified against navy and slate.
      */}
        <div
          data-nav-rail=""
          className="nz-rail hidden lg:block [--nz-ring:var(--nz-ring-on-dark)]"
        >
          <aside className="sticky top-0 flex h-dvh flex-col text-sidebar-muted">
            <div className="nz-rail-head flex h-16 shrink-0 items-center gap-3 px-5">
              {/* One link, one name ("Nilzora"), whichever artwork the rail has room for:
                  the official lockup when expanded, the official mark when collapsed. */}
              <Link
                href={config.home}
                aria-label="Nilzora"
                className="nz-rail-logo rounded-md transition-opacity hover:opacity-90"
              >
                <span className="nz-rail-logo-wide">
                  <Logo size="sm" tone="dark" decorative />
                </span>
                <span className="nz-rail-logo-mark">
                  <LogoMark size="sm" tone="dark" decorative />
                </span>
              </Link>
              <WorkspaceLabel name={config.name} />
            </div>

            {/* The rail's own controls, in the order a staff member reaches for them: find
                something, then choose how wide the labels should be. */}
            <div className="grid gap-1 px-3 pb-2">
              <CommandTrigger variant="rail" />
              <SidebarToggle workspaceName={config.name} />
            </div>

            <div className="nz-rail-scroll nz-scroll flex-1 overflow-y-auto px-3 py-3">
              <SidebarNav workspace={workspace} permissions={user.permissions} badges={badges} />
            </div>

            <div className="nz-rail-foot grid gap-2 border-t border-sidebar-border p-3">
              {other ? (
                <Link
                  href={other.home}
                  className="nz-rail-item relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-white/7 hover:text-sidebar-foreground"
                >
                  <ArrowLeftRight aria-hidden="true" className="size-4 shrink-0" />
                  <span className="nz-rail-label truncate">{other.name} workspace</span>
                </Link>
              ) : null}
              <RailAccount identity={identity} profileHref={profileHref} />
              <p className="nz-rail-hint px-2 text-[11px] text-sidebar-muted">
                <AutoText value={config.tagline} />
              </p>
            </div>
          </aside>
        </div>

        <div className="flex min-w-0 flex-col">
          <Topbar>
            <div className="flex h-16 items-center gap-1.5 px-4 sm:gap-2 sm:px-6 lg:px-8">
              <MobileNav
                workspace={workspace}
                permissions={user.permissions}
                switchTo={switchTo}
                identity={identity}
                scopes={scopes}
                badges={badges}
              />
              <LogoMark size="sm" decorative className="lg:hidden" />
              <ShellBreadcrumb workspace={workspace} />
              <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
                <QuickSearch scopes={scopes} className="mr-1" />
                <CommandTrigger className="xl:hidden" />
                {workspace === 'admin' ? <QuickCreate permissions={user.permissions} /> : null}
                {inbox ? <NotificationBell /> : null}
                <LanguageSwitch />
                <ThemeSwitch />
                <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
                <AccountMenu
                  identity={{ ...identity, email: user.email }}
                  csrf={csrf}
                  profileHref={profileHref}
                />
              </div>
            </div>
          </Topbar>

          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-360">
              <AutoText value={children} />
            </div>
          </main>
        </div>

        <CommandPalette workspace={workspace} permissions={user.permissions} scopes={scopes} />
      </div>
    </CrumbProvider>
  );
}
