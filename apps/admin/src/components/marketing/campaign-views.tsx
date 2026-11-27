import type {
  AdminCampaign,
  AdminCampaignDetail,
  CampaignConflict,
  CampaignHistoryEntry,
  CampaignPreviewResponse,
  CampaignState,
  Permission,
} from '@nilzora/contracts';
import {
  Badge,
  Card,
  EmptyState,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonClasses,
  type BadgeTone,
} from '@nilzora/ui';
import { CalendarClock, Copy, Percent, ShieldAlert, Store, Tags } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  DataTable,
  DataTableEmpty,
  FilterBar,
  FilterChips,
  KpiCard,
  Pagination,
  SearchFilter,
  SectionCard,
  SelectFilter,
} from '@/components/admin-kit';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { withQuery } from '@/components/admin-kit/href';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatCount, formatDateTime, formatMoney } from '@/lib/format';
import { duplicateCampaignAction, setCampaignStatusAction } from '@/lib/campaign-actions';
import { AutoText } from '@/components/i18n/translate';
import { CountText, DateTimeText } from '@/components/i18n/format-text';

/*
 * The Discount Campaigns screens. Everything shown is what the API returned: the state,
 * the reach, the preview prices and the conflicts all come from the same pricing engine
 * the storefront and the checkout use, so an administrator never sees a number a shopper
 * would not.
 */

export const CAMPAIGNS_PATH = '/admin/discounts' as Route;

export function campaignHref(campaignId: string): Route {
  return `/admin/discounts/${campaignId}` as Route;
}

export function editCampaignHref(campaignId: string): Route {
  return `/admin/discounts/${campaignId}/edit` as Route;
}

