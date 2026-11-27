import {
  AUDIT_LOG_MAX_DAYS,
  type AuditEntry,
  type AuditLogResponse,
  type Permission,
} from '@nilzora/contracts';
import { Card, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { ScrollText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { FilterChips, type FilterChip } from '@/components/admin-kit/filter-bar';
import { oneOf, pageParam, single, withQuery } from '@/components/admin-kit/href';
import { Pagination } from '@/components/admin-kit/pagination';
import { adminRead } from '@/components/admin-kit/read';
import { ReadState } from '@/components/admin-kit/states';
import { uuidParam } from '@/components/customers/customer-query';
import type { SearchParams } from '@/components/orders/order-query';
import { dhakaToday, isCalendarDay, spanDays } from '@/lib/date-range';
import { formatAuditAction, formatDateTime } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const AUDIT_PATH = '/admin/audit' satisfies Route;
export const AUDIT_PAGE_SIZE = 30;

/** Action areas: each filters to actions starting with its prefix. */
export const AUDIT_AREAS = [
  { value: 'order.', label: 'Orders and payments' },
  { value: 'customer.', label: 'Customers' },
  { value: 'staff.', label: 'Staff and permissions' },
  { value: 'moderation.', label: 'Content reviews' },
  { value: 'product.', label: 'Products' },
  { value: 'inventory.', label: 'Inventory' },
  { value: 'category.', label: 'Categories' },
  { value: 'settings.', label: 'Settings' },
  { value: 'shipment.', label: 'Shipments' },
  { value: 'courier.', label: 'Couriers and courier COD' },
] as const;
type AuditArea = (typeof AUDIT_AREAS)[number]['value'];
const AREA_VALUES = AUDIT_AREAS.map((area) => area.value);

export interface AuditFilters {
  area?: AuditArea;
  actorId?: string;
  /** Bangladesh calendar days (YYYY-MM-DD), inclusive; either may be given alone. */
  from?: string;
  to?: string;
  /** Literal search over the action, the account and the target. */
  q?: string;
}

/**
 * The log's filters from its address. Anything unusable is dropped, so a hand-edited link
 * never reaches the API with a value it would refuse: a day must be a real calendar day
 * that is not in the future, a range must not run backwards or past the API's limit (the
 * range is dropped as a whole), and a search is 1 to 100 characters.
 */
export function parseAuditFilters(
  params: SearchParams,
  now: Date = new Date(),
): AuditFilters & { page: number } {
  const actor = single(params.actor);
  const today = dhakaToday(now);
  let from = single(params.from);
  let to = single(params.to);
  if (!isCalendarDay(from) || from > today) from = undefined;
  if (!isCalendarDay(to) || to > today) to = undefined;
  if (
    from !== undefined &&
    to !== undefined &&
    (from > to || spanDays(from, to) > AUDIT_LOG_MAX_DAYS)
  ) {
    from = undefined;
    to = undefined;
  }
  const q = single(params.q)?.trim();
  return {
    area: oneOf(params.area, AREA_VALUES),
    actorId: actor ? uuidParam(actor) : undefined,
    from,
    to,
    q: q !== undefined && q.length >= 1 && q.length <= 100 ? q : undefined,
    page: pageParam(params.page),
  };
}

export function auditHref(filters: AuditFilters, page = 1): Route {
  return withQuery(AUDIT_PATH, {
    area: filters.area,
    actor: filters.actorId,
    from: filters.from,
    to: filters.to,
    q: filters.q,
    page: page > 1 ? page : undefined,
  });
}

export function auditChips(filters: AuditFilters, actorName?: string): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.area) {
    const label = AUDIT_AREAS.find((area) => area.value === filters.area)?.label ?? filters.area;
    chips.push({
      key: 'area',
      label: `Area: ${label}`,
      removeHref: auditHref({ ...filters, area: undefined }),
    });
  }
  if (filters.actorId) {
    chips.push({
      key: 'actor',
      label: `By: ${actorName ?? 'one account'}`,
      removeHref: auditHref({ ...filters, actorId: undefined }),
    });
  }
  if (filters.from || filters.to) {
    chips.push({
      key: 'range',
      label:
        filters.from && filters.to
          ? `${filters.from} to ${filters.to}`
          : filters.from
            ? `From ${filters.from}`
            : `Until ${filters.to ?? ''}`,
      removeHref: auditHref({ ...filters, from: undefined, to: undefined }),
    });
  }
  if (filters.q) {
    chips.push({
      key: 'q',
      label: `Search: ${filters.q}`,
      removeHref: auditHref({ ...filters, q: undefined }),
    });
  }
  return chips;
}

