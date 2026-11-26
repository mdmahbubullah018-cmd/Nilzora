import type { DashboardResponse, Permission } from '@nilzora/contracts';
import {
  Boxes,
  MessagesSquare,
  PackagePlus,
  ShoppingBag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { AutoText } from '@/components/i18n/translate';
import { formatCount } from '@/lib/format';

/*
 * "Your work": the places an account with a working role goes first, each shown only when the
 * account holds the permission behind it. It is a shortcut, never a gate: the page it opens
 * checks the permission itself, and so does the API. A figure appears beside a shortcut only when
 * the dashboard's own data has one to give, never an invented number.
 */

interface Action {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
  permission: Permission;
  count?: number | undefined;
  countLabel?: string;
}

export function quickActions(
  permissions: readonly Permission[],
  summary: DashboardResponse | undefined,
): Action[] {
  const actions: Action[] = [
    {
      href: '/admin/orders',
      label: 'Orders',
      hint: 'Confirm, pack and ship',
      icon: ShoppingBag,
      permission: 'orders.read',
      count: summary?.orders?.pending,
      countLabel: 'to confirm',
    },
    {
      href: '/admin/products/new',
      label: 'Add a product',
      hint: 'Start a new draft',
      icon: PackagePlus,
      permission: 'products.create',
    },
    {
      href: '/admin/inventory',
      label: 'Stock levels',
      hint: 'Adjust and review stock',
      icon: Boxes,
      permission: 'inventory.adjust',
      count: summary?.stock?.lowStockCount,
      countLabel: 'low',
    },
    {
      href: '/admin/cod-collections',
      label: 'COD collections',
      hint: 'Record cash received',
      icon: Wallet,
      permission: 'payments.collect',
      count: summary?.orders?.awaitingCollection,
      countLabel: 'to record',
    },
    {
      href: '/admin/customers',
      label: 'Customers',
      hint: 'Look up an account',
      icon: Users,
      permission: 'customers.read',
    },
    {
      href: '/admin/communication',
      label: 'Messages',
      hint: 'Customer conversations',
      icon: MessagesSquare,
      permission: 'chat.internal.use',
    },
  ];
  return actions.filter((action) => permissions.includes(action.permission));
}

export function QuickActionsSection({
  permissions,
  summary,
}: {
  permissions: readonly Permission[];
  summary: DashboardResponse | undefined;
}) {
  const actions = quickActions(permissions, summary);
  if (actions.length === 0) return null;
  return (
    <section aria-labelledby="your-work" className="grid gap-3">
      <h2
        id="your-work"
        className="font-display text-lg font-semibold tracking-tight text-foreground"
      >
        <AutoText>Your work</AutoText>
      </h2>
      <ul role="list" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          const showCount = action.count !== undefined && action.count > 0;
          return (
            <li key={action.label}>
              <Link
                href={action.href}
                className="nz-panel nz-panel-sheen group flex min-h-16 items-center gap-3 rounded-2xl border p-4 transition-colors hover:bg-info-soft/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-soft text-info-ink">
                  <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-semibold text-foreground">
                    <AutoText>{action.label}</AutoText>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    <AutoText>{action.hint}</AutoText>
                  </span>
                </span>
                {showCount ? (
                  <span className="shrink-0 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-ink tabular-nums">
                    {formatCount(action.count ?? 0)} {action.countLabel}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
