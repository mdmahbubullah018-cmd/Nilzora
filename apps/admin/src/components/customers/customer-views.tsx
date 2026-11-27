import type {
  AdminCustomerDetail,
  AdminOrderSummary,
  CustomerListResponse,
  Permission,
} from '@nilzora/contracts';
import {
  buttonClasses,
  CartIcon,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nilzora/ui';
import { PROFILE_STATUSES } from '@nilzora/contracts';
import { Avatar } from '@nilzora/ui';
import { ShieldAlert, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import {
  FilterBar,
  FilterChips,
  SearchFilter,
  SelectFilter,
} from '@/components/admin-kit/filter-bar';
import { DetailList } from '@/components/admin-kit/detail-list';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { Pagination } from '@/components/admin-kit/pagination';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ForbiddenState, NotFoundState, ReadState } from '@/components/admin-kit/states';
import {
  ACCOUNT_STATUS,
  AccountStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from '@/components/admin-kit/status-badge';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { ordersHref } from '@/components/orders/order-query';
import { orderHref } from '@/components/orders/orders-results';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatBdPhone, formatCount, formatDateTime, formatMoney } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { CustomerStatusAction } from './customer-status-action';
import {
  customerFilterChips,
  customerHref,
  customersHref,
  CUSTOMERS_PAGE_SIZE,
  CUSTOMERS_PATH,
  uuidParam,
  type CustomerFilters,
} from './customer-query';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText, RelativeTimeText } from '@/components/i18n/format-text';

/** Every order of one customer, on the orders list. */
export function customerOrdersHref(customerId: string) {
  return ordersHref({ customerId });
}

const linkClass = 'nz-tap font-medium text-link underline-offset-4 hover:underline';

const statusOptions = PROFILE_STATUSES.map((value) => ({
  value,
  label: ACCOUNT_STATUS[value].label,
}));