function actorLabel(entry: AuditEntry): string {
  if (!entry.actor) return 'A removed account';
  return entry.actor.name ?? entry.actor.email ?? 'A staff account';
}

const linkClass = 'text-link underline-offset-4 hover:underline';

/** Where an entry's target can be opened, when this account may open it. */
function targetHref(entry: AuditEntry, permissions: readonly Permission[]): Route | undefined {
  const id = entry.targetId;
  if (!id) return undefined;
  if (
    entry.targetType === 'order' &&
    /^NZ\d{6,12}$/.test(id) &&
    permissions.includes('orders.read')
  ) {
    return `/admin/orders/${id}` as Route;
  }
  if (entry.targetType === 'account' && uuidParam(id)) {
    if (entry.action.startsWith('customer.') && permissions.includes('customers.read')) {
      return `/admin/customers/${id}` as Route;
    }
    if (
      entry.action.startsWith('staff.') &&
      (permissions.includes('staff.roles.assign') ||
        permissions.includes('staff.permissions.manage'))
    ) {
      return `/admin/staff/${id}` as Route;
    }
  }
  if (entry.targetType === 'product' && uuidParam(id) && permissions.includes('products.read')) {
    return `/admin/products/${id}` as Route;
  }
  return undefined;
}

function targetText(entry: AuditEntry): string {
  const type = entry.targetType.replaceAll('_', ' ');
  if (!entry.targetId) return type;
  // Long ids (UUIDs) are shortened; the full id stays in the title.
  const id = entry.targetId.length > 16 ? `${entry.targetId.slice(0, 8)}…` : entry.targetId;
  return `${type} ${id}`;
}

/** A detail value as plain text (React escapes it; nothing is rendered as markup). */
export function detailText(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const json = JSON.stringify(value);
  return json.length > 160 ? `${json.slice(0, 157)}…` : json;
}

