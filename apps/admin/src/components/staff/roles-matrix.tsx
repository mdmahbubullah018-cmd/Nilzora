import type { AppRole, Permission } from '@nilzora/contracts';
import { PERMISSIONS } from '@nilzora/contracts';
import { cn, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { Check, Minus } from 'lucide-react';
import { DataTable } from '@/components/admin-kit/data-table';
import { SectionCard } from '@/components/admin-kit/section-card';
import { permissionLabel, roleLabel } from '@/lib/identity';
import { AutoText } from '@/components/i18n/translate';

/*
 * Roles and permissions, as a matrix
 * ----------------------------------
 * What each role holds by default, from the database's own definitions (not a copy kept
 * in the app). It is a reference: an account's own grants and denials change what it
 * can do (see the staff page), and the owner holds every permission by rule. Reading it
 * grants nothing; the API still checks the permission on every request.
 */

export interface RoleRow {
  role: AppRole;
  permissions: readonly Permission[];
}

/** The permission groups, in reading order, by the part of the key before the dot. */
const GROUPS: readonly { id: string; label: string; prefixes: readonly string[] }[] = [
  { id: 'catalog', label: 'Catalog and stock', prefixes: ['products.', 'inventory.', 'zones.'] },
  { id: 'orders', label: 'Orders and payments', prefixes: ['orders.', 'checkouts.', 'payments.', 'refunds.'] },
  { id: 'shipping', label: 'Shipping and couriers', prefixes: ['couriers.', 'shipments.'] },
  { id: 'customers', label: 'Customers', prefixes: ['customers.'] },
  { id: 'marketing', label: 'Promotions', prefixes: ['coupons.', 'discounts.'] },
  {
    id: 'content',
    label: 'Reviews and moderation',
    prefixes: ['reviews.', 'content.', 'moderation.', 'moderator_workspace.'],
  },
  { id: 'chat', label: 'Customer chat', prefixes: ['chat.', 'notifications.'] },
  { id: 'finance', label: 'Finance and reports', prefixes: ['finance.', 'audit_logs.'] },
  { id: 'team', label: 'Team and settings', prefixes: ['staff.', 'settings.', 'image_search.', 'admin_workspace.'] },
];

/** Permissions grouped for the matrix; anything a group does not name goes in "Other". */
export function groupPermissions(
  permissions: readonly Permission[] = PERMISSIONS,
): { id: string; label: string; permissions: Permission[] }[] {
  const placed = new Set<Permission>();
  const groups = GROUPS.map((group) => {
    const members = permissions.filter(
      (permission) =>
        !placed.has(permission) && group.prefixes.some((prefix) => permission.startsWith(prefix)),
    );
    for (const permission of members) placed.add(permission);
    return { id: group.id, label: group.label, permissions: members };
  }).filter((group) => group.permissions.length > 0);
  const other = permissions.filter((permission) => !placed.has(permission));
  return other.length > 0
    ? [...groups, { id: 'other', label: 'Other', permissions: other }]
    : groups;
}

/** The roles shown as columns: staff-facing roles first, customers last (they hold none). */
const ROLE_ORDER: readonly AppRole[] = ['super_admin', 'admin', 'staff', 'moderator', 'customer'];

const ROLE_NOTE: Partial<Record<AppRole, string>> = {
  super_admin: 'Holds every permission, always.',
  customer: 'Shoppers; never staff permissions.',
};

export function RolesMatrix({ roles }: { roles: readonly RoleRow[] }) {
  const ordered = ROLE_ORDER.flatMap((role) => roles.filter((row) => row.role === role));
  const held = new Map(ordered.map((row) => [row.role, new Set(row.permissions)]));
  return (
    <div className="grid gap-6">
      <SectionCard
        title="What each role can do"
        description="The defaults each role starts with. Individual accounts can be given more or less on their staff page."
        flush
        className="nz-panel-strong"
      >
        <div className="nz-scroll max-h-160 overflow-auto">
          <DataTable caption="Permissions held by each role" dense className="nz-sticky-head">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56"><AutoText>Permission</AutoText></TableHead>
                {ordered.map((row) => (
                  <TableHead key={row.role} className="min-w-24 text-center">
                    <span className="grid justify-items-center gap-0.5">
                      {roleLabel(row.role)}
                      <span className="text-[10px] font-normal tracking-normal text-muted-foreground normal-case">
                        {formatCount(row.permissions.length)}
                      </span>
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            {groupPermissions().map((group) => (
              <TableBody key={group.id}>
                <TableRow className="bg-surface-muted/60 hover:bg-surface-muted/60">
                  <TableCell
                    colSpan={ordered.length + 1}
                    className="py-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
                  >
                    {group.label}
                  </TableCell>
                </TableRow>
                {group.permissions.map((permission) => (
                  <TableRow key={permission}>
                    <TableCell>
                      <span className="grid">
                        <span className="text-foreground"><AutoText value={permissionLabel(permission)} /></span>
                        <code className="font-mono text-[11px] text-muted-foreground">
                          {permission}
                        </code>
                      </span>
                    </TableCell>
                    {ordered.map((row) => {
                      const yes = held.get(row.role)?.has(permission) === true;
                      return (
                        <TableCell key={row.role} className="text-center">
                          <span
                            className={cn(
                              'inline-grid size-6 place-items-center rounded-full',
                              yes ? 'bg-success-soft text-success-ink' : 'text-muted-foreground/60',
                            )}
                          >
                            {yes ? (
                              <Check aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
                            ) : (
                              <Minus aria-hidden="true" className="size-3.5" />
                            )}
                            <span className="sr-only">
                              {yes
                                ? `${roleLabel(row.role)} has this`
                                : `${roleLabel(row.role)} does not have this`}
                            </span>
                          </span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            ))}
          </DataTable>
        </div>
      </SectionCard>

      <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        {ordered
          .filter((row) => ROLE_NOTE[row.role])
          .map((row) => (
            <li key={row.role}>
              <span className="font-medium text-foreground">{roleLabel(row.role)}:</span>{' '}
              {ROLE_NOTE[row.role]}
            </li>
          ))}
      </ul>
    </div>
  );
}

function formatCount(count: number): string {
  return count === 1 ? '1 permission' : `${String(count)} permissions`;
}
