import type { Permission } from '@nilzora/contracts';
import { CartIcon } from '@nilzora/ui';
import {
  Banknote,
  BadgeCheck,
  Bell,
  Boxes,
  Calculator,
  Camera,
  ChartLine,
  FolderPlus,
  FileBarChart,
  FileText,
  FolderTree,
  GalleryHorizontal,
  HandCoins,
  History,
  Images,
  Inbox,
  KeyRound,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Link2,
  MapPin,
  MapPinned,
  MessageSquareQuote,
  MessagesSquare,
  Package,
  PackagePlus,
  PackageCheck,
  PackageSearch,
  PackageX,
  Percent,
  Plug,
  ScrollText,
  Search,
  Settings,
  Shapes,
  SlidersHorizontal,
  ShieldCheck,
  Megaphone,
  Smartphone,
  Sparkles,
  Store,
  TicketPercent,
  TicketPlus,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import { REPORT_PERMISSIONS } from './report-query';
import { WORKSPACE_HOME, type Workspace } from './workspace-access';

export type { Workspace } from './workspace-access';

/**
 * Counts the shell can show beside a destination. Each is read by the shell for accounts
 * that may open the destination; a failed or missing read shows no badge at all.
 */
export type NavBadge = 'notifications';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** The destination; only pages that exist are listed (no placeholders). */
  href: Route;
  /**
   * Shown only to accounts holding this permission, or any one of a list of them.
   * Display only: hiding a link is not a security boundary, and every page and API
   * call checks access itself.
   */
  permission?: Permission | readonly Permission[];
  /** A count shown beside the label (see NavBadge). */
  badge?: NavBadge;
  /** Extra words the command palette matches, e.g. "promotions" for coupons. */
  keywords?: readonly string[];
}

export interface NavGroup {
  /** Stable key for the group's remembered open/closed state. */
  id: string;
  label?: string;
  /** Stands for the group in the icon rail's flyout. */
  icon?: LucideIcon;
  items: NavItem[];
}

export interface WorkspaceConfig {
  name: string;
  tagline: string;
  home: Route;
  /** The other workspace, offered only to accounts permitted to enter it. */
  switchTo: Workspace;
  groups: NavGroup[];
}