export function CustomersTable({
  data,
  filters,
  now,
}: {
  data: CustomerListResponse;
  filters: CustomerFilters;
  now: Date;
}) {
  const filtered = Boolean(filters.q || filters.status);
  return (
    <GlassTable
      label="Customers"
      header={
        <>
          <FilterBar
            action={CUSTOMERS_PATH}
            resetHref={filtered ? CUSTOMERS_PATH : undefined}
            label="Customer filters"
          >
            <SearchFilter
              label="Search"
              defaultValue={filters.q}
              placeholder="Name, email or phone"
            />
            <SelectFilter
              name="status"
              label="Status"
              options={statusOptions}
              defaultValue={filters.status}
              allLabel="All accounts"
            />
          </FilterBar>
          <FilterChips chips={customerFilterChips(filters)} clearHref={CUSTOMERS_PATH} />
        </>
      }
      footer={
        data.total > 0 ? (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            noun="customers"
            hrefFor={(page) => customersHref(filters, page)}
          />
        ) : undefined
      }
    >
      <DataTable caption="Customers" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>
              <AutoText>Customer</AutoText>
            </TableHead>
            <TableHead className="hidden lg:table-cell">
              <AutoText>Phone</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Status</AutoText>
            </TableHead>
            <TableHead className="text-right">
              <AutoText>Orders</AutoText>
            </TableHead>
            <TableHead className="hidden md:table-cell">
              <AutoText>Last order</AutoText>
            </TableHead>
            <TableHead className="hidden xl:table-cell">
              <AutoText>Joined</AutoText>
            </TableHead>
          </TableRow>
        </TableHeader>
        {data.customers.length > 0 ? (
          <TableBody>
            {data.customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={customer.fullName ?? customer.email}
                      seed={customer.id}
                      url={customer.avatar?.thumbUrl ?? customer.googleAvatar}
                      className="size-9"
                    />
                    <div className="grid min-w-0">
                      <Link href={customerHref(customer.id)} className={linkClass}>
                        {customer.fullName ?? customer.email}
                      </Link>
                      {customer.fullName ? (
                        <span className="max-w-64 truncate text-xs text-muted-foreground">
                          {customer.email}
                        </span>
                      ) : null}
                      {/* The account's own id, so a customer can be recognised and quoted exactly. */}
                      <span className="max-w-56 truncate font-mono text-[0.6875rem] text-muted-foreground/80">
                        {customer.id}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                  {customer.phone ? formatBdPhone(customer.phone) : '—'}
                </TableCell>
                <TableCell>
                  <AccountStatusBadge status={customer.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(customer.orderCount)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {customer.lastOrderAt ? (
                    <time
                      dateTime={customer.lastOrderAt}
                      title={formatDateTime(customer.lastOrderAt)}
                    >
                      <RelativeTimeText value={customer.lastOrderAt} now={now} />
                    </time>
                  ) : (
                    'Never'
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">
                  <DateTimeText value={customer.createdAt} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={6}
            icon={Users}
            title={filtered ? 'No customers match these filters' : 'No customers yet'}
            description={
              filtered
                ? 'Try another name, email address or phone number.'
                : 'Customer accounts appear here as people register on the storefront.'
            }
          />
        )}
      </DataTable>
    </GlassTable>
  );
}

export async function CustomersResults({
  filters,
  page,
  now,
}: {
  filters: CustomerFilters;
  page: number;
  now: Date;
}) {
  const result = await adminRead((api, token) =>
    api.adminListCustomers(token, { ...filters, page, pageSize: CUSTOMERS_PAGE_SIZE }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(CUSTOMERS_PATH));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState
          failure={result.kind}
          retryHref={customersHref(filters, page)}
          resetHref={CUSTOMERS_PATH}
          permission="customers.read"
        />
      </section>
    );
  }
  return <CustomersTable data={result.value} filters={filters} now={now} />;
}

function RecentOrders({ orders }: { orders: readonly AdminOrderSummary[] }) {
  return (
    <DataTable caption="Recent orders" dense>
      <TableHeader>
        <TableRow>
          <TableHead>
            <AutoText>Order</AutoText>
          </TableHead>
          <TableHead>
            <AutoText>Placed</AutoText>
          </TableHead>
          <TableHead>
            <AutoText>Status</AutoText>
          </TableHead>
          <TableHead>
            <AutoText>Payment</AutoText>
          </TableHead>
          <TableHead className="text-right">
            <AutoText>Total</AutoText>
          </TableHead>
        </TableRow>
      </TableHeader>
      {orders.length > 0 ? (
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.orderNumber}>
              <TableCell>
                <Link
                  href={orderHref(order.orderNumber)}
                  className="nz-tap font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                >
                  {order.orderNumber}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                <DateTimeText value={order.placedAt} style="datetime" />
              </TableCell>
              <TableCell>
                <OrderStatusBadge status={order.status} />
              </TableCell>
              <TableCell>
                <PaymentStatusBadge status={order.paymentStatus} />
              </TableCell>
              <TableCell className="text-right font-semibold text-foreground tabular-nums">
                {formatMoney(order.totalMinor)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      ) : (
        <DataTableEmpty
          colSpan={5}
          icon={CartIcon}
          title="No orders yet"
          description="This customer has not placed an order."
        />
      )}
    </DataTable>
  );
}

export interface CustomerDetailViewProps {
  customer: AdminCustomerDetail;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}

export function CustomerDetailView({ customer, permissions, csrf }: CustomerDetailViewProps) {
  const name = customer.fullName ?? customer.email;
  const canUpdate = permissions.includes('customers.update');

  return (
    <div className="grid gap-6">
      <PageToolbar
        back={{ href: CUSTOMERS_PATH, label: 'Customers' }}
        icon={UserRound}
        eyebrow={<AccountStatusBadge status={customer.status} />}
        title={name}
        meta={
          <>
            {customer.fullName ? (
              <span>
                <AutoText value={customer.email} />
              </span>
            ) : null}
            {/* The persistent account id, not a display code: it can be searched and quoted. */}
            <span className="font-mono text-xs">Customer ID {customer.id}</span>
            <span>
              Joined <DateTimeText value={customer.createdAt} />
            </span>
          </>
        }
        avatar={
          <Avatar
            name={name}
            seed={customer.id}
            url={customer.avatar?.thumbUrl ?? customer.googleAvatar}
            className="size-14 text-lg"
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <SectionCard
            title="Recent orders"
            icon={CartIcon}
            description={`${formatCount(customer.orderCount)} orders in total`}
            flush={customer.recentOrders !== null}
            actions={
              customer.recentOrders !== null && customer.orderCount > 0 ? (
                <Link
                  href={customerOrdersHref(customer.id)}
                  className={buttonClasses({
                    variant: 'ghost',
                    size: 'sm',
                    className: 'max-sm:min-h-11',
                  })}
                >
                  <AutoText>All orders</AutoText>
                </Link>
              ) : undefined
            }
          >
            {customer.recentOrders === null ? (
              <ForbiddenState compact title="Orders are hidden" permission="orders.read" />
            ) : (
              <RecentOrders orders={customer.recentOrders} />
            )}
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <SectionCard title="Profile" icon={UserRound}>
            <DetailList
              columns={1}
              items={[
                { label: 'Name', value: customer.fullName },
                { label: 'Email address', value: customer.email },
                {
                  label: 'Phone',
                  value: customer.phone ? formatBdPhone(customer.phone) : null,
                },
                { label: 'Status', value: <AccountStatusBadge status={customer.status} /> },
                { label: 'Orders', value: formatCount(customer.orderCount) },
                {
                  label: 'Last order',
                  value: customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : 'Never',
                },
                { label: 'Joined', value: formatDateTime(customer.createdAt) },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="Account access"
            icon={ShieldAlert}
            description={
              customer.status === 'active'
                ? 'Suspend the account to stop sign-ins and new orders.'
                : 'This account is suspended: it cannot sign in or place orders.'
            }
          >
            {canUpdate ? (
              <CustomerStatusAction
                customerId={customer.id}
                name={name}
                status={customer.status}
                csrf={csrf}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <AutoText>
                  Changing an account’s status needs the “Edit customers” permission.
                </AutoText>
              </p>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export async function CustomerDetailContent({
  customerId,
  permissions,
  csrf,
}: {
  customerId: string;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}) {
  const id = uuidParam(customerId);
  if (!id) {
    return (
      <section className="nz-panel rounded-2xl border">
        <NotFoundState title="Customer not found" titleAs="h1" />
      </section>
    );
  }
  const path = customerHref(id);
  const result = await adminRead((api, token) => api.adminGetCustomer(token, id));
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState
          failure={result.kind}
          retryHref={path}
          permission="customers.read"
          titleAs="h1"
        />
      </section>
    );
  }
  return (
    <CustomerDetailView customer={result.value.customer} permissions={permissions} csrf={csrf} />
  );
}