function detailLabel(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The pairs of keys that describe a change, as written by the database's audit rows. */
const CHANGE_PAIRS = [
  ['from', 'to'],
  ['before', 'after'],
] as const;

/** The change an entry describes, when its details carry a before and an after. */
export function changeOf(
  details: AuditEntry['details'],
): { before: unknown; after: unknown; keys: readonly [string, string] } | undefined {
  for (const [from, to] of CHANGE_PAIRS) {
    if (from in details && to in details) {
      return { before: details[from], after: details[to], keys: [from, to] };
    }
  }
  return undefined;
}

/**
 * What the entry recorded. A change shows as "before → after" (the old value struck
 * through, the new one highlighted — never by colour alone: the arrow and the words
 * "was" and "now" are text); anything else recorded is listed beneath. Everything is
 * plain text, so nothing a stored value contains can render as markup.
 */
function Details({ details }: { details: AuditEntry['details'] }) {
  const change = changeOf(details);
  const rest = Object.entries(details).filter(([key]) => !change?.keys.includes(key));
  if (!change && rest.length === 0) return null;
  return (
    <div className="mt-1.5 grid max-w-md gap-1.5 text-xs whitespace-normal">
      {change ? (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="sr-only">Was </span>
          <span className="rounded-md bg-danger-soft px-1.5 py-0.5 font-mono break-all text-danger-ink line-through decoration-1">
            {detailText(change.before)}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="sr-only">, now </span>
          <span className="rounded-md bg-success-soft px-1.5 py-0.5 font-mono break-all text-success-ink">
            {detailText(change.after)}
          </span>
        </p>
      ) : null}
      {rest.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {rest.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">
                <AutoText value={detailLabel(key)} />
              </dt>
              <dd className="font-mono break-all text-foreground">
                <AutoText value={detailText(value)} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function AuditTable({
  data,
  filters,
  permissions,
}: {
  data: AuditLogResponse;
  filters: AuditFilters;
  permissions: readonly Permission[];
}) {
  const filtered = Boolean(
    filters.area || filters.actorId || filters.from || filters.to || filters.q,
  );
  return (
    <div className="grid gap-4">
      <Card className="nz-panel-strong overflow-hidden rounded-2xl">
        <DataTable caption="Audit log" dense>
          <TableHeader>
            <TableRow>
              <TableHead>
                <AutoText>Time</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Actor</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Action</AutoText>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <AutoText>Target</AutoText>
              </TableHead>
            </TableRow>
          </TableHeader>
          {data.entries.length > 0 ? (
            <TableBody>
              {data.entries.map((entry) => {
                const href = targetHref(entry, permissions);
                return (
                  <TableRow key={entry.id} className="align-top">
                    <TableCell className="text-muted-foreground tabular-nums">
                      <time dateTime={entry.createdAt}>
                        <AutoText value={formatDateTime(entry.createdAt)} />
                      </time>
                    </TableCell>
                    <TableCell>
                      {entry.actor ? (
                        <Link
                          href={auditHref({ ...filters, actorId: entry.actor.id })}
                          className={linkClass}
                          title="Show only this account’s actions"
                        >
                          {actorLabel(entry)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          <AutoText value={actorLabel(entry)} />
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="grid">
                        <span className="text-foreground">
                          <AutoText value={formatAuditAction(entry.action)} />
                        </span>
                        <code className="font-mono text-[11px] text-muted-foreground">
                          {entry.action}
                        </code>
                        <Details details={entry.details} />
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell" title={entry.targetId ?? undefined}>
                      {href ? (
                        <Link href={href} className={linkClass}>
                          {targetText(entry)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          <AutoText value={targetText(entry)} />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={4}
              icon={ScrollText}
              title={filtered ? 'No entries match these filters' : 'Nothing recorded yet'}
              description={
                filtered
                  ? 'Try another area, a wider date range, or a different search.'
                  : 'Privileged actions such as order changes and permission changes are recorded here.'
              }
            />
          )}
        </DataTable>
      </Card>
      <Pagination
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
        pageSize={data.pageSize}
        noun="entries"
        hrefFor={(page) => auditHref(filters, page)}
      />
    </div>
  );
}

export type AuditRead = Awaited<ReturnType<typeof readAudit>>;

export async function readAudit(filters: AuditFilters, page: number) {
  const result = await adminRead((api, token) =>
    api.adminAuditLog(token, {
      action: filters.area,
      actorId: filters.actorId,
      from: filters.from,
      to: filters.to,
      q: filters.q,
      page,
      pageSize: AUDIT_PAGE_SIZE,
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(AUDIT_PATH));
  return result;
}

export function AuditFailure({
  failure,
  filters,
  page,
}: {
  failure: Exclude<AuditRead['kind'], 'ok' | 'signed_out'>;
  filters: AuditFilters;
  page: number;
}) {
  return (
    <Card className="nz-panel rounded-2xl">
      <ReadState
        failure={failure}
        retryHref={auditHref(filters, page)}
        resetHref={AUDIT_PATH}
        permission="audit_logs.read"
      />
    </Card>
  );
}

/** Reads one page of the log and renders its filter chips and table, or the failure. */
export async function AuditResults({
  filters,
  page,
  permissions,
}: {
  filters: AuditFilters;
  page: number;
  permissions: readonly Permission[];
}) {
  const result = await readAudit(filters, page);
  if (result.kind !== 'ok')
    return <AuditFailure failure={result.kind} filters={filters} page={page} />;
  const actor = filters.actorId
    ? result.value.entries.find((entry) => entry.actor?.id === filters.actorId)?.actor
    : undefined;
  return (
    <div className="grid gap-4">
      <FilterChips
        chips={auditChips(filters, actor ? (actor.name ?? actor.email ?? undefined) : undefined)}
        clearHref={AUDIT_PATH}
      />
      <AuditTable data={result.value} filters={filters} permissions={permissions} />
    </div>
  );
}