export const workspaces: Record<Workspace, WorkspaceConfig> = {
  admin: {
    name: 'Admin',
    tagline: 'Store operations',
    home: WORKSPACE_HOME.admin,
    switchTo: 'moderator',
    groups: [
      {
        id: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        items: [
          {
            label: 'Dashboard',
            icon: LayoutDashboard,
            href: WORKSPACE_HOME.admin,
            keywords: ['home', 'overview', 'kpi'],
          },
          {
            label: 'Analytics',
            icon: ChartLine,
            href: '/admin/analytics',
            permission: 'finance.read',
            keywords: ['revenue', 'sales', 'charts'],
          },
          {
            label: 'Order map',
            icon: MapPin,
            href: '/admin/order-geography',
            permission: 'finance.read',
            keywords: ['bangladesh', 'district', 'division', 'geography', 'map', 'demand'],
          },
          {
            label: 'Reports',
            icon: FileBarChart,
            href: '/admin/reports',
            // Open to anyone who may read at least one report; the page lists only those.
            permission: REPORT_PERMISSIONS,
            keywords: ['export', 'download', 'csv', 'excel', 'pdf'],
          },
        ],
      },
      {
        id: 'catalog',
        label: 'Catalog',
        icon: Package,
        items: [
          {
            label: 'Products',
            icon: Package,
            href: '/admin/products',
            permission: 'products.read',
          },
          {
            label: 'Categories',
            icon: FolderTree,
            href: '/admin/categories',
            permission: 'products.read',
          },
          {
            label: 'Brands',
            icon: BadgeCheck,
            href: '/admin/brands',
            permission: 'products.read',
          },
          {
            label: 'Attributes & variants',
            icon: Shapes,
            href: '/admin/attributes',
            permission: 'products.read',
            keywords: ['size', 'colour', 'color', 'swatch'],
          },
          {
            label: 'Inventory',
            icon: Boxes,
            href: '/admin/inventory',
            permission: 'products.read',
            keywords: ['stock', 'low stock'],
          },
          {
            label: 'Media library',
            icon: Images,
            href: '/admin/media',
            permission: ['settings.manage', 'products.update'],
            keywords: ['pictures', 'images', 'uploads', 'logo'],
          },
          {
            label: 'Reviews',
            icon: MessageSquareQuote,
            href: '/admin/reviews',
            permission: 'reviews.moderate',
            keywords: ['ratings'],
          },
        ],
      },
      {
        id: 'sales',
        label: 'Sales',
        icon: CartIcon,
        items: [
          {
            label: 'Orders',
            icon: CartIcon,
            href: '/admin/orders',
            permission: 'orders.read',
            keywords: ['cod', 'invoice'],
          },
          {
            label: 'COD collections',
            icon: HandCoins,
            href: '/admin/cod-collections',
            permission: ['orders.read'],
            keywords: ['cash', 'collect', 'courier', 'payment', 'cod'],
          },
          {
            label: 'Abandoned checkouts',
            icon: PackageX,
            href: '/admin/checkouts',
            permission: 'orders.read',
          },
          {
            label: 'Returns',
            icon: PackageCheck,
            href: '/admin/returns',
            permission: 'orders.read',
          },
          {
            label: 'Refunds',
            icon: Banknote,
            href: '/admin/refunds',
            permission: 'orders.read',
          },
          {
            label: 'Customers',
            icon: Users,
            href: '/admin/customers',
            permission: 'customers.read',
          },
          {
            label: 'Communication',
            icon: MessagesSquare,
            href: '/admin/communication',
            permission: 'admin_workspace.access',
            keywords: ['chat', 'support', 'inbox', 'conversation', 'queue'],
          },
          {
            label: 'Customer insight',
            icon: ChartLine,
            href: '/admin/customers/insights',
            permission: 'customers.read',
          },
          {
            label: 'Coupons & promotions',
            icon: TicketPercent,
            href: '/admin/coupons',
            permission: 'coupons.update',
            keywords: ['discount', 'voucher'],
          },
          {
            label: 'Discount campaigns',
            icon: Percent,
            href: '/admin/discounts',
            permission: 'discounts.view',
            keywords: ['sale', 'promotion', 'campaign', 'category sale', 'flash sale'],
          },
        ],
      },
      {
        // Couriers (Steadfast, Pathao): shipments have their own lifecycle, apart from orders.
        id: 'operations',
        label: 'Operations',
        icon: Truck,
        items: [
          {
            label: 'Courier overview',
            icon: Truck,
            href: '/admin/operations/couriers',
            permission: ['couriers.read', 'shipments.read'],
            keywords: ['courier', 'steadfast', 'pathao', 'delivery', 'parcel'],
          },
          {
            label: 'Shipments',
            icon: PackageSearch,
            href: '/admin/operations/shipments',
            permission: 'shipments.read',
            keywords: ['consignment', 'tracking', 'parcel', 'courier', 'booking'],
          },
          {
            label: 'COD reconciliation',
            icon: HandCoins,
            href: '/admin/operations/cod',
            permission: 'couriers.cod.read',
            keywords: ['settlement', 'payout', 'courier cash', 'cod'],
          },
          {
            label: 'Location mappings',
            icon: MapPinned,
            href: '/admin/operations/locations',
            permission: 'shipments.read',
            keywords: ['pathao city', 'zone', 'area', 'district', 'courier location'],
          },
          {
            label: 'Providers',
            icon: Plug,
            href: '/admin/operations/providers',
            permission: 'couriers.read',
            keywords: ['steadfast', 'pathao', 'courier settings', 'connection'],
          },
          {
            label: 'Pricing',
            icon: Calculator,
            href: '/admin/operations/pricing',
            permission: 'couriers.read',
            keywords: ['rate card', 'courier charges', 'parcel weight', 'internal estimate'],
          },
          {
            label: 'Courier settings',
            icon: SlidersHorizontal,
            href: '/admin/operations/settings',
            permission: 'couriers.read',
            keywords: ['courier mode', 'live', 'test mode', 'mock', 'tracking sync', 'timeout'],
          },
        ],
      },
      {
        id: 'storefront',
        label: 'Storefront',
        icon: Store,
        items: [
          {
            label: 'Shopping zones',
            icon: Layers,
            href: '/admin/zones',
            permission: 'zones.manage',
            keywords: ['collections', 'mens', 'womens', 'kids', 'audience', 'shop by'],
          },
          {
            label: 'Banners',
            icon: GalleryHorizontal,
            href: '/admin/banners',
            permission: 'settings.manage',
            keywords: ['hero', 'promo', 'slider'],
          },
          {
            label: 'Popups',
            icon: Sparkles,
            href: '/admin/popups',
            permission: 'settings.manage',
            keywords: ['modal', 'pop-up', 'promotion', 'gif', 'campaign', 'announcement'],
          },
          {
            label: 'Homepage',
            icon: LayoutTemplate,
            href: '/admin/homepage',
            permission: 'settings.manage',
            keywords: ['sections', 'featured', 'new arrivals', 'layout'],
          },
          {
            label: 'Menus',
            icon: Link2,
            href: '/admin/navigation',
            permission: 'settings.manage',
            keywords: ['navigation', 'header', 'footer', 'links'],
          },
          {
            label: 'Pages',
            icon: FileText,
            href: '/admin/pages',
            permission: 'settings.manage',
            keywords: ['about', 'privacy', 'terms', 'returns', 'shipping', 'faq', 'policy'],
          },
          {
            label: 'Store information',
            icon: Store,
            href: '/admin/store-profile',
            permission: 'settings.manage',
            keywords: [
              'store info',
              'store profile',
              'footer',
              'contact',
              'phone',
              'address',
              'opening hours',
              'social',
              'logo',
              'brand',
            ],
          },
          {
            label: 'SEO',
            icon: Search,
            href: '/admin/seo',
            permission: 'products.read',
            keywords: [
              'meta',
              'title',
              'description',
              'search engine',
              'google',
              'share image',
              'og',
              'noindex',
            ],
          },
          {
            label: 'Store settings',
            icon: Truck,
            href: '/admin/settings',
            permission: 'settings.manage',
            keywords: [
              'delivery charges',
              'shipping',
              'dhaka',
              'sales target',
              'store rules',
              'payment methods',
              'cod',
            ],
          },
          {
            label: 'Image search',
            icon: Camera,
            href: '/admin/settings/image-search',
            permission: 'image_search.manage',
            keywords: [
              'visual search',
              'search by image',
              'photo search',
              'embeddings',
              'index',
              'reindex',
              'similarity',
              'threshold',
              'clip',
            ],
          },
        ],
      },
      {
        id: 'mobile',
        label: 'Mobile app',
        icon: Smartphone,
        items: [
          {
            label: 'Onboarding',
            icon: Sparkles,
            href: '/admin/marketing/onboarding',
            permission: 'settings.manage',
            keywords: ['app', 'slides', 'welcome'],
          },
          {
            label: 'Push broadcasts',
            icon: Megaphone,
            href: '/admin/broadcasts',
            permission: 'notifications.broadcast',
            keywords: ['push', 'notification', 'announce', 'message'],
          },
        ],
      },
      {
        id: 'team',
        label: 'Team',
        icon: Users,
        items: [
          // Roles and per-account permissions are managed on the same screen.
          {
            label: 'User management',
            icon: UserCog,
            href: '/admin/staff',
            permission: ['staff.roles.assign', 'staff.permissions.manage'],
            keywords: ['permissions', 'invite', 'team'],
          },
          {
            label: 'Roles & permissions',
            icon: KeyRound,
            href: '/admin/roles',
            permission: ['staff.roles.assign', 'staff.permissions.manage'],
            keywords: ['access', 'matrix', 'rbac'],
          },
          {
            label: 'Moderators',
            icon: ShieldCheck,
            href: '/admin/moderation',
            permission: 'moderation.assign',
            keywords: ['moderation', 'review queue'],
          },
        ],
      },
      {
        id: 'system',
        label: 'System',
        icon: Settings,
        items: [
          {
            label: 'Notifications',
            icon: Inbox,
            href: '/admin/notifications',
            permission: 'admin_workspace.access',
            badge: 'notifications',
            keywords: ['inbox', 'alerts'],
          },
          {
            label: 'Audit log',
            icon: ScrollText,
            href: '/admin/audit',
            permission: 'audit_logs.read',
            keywords: ['history', 'activity'],
          },
        ],
      },
    ],
  },
  moderator: {
    name: 'Moderator',
    tagline: 'Content review',
    home: WORKSPACE_HOME.moderator,
    switchTo: 'admin',
    groups: [
      {
        id: 'queue',
        items: [
          { label: 'Queue', icon: Inbox, href: WORKSPACE_HOME.moderator },
          {
            label: 'Messages',
            icon: MessagesSquare,
            href: '/moderator/messages',
            permission: 'moderator_workspace.access',
            keywords: ['chat', 'reports', 'reported', 'team', 'conversation'],
          },
        ],
      },
      {
        id: 'review',
        label: 'Review',
        icon: PackageSearch,
        items: [
          {
            label: 'Product content',
            icon: PackageSearch,
            href: '/moderator/tasks',
            permission: 'content.approve',
          },
          {
            label: 'Notifications',
            icon: Bell,
            href: '/moderator/notifications',
            permission: 'moderator_workspace.access',
            keywords: ['inbox', 'alerts', 'review', 'submissions'],
          },
        ],
      },
      {
        id: 'records',
        label: 'Records',
        icon: History,
        items: [
          {
            label: 'History',
            icon: History,
            href: '/moderator/history',
            permission: 'content.approve',
          },
        ],
      },
    ],
  },
};