const STATE_STYLE: Record<CampaignState, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'primary' },
  active: { label: 'Live', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  expired: { label: 'Expired', tone: 'neutral' },
  ended: { label: 'Ended', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export function CampaignStateBadge({ state }: { state: CampaignState }) {
  const style = STATE_STYLE[state];
  return (
    <Badge tone={style.tone} dot>
      {style.label}
    </Badge>
  );
}

const SCOPE_LABEL: Record<AdminCampaign['scope'], string> = {
  products: 'Selected products',
  categories: 'Categories',
  brands: 'Brands',
  storewide: 'Whole catalog',
};

/** "20% off" or "৳300 off", without the cap a conflict row does not carry. */
export function campaignValueText(
  campaign: Pick<AdminCampaign, 'discountKind' | 'discountValue'>,
): string {
  return campaign.discountKind === 'fixed'
    ? `${formatMoney(campaign.discountValue)} off`
    : `${String(campaign.discountValue)}% off`;
}

/** "20% off (up to ৳500)" or "৳300 off". */
export function campaignValueLabel(
  campaign: Pick<AdminCampaign, 'discountKind' | 'discountValue' | 'maxDiscountMinor'>,
): string {
  if (campaign.discountKind === 'fixed') return `${formatMoney(campaign.discountValue)} off`;
  const cap =
    campaign.maxDiscountMinor === null ? '' : ` (up to ${formatMoney(campaign.maxDiscountMinor)})`;
  return `${String(campaign.discountValue)}% off${cap}`;
}

export interface CampaignFilters {
  q?: string | undefined;
  state?: CampaignState | undefined;
  scope?: AdminCampaign['scope'] | undefined;
}

function campaignListHref(filters: CampaignFilters, page = 1): Route {
  return withQuery(CAMPAIGNS_PATH, {
    q: filters.q,
    state: filters.state,
    scope: filters.scope,
    page: page > 1 ? page : undefined,
  });
}

export interface CampaignListViewProps {
  campaigns: readonly AdminCampaign[];
  filters: CampaignFilters;
  page: number;
  total: number;
  totalPages: number;
  pageSize: number;
}

/** Every campaign, with the one figure that matters most: how many products it reprices. */
export function CampaignListView({
  campaigns,
  filters,
  page,
  total,
  totalPages,
  pageSize,
}: CampaignListViewProps) {
  const live = campaigns.filter((campaign) => campaign.state === 'active').length;
  const scheduled = campaigns.filter((campaign) => campaign.state === 'scheduled').length;
  const reach = campaigns.reduce((sum, campaign) => sum + campaign.productCount, 0);
  const filtered = Boolean(filters.q || filters.state || filters.scope);

  return (
    <div className="grid gap-6">
      <section aria-label="Campaign summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Campaigns"
          value={formatCount(total)}
          icon={Percent}
          tone="primary"
          footnote="Matching the filters above"
        />
        <KpiCard
          label="Live now"
          value={formatCount(live)}
          icon={Percent}
          tone="success"
          footnote="Pricing products on this page"
        />
        <KpiCard
          label="Scheduled"
          value={formatCount(scheduled)}
          icon={CalendarClock}
          tone="violet"
          footnote="Waiting for their start"
        />
        <KpiCard
          label="Products reached"
          value={formatCount(reach)}
          icon={Tags}
          tone="warning"
          footnote="On this page"
        />
      </section>

      <div className="grid gap-3">
        <FilterBar
          action={CAMPAIGNS_PATH}
          label="Filter campaigns"
          resetHref={CAMPAIGNS_PATH}
          hidden={{}}
        >
          <SearchFilter label="Search" defaultValue={filters.q} placeholder="Name or title" />
          <SelectFilter
            name="state"
            label="State"
            allLabel="Any state"
            defaultValue={filters.state}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'active', label: 'Live' },
              { value: 'paused', label: 'Paused' },
              { value: 'expired', label: 'Expired' },
              { value: 'ended', label: 'Ended' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          <SelectFilter
            name="scope"
            label="Scope"
            allLabel="Any scope"
            defaultValue={filters.scope}
            options={[
              { value: 'categories', label: 'Categories' },
              { value: 'products', label: 'Selected products' },
              { value: 'brands', label: 'Brands' },
              { value: 'storewide', label: 'Whole catalog' },
            ]}
          />
        </FilterBar>
        {filtered ? (
          <FilterChips
            chips={[
              ...(filters.q
                ? [
                    {
                      key: 'q',
                      label: `“${filters.q}”`,
                      removeHref: campaignListHref({ ...filters, q: undefined }),
                    },
                  ]
                : []),
              ...(filters.state
                ? [
                    {
                      key: 'state',
                      label: STATE_STYLE[filters.state].label,
                      removeHref: campaignListHref({ ...filters, state: undefined }),
                    },
                  ]
                : []),
              ...(filters.scope
                ? [
                    {
                      key: 'scope',
                      label: SCOPE_LABEL[filters.scope],
                      removeHref: campaignListHref({ ...filters, scope: undefined }),
                    },
                  ]
                : []),
            ]}
            clearHref={CAMPAIGNS_PATH}
          />
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <DataTable caption="Discount campaigns" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <AutoText>Campaign</AutoText>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <AutoText>Scope</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Discount</AutoText>
              </TableHead>
              <TableHead className="hidden text-right lg:table-cell">
                <AutoText>Products</AutoText>
              </TableHead>
              <TableHead className="hidden text-right xl:table-cell">
                <AutoText>Priority</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>State</AutoText>
              </TableHead>
              <TableHead className="hidden xl:table-cell">
                <AutoText>Ends</AutoText>
              </TableHead>
            </TableRow>
          </TableHeader>
          {campaigns.length > 0 ? (
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <Link
                      href={campaignHref(campaign.id)}
                      className="text-sm font-semibold text-link underline-offset-4 hover:underline"
                    >
                      {campaign.name}
                    </Link>
                    <span className="block max-w-64 truncate text-xs text-muted-foreground">
                      {/* A campaign may carry no customer title; say so rather than leave a gap. */}
                      {campaign.customerTitle.trim() === ''
                        ? 'No customer title'
                        : campaign.customerTitle}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-body md:table-cell">
                    {SCOPE_LABEL[campaign.scope]}
                  </TableCell>
                  <TableCell className="text-body">
                    <AutoText value={campaignValueLabel(campaign)} />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {formatCount(campaign.productCount)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums xl:table-cell">
                    {campaign.priority}
                  </TableCell>
                  <TableCell>
                    <CampaignStateBadge state={campaign.state} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground xl:table-cell">
                    {campaign.endsAt === null ? 'No end' : formatDateTime(campaign.endsAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={7}
              icon={Percent}
              title={filtered ? 'No campaign matches these filters' : 'No discount campaigns yet'}
              description={
                filtered
                  ? 'Try another name, or show every state.'
                  : 'Create one and its prices appear on the storefront, in the app and at checkout.'
              }
            />
          )}
        </DataTable>
      </Card>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        noun="campaigns"
        hrefFor={(next) => campaignListHref(filters, next)}
      />
    </div>
  );
}

interface StatusAction {
  status: 'scheduled' | 'active' | 'paused' | 'ended' | 'archived';
  label: string;
  permission: Permission;
  description: string;
  tone: 'primary' | 'danger';
}

/** The next moves a campaign in this state can make, and the permission each needs. */
function actionsFor(state: CampaignState): StatusAction[] {
  switch (state) {
    case 'draft':
      return [
        {
          status: 'scheduled',
          label: 'Schedule',
          permission: 'discounts.schedule',
          description: 'It prices products from its start time.',
          tone: 'primary',
        },
        {
          status: 'active',
          label: 'Activate now',
          permission: 'discounts.activate',
          description: 'Its prices go live immediately.',
          tone: 'primary',
        },
        {
          status: 'archived',
          label: 'Archive',
          permission: 'discounts.archive',
          description: 'It is kept for history and never prices anything.',
          tone: 'primary',
        },
      ];
    case 'scheduled':
      return [
        {
          status: 'active',
          label: 'Activate now',
          permission: 'discounts.activate',
          description: 'Start it before its scheduled start.',
          tone: 'primary',
        },
        {
          status: 'paused',
          label: 'Pause',
          permission: 'discounts.pause',
          description: 'Products go back to their own sale price.',
          tone: 'primary',
        },
        {
          status: 'ended',
          label: 'End',
          permission: 'discounts.end',
          description: 'Stop it for good. It cannot be restarted.',
          tone: 'danger',
        },
      ];
    case 'active':
      return [
        {
          status: 'paused',
          label: 'Pause',
          permission: 'discounts.pause',
          description: 'Products go back to their own sale price until it resumes.',
          tone: 'primary',
        },
        {
          status: 'ended',
          label: 'End',
          permission: 'discounts.end',
          description: 'Stop it for good. Prices return immediately.',
          tone: 'danger',
        },
      ];
    case 'paused':
      return [
        {
          status: 'active',
          label: 'Resume',
          permission: 'discounts.activate',
          description: 'Its prices apply again at once.',
          tone: 'primary',
        },
        {
          status: 'ended',
          label: 'End',
          permission: 'discounts.end',
          description: 'Stop it for good. It cannot be resumed afterwards.',
          tone: 'danger',
        },
      ];
    case 'expired':
    case 'ended':
      return [
        {
          status: 'archived',
          label: 'Archive',
          permission: 'discounts.archive',
          description: 'Keep it for history and hide it from the working list.',
          tone: 'primary',
        },
      ];
    case 'archived':
      return [];
  }
}

const ACTION_VERB: Record<StatusAction['status'], string> = {
  scheduled: 'Scheduled',
  active: 'Activated',
  paused: 'Paused',
  ended: 'Ended',
  archived: 'Archived',
};

export interface CampaignDetailViewProps {
  campaign: AdminCampaignDetail;
  preview: CampaignPreviewResponse;
  conflicts: readonly CampaignConflict[];
  history: readonly CampaignHistoryEntry[];
  permissions: readonly Permission[];
  csrf: CsrfInput;
}

/** One campaign: what it prices, what it conflicts with, and every step of its life. */
export function CampaignDetailView({
  campaign,
  preview,
  conflicts,
  history,
  permissions,
  csrf,
}: CampaignDetailViewProps) {
  const actions = actionsFor(campaign.state).filter((action) =>
    permissions.includes(action.permission),
  );
  const canEdit = permissions.includes('discounts.edit');
  const canCreate = permissions.includes('discounts.create');
  const wins = preview.products.filter((row) => row.wins).length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Products repriced"
          value={formatCount(preview.activeTotal)}
          icon={Tags}
          tone="primary"
          footnote=<CountText count={preview.total} one="targeted product" />
        />
        <KpiCard
          label="Discount"
          value={campaignValueLabel(campaign)}
          icon={Percent}
          tone="success"
          footnote={SCOPE_LABEL[campaign.scope]}
        />
        <KpiCard
          label="Priority"
          value={String(campaign.priority)}
          icon={ShieldAlert}
          tone="violet"
          footnote="Higher wins inside one scope"
        />
        <KpiCard
          label="Ends"
          value={campaign.endsAt === null ? 'No end' : formatDateTime(campaign.endsAt)}
          icon={CalendarClock}
          tone="warning"
          footnote={
            campaign.startsAt === null
              ? 'Starts immediately'
              : `Started ${formatDateTime(campaign.startsAt)}`
          }
        />
      </div>

      {campaign.scope === 'storewide' && campaign.state !== 'draft' ? (
        <Card className="border-warning/40 bg-warning/5 p-4">
          <p className="text-sm text-foreground">
            This campaign covers the whole catalog: every published product is priced by it while it
            runs.
          </p>
        </Card>
      ) : null}

      <SectionCard
        title="Status"
        icon={CalendarClock}
        description="A campaign never changes a stored price, so every step here is instant and reversible until it ends."
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <CampaignStateBadge state={campaign.state} />
            <span className="text-sm text-muted-foreground">
              {campaign.state === 'active'
                ? `${String(wins)} of ${String(preview.products.length)} products on this page are priced by this campaign right now.`
                : 'Nothing in the store is priced by this campaign in its current state.'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <AutoText>Your account cannot change this campaign&rsquo;s state.</AutoText>
              </p>
            ) : (
              actions.map((action) => (
                <ConfirmForm
                  key={action.status}
                  action={setCampaignStatusAction}
                  csrf={csrf}
                  trigger={action.label}
                  title={`${ACTION_VERB[action.status]} “${campaign.name}”?`}
                  description={action.description}
                  confirmLabel={action.label}
                  tone={action.tone === 'danger' ? 'danger' : 'primary'}
                  hiddenFields={{
                    campaignId: campaign.id,
                    campaignStatus: action.status,
                    expectedVersion: String(campaign.version),
                  }}
                />
              ))
            )}
            {canCreate ? (
              <form action={duplicateCampaignAction}>
                <input type="hidden" name="csrfToken" value={csrf.token} />
                <input type="hidden" name="campaignId" value={campaign.id} />
                <button type="submit" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                  <Copy aria-hidden="true" />
                  <AutoText>Duplicate</AutoText>
                </button>
              </form>
            ) : null}
            {canEdit && campaign.status !== 'archived' ? (
              <Link
                href={editCampaignHref(campaign.id)}
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                <AutoText>Edit campaign</AutoText>
              </Link>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="What it prices"
        icon={Percent}
        description={`Real prices from the catalog, priced by the same engine the storefront and checkout use.`}
      >
        <Card className="overflow-hidden shadow-none">
          <DataTable caption="Products this campaign prices" dense>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>
                  <AutoText>Product</AutoText>
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  <AutoText>Category</AutoText>
                </TableHead>
                <TableHead className="text-right">
                  <AutoText>List price</AutoText>
                </TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  <AutoText>Own sale price</AutoText>
                </TableHead>
                <TableHead className="text-right">
                  <AutoText>Campaign price</AutoText>
                </TableHead>
                <TableHead className="hidden text-right lg:table-cell">
                  <AutoText>Saving</AutoText>
                </TableHead>
                <TableHead className="hidden xl:table-cell">
                  <AutoText>Priced by</AutoText>
                </TableHead>
              </TableRow>
            </TableHeader>
            {preview.products.length > 0 ? (
              <TableBody>
                {preview.products.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell>
                      <span className="text-sm font-medium text-foreground">
                        <AutoText value={row.name} />
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {row.sku}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-body md:table-cell">
                      {row.categoryName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.regularPriceMinor)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                      {formatMoney(row.productPriceMinor)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(row.campaignPriceMinor)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-success lg:table-cell">
                      {row.campaignDiscountMinor === 0
                        ? '—'
                        : formatMoney(row.campaignDiscountMinor)}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {row.wins ? (
                        row.overridesProductDiscount ? (
                          <Badge tone="primary">
                            <AutoText>Overrides the sale price</AutoText>
                          </Badge>
                        ) : (
                          <Badge tone="success">
                            <AutoText>Applies</AutoText>
                          </Badge>
                        )
                      ) : (
                        <Badge tone="warning">{row.governedBy ?? 'Outranked'}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ) : (
              <DataTableEmpty
                colSpan={7}
                icon={Tags}
                title="No published product is reached"
                description="Check the targets: a campaign only prices products that are on sale."
              />
            )}
          </DataTable>
        </Card>
        {preview.total > preview.products.length ? (
          <p className="text-sm text-muted-foreground">
            Showing {String(preview.products.length)} of {formatCount(preview.total)} targeted
            products. The first ones are listed; the count above is the real reach.
          </p>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Overlapping campaigns"
        icon={ShieldAlert}
        description="Other live campaigns that reach at least one of the same products."
      >
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <AutoText>No other live campaign reaches these products.</AutoText>
          </p>
        ) : (
          <ul role="list" className="grid gap-2">
            {conflicts.map((conflict) => (
              <li
                key={conflict.campaignId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-muted/40 p-3"
              >
                <div className="grid gap-0.5">
                  <Link
                    href={campaignHref(conflict.campaignId)}
                    className="text-sm font-medium text-link underline-offset-4 hover:underline"
                  >
                    {conflict.customerTitle}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {SCOPE_LABEL[conflict.scope]} · {campaignValueText(conflict)} · priority{' '}
                    {conflict.priority}
                  </span>
                </div>
                <span className="text-sm tabular-nums text-foreground">
                  <CountText count={conflict.sharedProducts} one="shared product" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="History"
        icon={Store}
        description="Every change to this campaign, with who made it."
      >
        {history.length === 0 ? (
          <EmptyState
            icon={Store}
            title="Nothing recorded yet"
            description="Changes made from now on appear here."
            className="py-8"
          />
        ) : (
          <ol role="list" className="grid gap-3">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium text-foreground">
                  {entry.action.replace('discount_campaign.', '').replaceAll('_', ' ')}
                </span>
                <span className="text-muted-foreground">
                  {entry.actorName ?? entry.actorEmail ?? 'A staff account'}
                </span>
                <time className="ml-auto text-xs text-muted-foreground" dateTime={entry.createdAt}>
                  <DateTimeText value={entry.createdAt} style="datetime" />
                </time>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