/** A shortcut to a page that creates something, offered by the top bar and the palette. */
export interface CreateAction {
  label: string;
  /** What the menu says under the label. */
  hint: string;
  icon: LucideIcon;
  href: Route;
  /** Every permission the create page itself requires. */
  permission: readonly Permission[];
}

/** The admin's create pages (only pages that exist; each checks access itself). */
export const CREATE_ACTIONS: readonly CreateAction[] = [
  {
    label: 'Product',
    hint: 'Add a product to the catalog',
    icon: PackagePlus,
    href: '/admin/products/new',
    permission: ['products.read', 'products.create'],
  },
  {
    label: 'Category',
    hint: 'A department or subcategory',
    icon: FolderPlus,
    href: '/admin/categories/new',
    permission: ['products.read', 'products.publish'],
  },
  {
    label: 'Coupon',
    hint: 'A discount code for checkout',
    icon: TicketPlus,
    href: '/admin/coupons/new',
    // The page also needs coupons.update (it opens the coupon list afterwards).
    permission: ['coupons.update', 'coupons.create'],
  },
  {
    label: 'Sale campaign',
    hint: 'A timed discount on products or categories',
    icon: Percent,
    href: '/admin/discounts/new',
    permission: ['discounts.view', 'discounts.create'],
  },
  {
    label: 'Banner',
    hint: 'A homepage or category banner (opens the banners page)',
    icon: Images,
    href: '/admin/banners',
    permission: ['settings.manage'],
  },
  {
    label: 'Brand',
    hint: 'A brand shoppers can browse (opens the brands page)',
    icon: BadgeCheck,
    href: '/admin/brands',
    permission: ['products.read', 'products.publish'],
  },
  {
    label: 'Push broadcast',
    hint: 'A notification to app customers',
    icon: Megaphone,
    href: '/admin/broadcasts',
    permission: ['notifications.broadcast'],
  },
  {
    label: 'App onboarding',
    hint: 'Welcome slides for the mobile app',
    icon: Sparkles,
    href: '/admin/marketing/onboarding/new',
    permission: ['settings.manage'],
  },
];

/** The create actions this account may use (holding every permission the page needs). */
export function visibleCreateActions(permissions: readonly Permission[]): CreateAction[] {
  return CREATE_ACTIONS.filter((action) =>
    action.permission.every((permission) => permissions.includes(permission)),
  );
}

/** Whether the account holds the item's permission (any one of a list). */
export function canSeeNavItem(item: NavItem, permissions: readonly Permission[]): boolean {
  if (item.permission === undefined) return true;
  const required: readonly Permission[] =
    typeof item.permission === 'string' ? [item.permission] : item.permission;
  return required.some((permission) => permissions.includes(permission));
}

/**
 * The navigation this account should see: items whose permission it holds, and only
 * the groups left with at least one item. Shapes the menu only.
 */
export function visibleNavGroups(
  groups: readonly NavGroup[],
  permissions: readonly Permission[],
): NavGroup[] {
  return groups.flatMap((group) => {
    const items = group.items.filter((item) => canSeeNavItem(item, permissions));
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

/** A workspace home matches exactly; other destinations also match their sub-pages. */
export function isActivePath(pathname: string, href: string, workspaceHome: string): boolean {
  if (href === workspaceHome) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The navigation item a path belongs to (the deepest match), with its group's label:
 * what the top bar's breadcrumb names. Undefined for paths outside the navigation.
 */
export function activeNavItem(
  workspace: Workspace,
  pathname: string,
): { item: NavItem; group: NavGroup } | undefined {
  const config = workspaces[workspace];
  let found: { item: NavItem; group: NavGroup } | undefined;
  for (const group of config.groups) {
    for (const item of group.items) {
      if (!isActivePath(pathname, item.href, config.home)) continue;
      if (!found || item.href.length > found.item.href.length) found = { item, group };
    }
  }
  return found;
}
